package mg.uaz.folio;

import com.fasterxml.jackson.databind.*;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.apache.tika.Tika;
import org.springframework.http.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.server.ResponseStatusException;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.Principal;
import java.time.*;
import java.util.*;

@RestController
@RequestMapping("/api")
@Transactional
class Api {
    private static final List<String> ROLES=List.of("admin","centre","professeur","etudiant");
    private static final String LISTE="""
        SELECT p.id,p.dossier,p.version,p.devoir_id AS devoir_cours,p.etat,p.fichier,p.cree,
               d.titre,a.nom AS etudiant,p.professeur
        FROM depots p JOIN devoirs d ON d.id=p.devoir_id JOIN comptes a ON a.email=p.etudiant
        """;
    private final JdbcTemplate db;
    private final ObjectMapper json;
    private final PasswordEncoder passwords;
    @PersistenceContext private EntityManager em;

    Api(JdbcTemplate db,ObjectMapper json,PasswordEncoder passwords){
        this.db=db;
        this.json=json;
        this.passwords=passwords;
    }

    record Compte(String email,String nom,String role){
        boolean centre(){return role.equals("centre");}
        boolean admin(){return role.equals("admin");}
    }
    record Texte(String fichier,String contenu,byte[] original) {}
    record Devoir(UUID id,String titre,String professeur,LocalDate echeance,int maximum){}
    record RapportStocke(Analyse.Rapport exact,Analyse.Options options,List<UUID> sourceIds){}
    record Decision(String etat,String libelle,List<String> depuis,boolean centre){}
    record Reglages(boolean bibliographie,boolean citations,int minimum,Integer bas,Integer moyen,Integer conservation){}
    private static final Map<String,Decision> DECISIONS=Map.of(
        "corriger",new Decision("corriger","À corriger",List.of("en_revue","reexamen","incomplet"),true),
        "transmettre",new Decision("transmis","Transmis au professeur",List.of("en_revue","reexamen"),true),
        "disciplinaire",new Decision("disciplinaire","Orientation disciplinaire",List.of("en_revue","reexamen"),true),
        "contester",new Decision("reexamen","Réexamen demandé",List.of("corriger","disciplinaire"),false));

    @GetMapping("/csrf") Map<String,String> csrf(CsrfToken csrf){
        return Map.of("header",csrf.getHeaderName(),"token",csrf.getToken());
    }

    private Compte compte(Principal p){return compte(p.getName());}
    private Compte compte(String adresse){
        return db.query("SELECT email,nom,role FROM comptes WHERE email=?",
            (r,i)->new Compte(r.getString(1),r.getString(2),r.getString(3)),adresse)
            .stream().findFirst().orElseThrow(()->erreur(404,"Compte introuvable."));
    }
    private static ResponseStatusException erreur(int statut,String message){return new ResponseStatusException(HttpStatusCode.valueOf(statut),message);}
    private static void verifier(boolean ok,int statut,String message){if(!ok) throw erreur(statut,message);}
    private static String champ(JsonNode j,String cle,int max,boolean requis){
        var valeur=j.path(cle);
        verifier(valeur.isMissingNode()||valeur.isNull()||valeur.isTextual(),400,"Champ invalide : "+cle);
        String texte=valeur.asText("").strip();
        verifier(texte.length()<=max&&(!requis||!texte.isBlank()),400,"Champ invalide : "+cle);
        return texte;
    }
    private static int nombre(JsonNode j,String cle,int min,int max){
        var valeur=j.path(cle);
        verifier(valeur.isIntegralNumber()&&valeur.canConvertToInt()&&valeur.asInt()>=min&&valeur.asInt()<=max,400,"Valeur invalide : "+cle);
        return valeur.asInt();
    }
    private static Integer optionNombre(JsonNode j,String cle,int min,int max){
        return j.path(cle).isMissingNode()||j.path(cle).isNull()?null:nombre(j,cle,min,max);
    }
    private static UUID uuid(String s){
        try{return UUID.fromString(s);}catch(IllegalArgumentException e){throw erreur(400,"Identifiant invalide.");}
    }
    private void verrouiller(){db.queryForObject("SELECT id FROM verrou WHERE id=1 FOR UPDATE",Integer.class);}
    private JsonNode lire(String s){
        try{return json.readTree(s);}catch(com.fasterxml.jackson.core.JsonProcessingException e){throw erreur(400,"Formulaire invalide.");}
    }
    private String objet(Object o){
        try{return json.writeValueAsString(o);}catch(com.fasterxml.jackson.core.JsonProcessingException e){throw new IllegalStateException(e);}
    }
    private Reglages reglages(){
        return db.query("SELECT * FROM reglages WHERE id=1",(r,i)->new Reglages(r.getBoolean("bibliographie"),r.getBoolean("citations"),
            r.getInt("minimum"),(Integer)r.getObject("bas"),(Integer)r.getObject("moyen"),(Integer)r.getObject("conservation")))
            .stream().findFirst().orElse(new Reglages(true,false,8,null,null,null));
    }

    @GetMapping("/espace") Map<String,Object> espace(Principal p){
        var me=compte(p);
        var propres=db.queryForList(LISTE+" WHERE p.etudiant=? ORDER BY p.cree DESC",me.email());
        var transmis=me.role().equals("professeur")?db.queryForList(LISTE+" WHERE p.professeur=? AND p.etat='transmis' ORDER BY p.cree DESC",me.email()):List.of();
        var revue=me.centre()?db.queryForList("""
            SELECT l.*, CAST(p.rapport AS json)->'exact'->>'score' AS score,
            (CAST(p.rapport AS json)->'exact'->>'matchCount')::int AS passages
            FROM (
            """+LISTE+"""
            ) l JOIN depots p ON p.id=l.id ORDER BY l.cree DESC
            """):List.<Map<String,Object>>of();
        for(var ligne:revue) {
            var score=ligne.get("score");
            if(score!=null) ligne.put("score",Double.valueOf(score.toString()));
        }
        var agenda=me.role().equals("etudiant")?db.queryForList("""
            SELECT d.id,d.titre,d.echeance,d.maximum,c.nom AS cours FROM devoirs d JOIN cours c ON c.id=d.cours_id
            JOIN inscriptions i ON i.cours_id=c.id WHERE i.etudiant=? ORDER BY c.nom,d.titre
            """,me.email()):me.admin()||me.centre()?db.queryForList("""
            SELECT d.id,d.titre,d.echeance,d.maximum,c.nom AS cours,c.professeur FROM devoirs d JOIN cours c ON c.id=d.cours_id ORDER BY c.nom,d.titre
            """):List.of();
        var sources=me.admin()||me.centre()?db.queryForList("""
            SELECT id,titre,fichier,cree,dossier,depot_id AS devoir, CASE WHEN depot_id IS NULL THEN 1 ELSE 2 END AS partage
            FROM sources ORDER BY cree DESC
            """):List.of();
        Map<String,Object> res=new LinkedHashMap<>();
        res.put("nom",me.nom());res.put("role",me.role());res.put("centre",me.centre());res.put("admin",me.admin());
        res.put("enseignant",me.role().equals("professeur"));res.put("devoirs",propres);res.put("revue",revue);res.put("transmis",transmis);
        res.put("agenda",agenda);res.put("sources",sources);res.put("config",reglages());
        res.put("roles",me.admin()?db.queryForList("SELECT email,nom,role FROM comptes ORDER BY nom"):List.of());
        res.put("cours",me.admin()?db.queryForList("SELECT id,nom,professeur FROM cours ORDER BY nom"):List.of());
        return res;
    }

    @PutMapping("/roles") Map<String,Boolean> role(Principal p,@RequestBody JsonNode j){
        var me=compte(p);
        verifier(me.admin(),403,"Action réservée à l’administration.");
        verrouiller();
        String email=champ(j,"email",160,true).toLowerCase(Locale.ROOT), role=champ(j,"role",20,true);
        verifier(email.matches("[^\\s@]+@[^\\s@]+\\.[^\\s@]+")&&ROLES.contains(role),400,"Adresse ou rôle invalide.");
        verifier(!me.email().equals(email),400,"Votre compte administrateur ne peut pas être modifié ici.");
        String nom=champ(j,"nom",120,true);
        var secret=j.path("password");
        verifier(secret.isMissingNode()||secret.isTextual(),400,"Mot de passe invalide.");
        String pass=secret.asText("");
        var existants=db.queryForList("SELECT role FROM comptes WHERE email=?",String.class,email);
        if(existants.isEmpty()) verifier(!pass.isBlank(),400,"Définissez un mot de passe initial.");
        if(!pass.isEmpty()) verifier(!pass.isBlank()&&pass.length()>=12&&pass.getBytes(StandardCharsets.UTF_8).length<=72,400,"Mot de passe : 12 caractères minimum et 72 octets maximum.");
        if(!existants.isEmpty()){
            if(!existants.get(0).equals(role)){
                boolean affecte=Boolean.TRUE.equals(db.queryForObject("""
                    SELECT EXISTS(SELECT 1 FROM cours WHERE professeur=?)
                        OR EXISTS(SELECT 1 FROM inscriptions WHERE etudiant=?)
                        OR EXISTS(SELECT 1 FROM depots WHERE professeur=? OR etudiant=?)
                    """,Boolean.class,email,email,email,email));
                verifier(!affecte,409,"Ce compte est déjà affecté à des cours ou à des dossiers.");
            }
            if(pass.isEmpty()) db.update("UPDATE comptes SET nom=?,role=? WHERE email=?",nom,role,email);
            else db.update("UPDATE comptes SET nom=?,role=?,secret=? WHERE email=?",nom,role,passwords.encode(pass),email);
        } else db.update("INSERT INTO comptes(email,nom,secret,role) VALUES(?,?,?,?)",email,nom,passwords.encode(pass),role);
        return Map.of("ok",true);
    }

    @PostMapping("/cours") Map<String,Boolean> devoir(Principal p,@RequestBody JsonNode j){
        verifier(compte(p).admin(),403,"Action réservée à l’administration.");
        verrouiller();
        String cours=champ(j,"cours",120,true),titre=champ(j,"titre",160,true);
        String prof=champ(j,"professeur",160,true).toLowerCase(Locale.ROOT);
        verifier(compte(prof).role().equals("professeur"),400,"Sélectionnez un compte professeur.");
        int maximum=nombre(j,"maximum",1,100);
        String date=champ(j,"echeance",10,false);
        LocalDate echeance;
        try{echeance=date.isEmpty()?null:LocalDate.parse(date);}catch(java.time.format.DateTimeParseException e){throw erreur(400,"Échéance invalide.");}
        var ids=db.query("SELECT id,professeur FROM cours WHERE nom=?",(r,i)->Map.entry(r.getObject(1,UUID.class),r.getString(2)),cours);
        UUID cid=ids.isEmpty()?UUID.randomUUID():ids.get(0).getKey();
        if(ids.isEmpty()) db.update("INSERT INTO cours VALUES(?,?,?)",cid,cours,prof);
        else verifier(ids.get(0).getValue().equals(prof),409,"Ce cours est déjà associé à un autre professeur.");
        db.update("INSERT INTO devoirs VALUES(?,?,?,?,?)",UUID.randomUUID(),cid,titre,echeance,maximum);
        return Map.of("ok",true);
    }

    @PostMapping("/inscriptions") Map<String,Boolean> inscrire(Principal p,@RequestBody JsonNode j){
        verifier(compte(p).admin(),403,"Action réservée à l’administration.");
        UUID cours=uuid(champ(j,"cours",36,true));
        String etudiant=champ(j,"email",160,true).toLowerCase(Locale.ROOT);
        verifier(compte(etudiant).role().equals("etudiant"),400,"Sélectionnez un compte étudiant.");
        verifier(Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM cours WHERE id=?)",Boolean.class,cours)),404,"Cours introuvable.");
        db.update("INSERT INTO inscriptions VALUES(?,?) ON CONFLICT DO NOTHING",cours,etudiant);
        return Map.of("ok",true);
    }

    @PutMapping("/configuration") Map<String,Boolean> configuration(Principal p,@RequestBody JsonNode j){
        verifier(compte(p).admin(),403,"Action réservée à l’administration.");
        Integer bas=optionNombre(j,"bas",0,100),moyen=optionNombre(j,"moyen",0,100),conservation=optionNombre(j,"conservation",1,240);
        verifier((bas==null&&moyen==null)||(bas!=null&&moyen!=null&&bas<moyen),400,"Renseignez deux seuils ordonnés.");
        verifier(j.path("bibliographie").isBoolean()&&j.path("citations").isBoolean(),400,"Exclusions invalides.");
        db.update("""
            INSERT INTO reglages VALUES(1,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
            bibliographie=excluded.bibliographie,citations=excluded.citations,minimum=excluded.minimum,
            bas=excluded.bas,moyen=excluded.moyen,conservation=excluded.conservation
            """,j.get("bibliographie").asBoolean(),j.get("citations").asBoolean(),nombre(j,"minimum",8,100),bas,moyen,conservation);
        return Map.of("ok",true);
    }

    private Texte extraire(MultipartFile fichier) throws IOException{
        String nom=Optional.ofNullable(fichier.getOriginalFilename()).orElse("").replaceAll("[\\r\\n/\\\\]","_");
        verifier(nom.length()<=240&&nom.toLowerCase(Locale.ROOT).matches(".+\\.(pdf|docx|txt)")&&!fichier.isEmpty(),400,"Choisissez un fichier PDF, DOCX ou TXT valide.");
        byte[] bytes=fichier.getBytes();
        var tika=new Tika();
        String mime=tika.detect(bytes,nom);
        String extension=nom.substring(nom.lastIndexOf('.')+1).toLowerCase(Locale.ROOT);
        boolean accepte=switch(extension){
            case "pdf" -> mime.equals("application/pdf");
            case "docx" -> mime.equals("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
            default -> mime.startsWith("text/");
        };
        verifier(accepte,400,"Le contenu du fichier ne correspond pas au format annoncé.");
        String contenu;
        try(var flux=new java.io.ByteArrayInputStream(bytes)){
            contenu=tika.parseToString(flux,new org.apache.tika.metadata.Metadata(),250_001);
        }catch(org.apache.tika.exception.TikaException|IOException e){
            throw erreur(422,"Le texte du fichier est illisible.");
        }
        verifier(contenu.length()<=250_000,422,"Le document dépasse 250 000 caractères de texte.");
        verifier(!contenu.isBlank()&&contenu.indexOf(0)<0,422,"Aucun texte exploitable. Un PDF scanné doit d’abord être traité par OCR.");
        return new Texte(nom,contenu,bytes);
    }

    private List<Analyse.Source> corpus(UUID dossier,List<UUID> ids){
        var refs=db.query("SELECT id,titre,texte,dossier FROM sources ORDER BY cree DESC LIMIT 501",(r,i)->
            new Analyse.Source(r.getObject(1,UUID.class),r.getString(2),r.getString(3)));
        if(dossier!=null){
            var propres=db.query("SELECT id FROM sources WHERE dossier=?",(r,i)->r.getObject(1,UUID.class),dossier);
            refs.removeIf(s->propres.contains(s.id()));
        }
        if(ids!=null) refs.removeIf(s->!ids.contains(s.id()));
        verifier(refs.size()<=500&&refs.stream().mapToLong(s->s.texte().length()).sum()<=4_000_000,422,"Le corpus dépasse la capacité de comparaison de cette version.");
        return refs;
    }
    private void journal(Depot d,Compte c,String action,String motif,String conseil){
        db.update("INSERT INTO journal VALUES(?,?,?,?,?,?,?)",UUID.randomUUID(),d.id,c.email(),action,motif,conseil,maintenant());
    }
    private static java.sql.Timestamp maintenant(){return java.sql.Timestamp.from(Instant.now());}

    @PostMapping(value="/devoirs",consumes=MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    Map<String,UUID> deposer(Principal p,@RequestParam MultipartFile fichier,@RequestParam String donnees) throws IOException{
        var c=compte(p);
        verifier(c.role().equals("etudiant"),403,"Le dépôt est réservé aux étudiants inscrits.");
        var j=lire(donnees);
        UUID devoirId=uuid(champ(j,"devoirCours",36,true)),id=uuid(champ(j,"id",36,true));
        var texte=extraire(fichier);
        verrouiller();
        var existant=em.find(Depot.class,id);
        if(existant!=null){
            verifier(existant.etudiant.equals(c.email())&&existant.devoirId.equals(devoirId),409,"Identifiant de dépôt déjà utilisé.");
            return Map.of("id",id);
        }
        var devoir=db.query("""
            SELECT d.id,d.titre,c.professeur,d.echeance,d.maximum FROM devoirs d JOIN cours c ON c.id=d.cours_id
            JOIN inscriptions i ON i.cours_id=c.id WHERE d.id=? AND i.etudiant=?
            """,(r,i)->new Devoir(r.getObject(1,UUID.class),r.getString(2),r.getString(3),r.getObject(4,LocalDate.class),r.getInt(5)),
            devoirId,c.email()).stream().findFirst().orElseThrow(()->erreur(404,"Devoir indisponible pour ce compte."));
        verifier(devoir.echeance()==null||!LocalDate.now(ZoneId.of("Indian/Antananarivo")).isAfter(devoir.echeance()),409,"La date limite du devoir est dépassée.");
        var precedents=db.queryForList("SELECT id FROM depots WHERE devoir_id=? AND etudiant=? ORDER BY version DESC",UUID.class,devoirId,c.email());
        verifier(precedents.size()<devoir.maximum(),409,"Nombre maximal de dépôts atteint.");
        Depot precedent=precedents.isEmpty()?null:em.find(Depot.class,precedents.get(0));
        String parent=champ(j,"parent",36,false);
        verifier(precedent==null?parent.isEmpty():precedent.id.toString().equals(parent)&&List.of("corriger","incomplet").contains(precedent.etat),
            409,"Le dossier existant doit être ouvert depuis votre décision pour ajouter une version.");
        Depot d=new Depot();
        d.id=id;d.dossier=precedent==null?id:precedent.dossier;d.version=precedents.size()+1;d.devoirId=devoirId;
        d.etudiant=c.email();d.professeur=devoir.professeur();d.fichier=texte.fichier();d.texte=texte.contenu();d.original=texte.original();
        d.cree=Instant.now();d.consent=j.path("consentCorpus").asBoolean(false);
        var r=reglages();
        var options=new Analyse.Options(r.bibliographie(),r.citations(),r.minimum());
        var refs=corpus(d.dossier,null);
        var analyse=Analyse.comparer(d.texte,refs,options);
        d.rapport=objet(new RapportStocke(analyse,options,refs.stream().map(Analyse.Source::id).toList()));
        d.etat=analyse.score()==null?"incomplet":"en_revue";
        em.persist(d);em.flush();
        journal(d,c,"Dépôt enregistré",analyse.score()==null?analyse.reason():"","");
        return Map.of("id",d.id);
    }

    private Depot dossier(UUID id,Compte c){
        Depot d=em.find(Depot.class,id);
        verifier(d!=null&&(c.centre()||d.etudiant.equals(c.email())||
            c.role().equals("professeur")&&d.professeur.equals(c.email())&&d.etat.equals("transmis")),404,"Dossier introuvable.");
        return d;
    }

    @GetMapping("/devoirs/{id}") Map<String,Object> rapport(Principal p,@PathVariable UUID id){
        var c=compte(p);var d=dossier(id,c);
        var ligne=db.queryForMap(LISTE+" WHERE p.id=?",id);
        boolean propre=d.etudiant.equals(c.email());
        ligne.put("propre",propre);ligne.put("vue",c.centre()?"centre":propre?"etudiant":"professeur");
        ligne.put("journal",db.queryForList("""
            SELECT a.nom AS acteur,j.action,j.motif,j.conseil,j.date FROM journal j
            JOIN comptes a ON a.email=j.acteur WHERE j.depot_id=? AND (? OR j.action<>'Orientation disciplinaire')
            ORDER BY j.date,j.id
            """,id,c.centre()));
        if(!propre||c.centre()){
            var rapport=lire(d.rapport);
            ligne.put("exact",rapport.get("exact"));ligne.put("options",rapport.get("options"));
            ligne.put("text",d.texte);ligne.put("consentCorpus",d.consent);ligne.put("partial",false);
            ligne.put("semantic",Map.of("status","off"));ligne.put("style",Map.of("status","off"));
        }
        return ligne;
    }

    @GetMapping("/devoirs/{id}/original") ResponseEntity<byte[]> original(Principal p,@PathVariable UUID id){
        var d=dossier(id,compte(p));
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).contentType(MediaType.APPLICATION_OCTET_STREAM)
            .header("Content-Disposition",ContentDisposition.attachment().filename(d.fichier,StandardCharsets.UTF_8).build().toString())
            .header("X-Content-Type-Options","nosniff").body(d.original);
    }

    @PatchMapping("/devoirs/{id}/decision") Map<String,String> decision(Principal p,@PathVariable UUID id,@RequestBody JsonNode j){
        verrouiller();
        var c=compte(p);var d=dossier(id,c);
        var decision=DECISIONS.get(champ(j,"action",30,true));
        verifier(decision!=null,400,"Décision inconnue.");
        verifier(decision.centre()?c.centre():d.etudiant.equals(c.email()),403,"Action réservée au rôle concerné.");
        verifier(decision.depuis().contains(d.etat),409,"Ce statut ne permet pas cette action.");
        int version=db.queryForObject("SELECT MAX(version) FROM depots WHERE dossier=?",Integer.class,d.dossier);
        verifier(version==d.version,409,"Une version plus récente existe.");
        String motif=champ(j,"motif",1600,true);
        String conseil=decision.etat().equals("corriger")?champ(j,"conseil",1600,false):"";
        if(decision.etat().equals("transmis")) verifier(compte(d.professeur).role().equals("professeur"),409,"Le professeur du devoir est indisponible.");
        d.etat=decision.etat();journal(d,c,decision.libelle(),motif,conseil);
        return Map.of("etat",d.etat);
    }

    @PostMapping("/devoirs/{id}/apercu-exclusions") Map<String,Object> apercu(Principal p,@PathVariable UUID id,@RequestBody JsonNode j){
        var c=compte(p);verifier(c.centre(),403,"Action réservée au centre.");
        var d=dossier(id,c);
        var ids=new ArrayList<UUID>();
        lire(d.rapport).path("sourceIds").forEach(n->ids.add(uuid(n.asText())));
        var refs=corpus(d.dossier,ids);
        verifier(refs.size()==ids.size(),409,"Le corpus d’origine est incomplet.");
        var options=new Analyse.Options(j.path("bibliographie").asBoolean(),j.path("citations").asBoolean(),nombre(j,"minimum",8,100));
        return Map.of("exact",Analyse.comparer(d.texte,refs,options),"options",options);
    }

    @GetMapping("/sources/{id}") Map<String,Object> source(Principal p,@PathVariable UUID id){
        var c=compte(p);verifier(c.centre()||c.admin(),403,"Accès réservé à l’équipe du centre.");
        var source=db.queryForList("SELECT id,titre AS title,texte AS text FROM sources WHERE id=? AND (depot_id IS NULL OR ?)",id,c.centre());
        verifier(!source.isEmpty(),404,"Source introuvable.");
        return source.get(0);
    }

    @PostMapping(value="/sources",consumes=MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    Map<String,UUID> source(Principal p,@RequestParam MultipartFile fichier,@RequestParam String donnees) throws IOException{
        verifier(compte(p).admin(),403,"Action réservée à l’administration.");
        var j=lire(donnees);
        UUID id=uuid(champ(j,"id",36,true));
        String titre=champ(j,"titre",160,true);
        var texte=extraire(fichier);
        verrouiller();
        verifier(Boolean.TRUE.equals(db.queryForObject("SELECT count(*)<500 FROM sources",Boolean.class)),409,"Le corpus a atteint 500 références.");
        db.update("INSERT INTO sources VALUES(?,?,?,?,NULL,NULL,?) ON CONFLICT(id) DO NOTHING",id,titre,texte.fichier(),texte.contenu(),maintenant());
        return Map.of("id",id);
    }

    @PostMapping("/devoirs/{id}/indexer") Map<String,Boolean> indexer(Principal p,@PathVariable UUID id){
        verrouiller();
        var c=compte(p);verifier(c.centre(),403,"Action réservée au centre.");
        var d=dossier(id,c);
        verifier(d.consent,403,"La réutilisation de ce document n’a pas été autorisée.");
        String titre=db.queryForObject("SELECT titre FROM devoirs WHERE id=?",String.class,d.devoirId);
        db.update("INSERT INTO sources VALUES(?,?,?,?,?,?,?) ON CONFLICT(depot_id) DO NOTHING",UUID.randomUUID(),
            titre,d.fichier,d.texte,d.dossier,d.id,maintenant());
        return Map.of("ok",true);
    }

    @ExceptionHandler(ResponseStatusException.class) ResponseEntity<Map<String,String>> erreurApi(ResponseStatusException e){
        return ResponseEntity.status(e.getStatusCode()).body(Map.of("error",Objects.requireNonNullElse(e.getReason(),"Requête refusée.")));
    }
    @ExceptionHandler(MaxUploadSizeExceededException.class) ResponseEntity<Map<String,String>> tropGrand(){
        return ResponseEntity.status(413).body(Map.of("error","Le fichier dépasse la limite de 20 Mo."));
    }
}
