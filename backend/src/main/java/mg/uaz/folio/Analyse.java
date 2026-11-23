package mg.uaz.folio;

import java.text.Normalizer;
import java.util.*;
import java.util.regex.Pattern;

final class Analyse {
    record Source(UUID id,String titre,String texte) {}
    record Options(boolean bibliographie, boolean citations, int minimum) {}
    record Mot(String valeur,int debut,int fin) {}
    record Passage(UUID sourceId,String title,int words,String excerpt,String sourceExcerpt) {}
    record Reference(UUID id,String title) {}
    record Rapport(Double score,int total,int covered,int eligible,int matchCount,List<int[]> highlights,
        List<int[]> exclusions,List<Passage> matches,List<Reference> sources,List<Object> lexical,String reason) {}
    private static final Pattern MOT=Pattern.compile("[\\p{L}\\p{N}][\\p{L}\\p{M}\\p{N}]*");
    private static final Pattern BIB=Pattern.compile("(?im)^\\s*(?:bibliographie|références(?: bibliographiques)?|bibliography|references)\\s*[:.]?\\s*$");
    private static final Pattern CIT=Pattern.compile("«[^»]*»|“[^”]*”|\"[^\"]*\"");
    private static final Pattern ACCENT=Pattern.compile("\\p{M}+");

    private static List<Mot> mots(String texte,Options opts,List<int[]> exclusions) {
        var b=BIB.matcher(texte);
        if(opts.bibliographie() && b.find()) exclusions.add(new int[]{b.start(),texte.length()});
        if(opts.citations()) {
            var q=CIT.matcher(texte);
            while(q.find()) exclusions.add(new int[]{q.start(),q.end()});
        }
        exclusions.sort(Comparator.comparingInt(a->a[0]));
        List<Mot> mots=new ArrayList<>();
        var m=MOT.matcher(texte);
        int pos=0;
        while(m.find()) {
            while(pos<exclusions.size()&&exclusions.get(pos)[1]<=m.start()) pos++;
            String valeur=pos<exclusions.size()&&exclusions.get(pos)[0]<m.end()?null:
                ACCENT.matcher(Normalizer.normalize(m.group(),Normalizer.Form.NFKD)).replaceAll("").toLowerCase(Locale.ROOT);
            mots.add(new Mot(valeur,m.start(),m.end()));
        }
        return mots;
    }

    private static long[] empreintes(List<Mot> mots,int taille) {
        long[] chemin=new long[mots.size()+1], puissances=new long[mots.size()+1];
        puissances[0]=1;
        for(int i=0;i<mots.size();i++){
            String valeur=mots.get(i).valeur();
            chemin[i+1]=chemin[i]*1_000_003+(valeur==null?0:valeur.hashCode());
            puissances[i+1]=puissances[i]*1_000_003;
        }
        long[] signatures=new long[Math.max(0,mots.size()-taille+1)];
        int suite=0;
        for(int fin=0;fin<mots.size();fin++){
            suite=mots.get(fin).valeur()==null?0:suite+1;
            if(suite>=taille){
                int debut=fin+1-taille;
                long hash=chemin[fin+1]-chemin[debut]*puissances[taille];
                signatures[debut]=hash==0?1:hash;
            }
        }
        return signatures;
    }

    private static boolean egal(Mot a,Mot b){return a.valeur()!=null && a.valeur().equals(b.valeur());}
    static Rapport comparer(String texte,List<Source> sources,Options options) {
        List<int[]> exclusions=new ArrayList<>();
        List<Mot> mots=mots(texte,options,exclusions);
        int eligible=(int)mots.stream().filter(m->m.valeur()!=null).count();
        List<Reference> references=sources.stream().map(s->new Reference(s.id(),s.titre())).toList();
        int taille=options.minimum(), operations=0, passages=0;
        long[] requete=empreintes(mots,taille);
        BitSet couverts=new BitSet();
        List<Passage> matches=new ArrayList<>();
        for(Source source:sources) {
            var origine=mots(source.texte(),options,new ArrayList<>());
            long[] signatures=empreintes(origine,taille);
            Map<Long,List<Integer>> index=new HashMap<>();
            for(int i=0;i<signatures.length;i++) if(signatures[i]!=0)
                index.computeIfAbsent(signatures[i],key->new ArrayList<>()).add(i);
            Map<Integer,Integer> finsParDiagonale=new HashMap<>();
            for(int i=0;i<requete.length;i++) {
                if(requete[i]==0) continue;
                int meilleur=0, pos=0;
                for(int j:index.getOrDefault(requete[i],List.of())) {
                    int diagonale=j-i;
                    if(finsParDiagonale.getOrDefault(diagonale,0)>=i+taille) continue;
                    int n=0;
                    while(i+n<mots.size()&&j+n<origine.size()&&egal(mots.get(i+n),origine.get(j+n))) {
                        if(++operations>3_000_000) return impossible(mots.size(),eligible,exclusions,references,
                            "Comparaison interrompue : trop de répétitions dans les documents.");
                        n++;
                    }
                    if(++operations>3_000_000) return impossible(mots.size(),eligible,exclusions,references,
                        "Comparaison interrompue : trop de répétitions dans les documents.");
                    if(n>=taille) finsParDiagonale.put(diagonale,i+n);
                    if(n>meilleur){meilleur=n;pos=j;}
                }
                if(meilleur>=taille){
                    couverts.set(i,i+meilleur);
                    passages++;
                    if(matches.size()<150) matches.add(new Passage(source.id(),source.titre(),meilleur,
                        extrait(texte,mots,i,meilleur),extrait(source.texte(),origine,pos,meilleur)));
                }
            }
        }
        if(sources.isEmpty() || eligible<taille) return impossible(mots.size(),eligible,exclusions,references,
            sources.isEmpty()?"Aucune référence disponible pour ce devoir.":"Texte trop court pour le seuil configuré.");
        List<int[]> highlights=new ArrayList<>();
        for(int p=couverts.nextSetBit(0);p>=0;){
            int fin=couverts.nextClearBit(p);
            highlights.add(new int[]{mots.get(p).debut(),mots.get(fin-1).fin()});
            p=couverts.nextSetBit(fin);
        }
        return new Rapport(100.0*couverts.cardinality()/eligible,mots.size(),couverts.cardinality(),eligible,
            passages,highlights,exclusions,matches,references,List.of(),"");
    }
    private static Rapport impossible(int total,int eligible,List<int[]> exclusions,List<Reference> sources,String raison){
        return new Rapport(null,total,0,eligible,0,List.of(),exclusions,List.of(),sources,List.of(),raison);
    }
    private static String extrait(String texte,List<Mot> mots,int i,int n){
        int debut=mots.get(i).debut(), fin=mots.get(i+n-1).fin();
        return texte.substring(debut,Math.min(fin,debut+1500))+(fin-debut>1500?"…":"");
    }
}
