export const MIN_COMMUN = 8;
const K = 5, W = MIN_COMMUN - K + 1;
const stop = new Set("a à au aux avec ce ces cette dans de des du elle en est et il la le les leur leurs mais nous on ou où par pas plus pour qui que sa se ses son sur un une vous the an a as at and by for from in is of on or this that to with are was were".split(" "));
const titresBiblio = /^[ \t]*(?:bibliographie|bibliography|références(?: bibliographiques)?|references)[ \t]*[:.]?[ \t]*\r?$/im;
const norme = s => s.normalize("NFKD").replace(/\p{M}+/gu,"").toLocaleLowerCase("fr");
export const compterMots = text => [...text.matchAll(/[\p{L}\p{N}][\p{L}\p{M}\p{N}]*/gu)].length;
const tokenizer = text => Array.from(text.matchAll(/[\p{L}\p{N}][\p{L}\p{M}\p{N}]*/gu),
    m=>({v:norme(m[0]),s:m.index,e:m.index+m[0].length}));

function fusion(plages) {
  const out=[];
  for(const [lo,hi] of plages.sort((a,b)=>a[0]-b[0] || a[1]-b[1])) {
    if(!out.length || lo>out.at(-1)[1]) out.push([lo,hi]);
    else out.at(-1)[1]=Math.max(out.at(-1)[1],hi);
  }
  return out;
}
function admissibles(text, ts, {bibliographie=true, citations=false}={}) {
  const brut=[];
  if(bibliographie){const m=titresBiblio.exec(text); if(m) brut.push([m.index,text.length]);}
  if(citations) for(const m of text.matchAll(/«[^»]*»|“[^”]*”|"[^"]*"/gu)) brut.push([m.index,m.index+m[0].length]);
  const exclusions=fusion(brut), runs=[];
  let start=null, j=0;
  ts.forEach((t,i)=>{
    while(j<exclusions.length && exclusions[j][1]<=t.s) j++;
    const exclu = j<exclusions.length && exclusions[j][0]<t.e;
    if(exclu && start!==null){runs.push([start,i]);start=null;}
    if(!exclu && start===null) start=i;
  });
  if(start!==null) runs.push([start,ts.length]);
  return {runs,exclusions};
}
export function textePourSemantique(text, options) {
  const {exclusions}=admissibles(text,[],options);
  let i=0, result="";
  for(const [a,b] of exclusions){result+=text.slice(i,a)+text.slice(a,b).replace(/[^\n\r]/g," ");i=b;}
  return result+text.slice(i);
}
function* empreintes(ts,lo,hi) {
  let last=-1;
  const fenetre=[];
  for(let i=lo; i<=hi-K; i++){
    let h=2166136261;
    for(let j=i;j<i+K;j++){
      const mot=ts[j].v;
      for(let c=0;c<mot.length;c++) h=Math.imul(h^mot.charCodeAt(c),16777619);
      h=Math.imul(h^31,16777619);
    }
    h>>>=0;
    while(fenetre.length && fenetre[0].i<=i-W) fenetre.shift();
    while(fenetre.length && fenetre.at(-1).h>=h) fenetre.pop();
    fenetre.push({h,i});
    if(i>=lo+W-1 && fenetre[0].i!==last){last=fenetre[0].i;yield fenetre[0];}
  }
}
function termes(ts,runs) {
  const counts=new Map();
  for(const [a,b] of runs)for(let i=a;i<b;i++){const t=ts[i].v;if(t.length>1&&!stop.has(t))counts.set(t,(counts.get(t)||0)+1);}
  return counts;
}
function similaritesLexicales(q,docs) {
  const df=new Map();
  for(const {tf} of docs)for(const term of tf.keys())df.set(term,(df.get(term)||0)+1);
  const n=docs.length, idf=t=>Math.log((n+1)/((df.get(t)||0)+1))+1;
  function norm(tf){let sq=0;for(const [t,f] of tf)sq+=((1+Math.log(f))*idf(t))**2;return Math.sqrt(sq);}
  const qn=norm(q);
  return docs.map(({ref,tf})=>{
    let dot=0;for(const [t,f] of q){const d=tf.get(t);if(d)dot+=(1+Math.log(f))*(1+Math.log(d))*idf(t)**2;}
    return {sourceId:ref.id,title:ref.title,cosine:Math.min(1,dot/(qn*norm(tf)||1))};
  }).filter(x=>x.cosine>0).sort((a,b)=>b.cosine-a.cosine).slice(0,5);
}

export function comparer(text, sources, options={}) {
  const minimum=Number.isInteger(options.minimum)?Math.max(MIN_COMMUN,options.minimum):MIN_COMMUN;
  const ts=tokenizer(text);
  const {runs,exclusions}=admissibles(text,ts,options);
  const eligible=runs.reduce((s,[a,b])=>s+b-a,0);
  const report={score:null,total:ts.length,eligible,covered:0,exclusions,highlights:[],matches:[],lexical:[],
    sources:sources.map(({id,title})=>({id,title})),matchCount:0,reason:"",minimum};
  if(!sources.length || !runs.some(([a,b])=>b-a>=minimum)){
    report.reason=!sources.length?"Aucune source de référence disponible.":"Le texte retenu contient trop peu de mots consécutifs pour cette comparaison.";
    return report;
  }
  const prepared=sources.map(ref=>{
    const t=tokenizer(ref.text);return {ref,t,tf:termes(t,[[0,t.length]])};
  }).filter(r=>r.t.length>=minimum);
  if(!prepared.length){report.reason="Les sources disponibles sont trop courtes pour la comparaison.";return report;}
  report.lexical=similaritesLexicales(termes(ts,runs),prepared);
  const query=new Map();
  for(const [a,b] of runs) for(const {i,h} of empreintes(ts,a,b)){
    if(!query.has(h))query.set(h,[]);query.get(h).push({i,a,b});
  }
  const spans=[];let work=0;
  for(const {ref,t} of prepared){
    const last=new Map();
    for(const seed of empreintes(t,0,t.length)){
      const qs=query.get(seed.h);if(!qs)continue;
      work+=qs.length;
      if(work>1500000){
        report.reason="Les répétitions dépassent la capacité de ce traitement. Comparez un extrait plus court.";
        report.matches=[];report.matchCount=0;return report;
      }
      for(const q of qs){
        const diag=seed.i-q.i;
        if(q.i+K<=(last.get(diag)??-1))continue;
        let ok=true;for(let v=0;v<K;v++)if(ts[q.i+v].v!==t[seed.i+v].v){ok=false;break;}
        if(!ok)continue;
        let a=q.i,b=q.i+K,c=seed.i,d=seed.i+K;
        while(a>q.a&&c>0&&ts[a-1].v===t[c-1].v){a--;c--;}
        while(b<q.b&&d<t.length&&ts[b].v===t[d].v){b++;d++;}
        last.set(diag,b);
        if(b-a<minimum)continue;
        spans.push([a,b]);report.matchCount++;
        if(report.matches.length<100){
          const qa=ts[a].s,qb=ts[b-1].e,sa=t[c].s,sb=t[d-1].e;
          report.matches.push({sourceId:ref.id,title:ref.title,qa,qb,sa,sb,words:b-a,
            excerpt:text.slice(qa,Math.min(qb,qa+620)),sourceExcerpt:ref.text.slice(sa,Math.min(sb,sa+620))});
        }
      }
    }
  }
  const united=fusion(spans);
  report.covered=united.reduce((s,[a,b])=>s+b-a,0);
  report.highlights=united.map(([a,b])=>[ts[a].s,ts[b-1].e]);
  report.score=100*report.covered/eligible;
  report.matches.sort((a,b)=>a.qa-b.qa||b.words-a.words);
  return report;
}
