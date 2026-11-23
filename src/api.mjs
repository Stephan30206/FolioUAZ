import { comparer, compterMots, textePourSemantique } from "../public/moteur.mjs";
import { indiceRedaction } from "./indice.mjs";
import { sourcesExemple } from "../public/corpus.mjs";

const MAX=20*1024*1024, MAX_TEXT=1_000_000, MAX_CORPUS=4_000_000;
const MIME={pdf:"application/pdf",docx:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",txt:"text/plain; charset=utf-8"};
const VISIBLE="id,dossier,version,parent,devoir_cours,passages,signal_ia,titre,etudiant,professeur,fichier,taille,etat,score,mots,communs,cree";
const SRC="id,titre,fichier,mots,cree,dossier,devoir,partage";
const UUID=/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;
class Erreur extends Error { constructor(code,message){super(message);this.code=code;} }
function demander(ok,message,code=400){if(!ok)throw new Erreur(code,message);}
const json=(v,status=200)=>Response.json(v,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
const now=()=>new Date().toISOString();
function champ(v,max,obligatoire=false){demander(typeof v==="string"&&v.trim().length<=max&&(!obligatoire||v.trim()),"Vérifiez les champs du formulaire.");return v.trim();}
const inList=(list,email)=>!!email&&String(list||"").toLowerCase().split(/[\s,;]+/).includes(email);
const enseignantDossier=(u,d)=>u.enseignant&&d.professeur.trim().toLowerCase()===u.email&&d.etat==="transmis";
const defaut={bas:null,moyen:null,bibliographie:true,citations:false,minimum:8,conservation:null};
async function configuration(env){const row=await env.DB.prepare("SELECT valeur FROM configuration WHERE cle=?").bind("analyse").first();return row?{...defaut,...JSON.parse(row.valeur)}:defaut;}
const sansScore=({score,mots,communs,passages,signal_ia,...reste})=>reste;
async function roleEnregistre(env,email){return (await env.DB.prepare("SELECT role FROM roles_uaz WHERE email=?").bind(email).first())?.role;}
async function identite(req,env){
 const owner=req.headers.get("oai-authenticated-user-id");demander(owner,"Connectez-vous pour accéder à votre espace privé.",401);
 const raw=req.headers.get("oai-authenticated-user-full-name")||"";
 let nom=raw;try{if(req.headers.get("oai-authenticated-user-full-name-encoding")==="percent-encoded-utf-8")nom=decodeURIComponent(raw);}catch{}
 const email=(req.headers.get("oai-authenticated-user-email")||"").trim().toLowerCase();
 const relecteurInitial=inList(env.UAZ_RELECTEURS,email);
 const admin=relecteurInitial&&(!env.UAZ_ADMINISTRATEURS||inList(env.UAZ_ADMINISTRATEURS,email));
 const role=await roleEnregistre(env,email);
 const centre=relecteurInitial||role==="centre";
 return {owner,centre,admin,email,enseignant:role==="professeur"||inList(env.UAZ_ENSEIGNANTS,email),nom:(nom||email.split("@")[0]||"Compte UAZ").slice(0,120)};
}
async function soumission(req){
 const len=Number(req.headers.get("content-length")||0);
 demander(len<MAX+6_000_000,"Le dépôt dépasse la taille acceptée.",413);
 const form=await req.formData(), file=form.get("fichier"), raw=form.get("donnees");
 demander(file&&typeof file.arrayBuffer==="function"&&file.size>0&&file.size<=MAX,"Le fichier doit faire entre 1 octet et 20 Mo.");
 const ext=file.name.split(".").at(-1).toLowerCase();demander(MIME[ext],"Choisissez un PDF, un DOCX ou un TXT.");
 demander(typeof raw==="string"&&raw.length<=2_100_000,"Les données du rapport sont trop grandes ou absentes.");
 let data;try{data=JSON.parse(raw);}catch{throw new Erreur(400,"Formulaire illisible.");}
 demander(data&&UUID.test(data.id),"Identifiant de dépôt invalide.");
 demander(typeof data.text==="string"&&data.text.trim()&&data.text.length<=MAX_TEXT,"Le texte extrait est vide ou trop long.");
 return {file,data,ext,filename:file.name.replace(/[\r\n/\\]/g,"_").slice(-220)};
}
async function parId(env,u,id){const d=await env.DB.prepare("SELECT * FROM devoirs WHERE id=?").bind(id).first();demander(d&&(d.owner===u.owner||u.centre||enseignantDossier(u,d)),"Devoir introuvable.",404);return d;}
async function lireJSON(bucket,key){const o=await bucket.get(key);demander(o,"Le document enregistré est temporairement indisponible.",503);return o.json();}
const titreArchive=s=>"Devoir archivé · "+s.id.slice(0,8);
async function getSources(env,u){
 const rows=(await env.DB.prepare("SELECT "+SRC+" FROM sources WHERE owner=? OR partage IN (1,2) ORDER BY cree DESC").bind(u.owner).all()).results;
 return rows.map(s=>s.partage===2&&!u.centre?{...s,titre:titreArchive(s),fichier:"Archive du centre",protection:true}:s);
}
async function corpus(env,u,selection,dossier){
 demander(Array.isArray(selection)&&selection.length<=50,"Sélectionnez au maximum 50 sources.");
 const ids=new Set(selection),out=sourcesExemple.filter(s=>ids.has(s.id)).map(s=>({id:s.id,title:s.title,text:s.text}));
 let charge=out.reduce((p,s)=>p+s.text.length,0);
 const rows=(await env.DB.prepare("SELECT id,titre,objet,dossier,partage FROM sources WHERE owner=? OR partage IN (1,2)").bind(u.owner).all()).results;
 for(const s of rows){
   if(!ids.has(s.id)||(s.dossier&&s.dossier===dossier))continue;
   const doc=await lireJSON(env.BUCKET,s.objet+"/texte");charge+=doc.text.length;
   demander(charge<=MAX_CORPUS,"Le corpus sélectionné est trop volumineux. Décochez des sources.",413);
   const protegee=s.partage===2&&!u.centre;
   out.push({id:s.id,title:protegee?titreArchive(s):s.titre,text:doc.text,protegee});
 }
 return out;
}
async function nettoyer(env,keys){await Promise.allSettled(keys.map(k=>env.BUCKET.delete(k)));}
async function stocker(env,entries){const r=await Promise.allSettled(entries.map(([key,v,options])=>env.BUCKET.put(key,v,options)));if(r.some(x=>x.status==="rejected")){await nettoyer(env,entries.map(x=>x[0]));throw new Erreur(503,"L’enregistrement du document a échoué. Réessayez.");}}
function compacterSemantique(s,refs,texte){
 if(!s||s.status==="off")return {status:"off"};
 if(s.status!=="done")return {status:"unavailable",message:String(s.message||"Le modèle n’a pas produit de résultat.").slice(0,420)};
 const allowed=new Map(refs.filter(r=>!r.protegee).map(r=>[r.id,r])),matches=[];
 for(const m of (Array.isArray(s.matches)?s.matches:[]).slice(0,40)){
   const r=allowed.get(m.sourceId);if(!r||!Number.isFinite(m.similarity)||m.similarity>1.001||m.similarity<0)continue;
   if(![m.queryStart,m.queryEnd,m.sourceStart,m.sourceEnd].every(Number.isInteger))continue;
   if(m.queryStart<0||m.queryEnd<=m.queryStart||m.queryEnd>texte.length||m.sourceStart<0||m.sourceEnd<=m.sourceStart||m.sourceEnd>r.text.length)continue;
   matches.push({sourceId:r.id,sourceTitle:r.title,similarity:m.similarity,queryText:texte.slice(m.queryStart,Math.min(m.queryEnd,m.queryStart+650)),sourceText:r.text.slice(m.sourceStart,Math.min(m.sourceEnd,m.sourceStart+650)),queryStart:m.queryStart,queryEnd:m.queryEnd});
 }
 const coverage={sampled:!!s.coverage?.sampled};
 for(const key of ["queryExamined","queryTotal","referenceExamined","referenceTotal","sourcesExamined","sourcesTotal","pairsExamined"]){
  const value=s.coverage?.[key];coverage[key]=Number.isSafeInteger(value)&&value>=0?value:0;
 }
 return {status:"done",model:String(s.model||"Sentence Transformers").slice(0,130),matches,coverage};
}
async function ajouterDevoir(req,env,u){
 const {data,file,ext,filename}=await soumission(req);
 const old=await env.DB.prepare("SELECT id FROM devoirs WHERE id=? AND owner=?").bind(data.id,u.owner).first();
 if(old)return json({id:old.id});
 const parent=data.parent?await parId(env,{...u,centre:false,enseignant:false},data.parent):null;
 if(parent)demander(["corriger","incomplet"].includes(parent.etat),"Cette version ne peut pas être révisée.",409);
 const devoirCours=parent?parent.devoir_cours:(data.devoirCours??null);
 const devoir=devoirCours?await env.DB.prepare("SELECT * FROM devoirs_cours WHERE id=?").bind(devoirCours).first():null;
 if(devoirCours)demander(devoir,"Devoir de cours introuvable.",404);
 if(devoir?.echeance)demander(now().slice(0,10)<=devoir.echeance,"La date limite de ce devoir est dépassée.",409);
 const titre=devoir?devoir.titre:parent?parent.titre:champ(data.titre,160,true),etudiant=parent?parent.etudiant:champ(data.etudiant||"",120),professeur=devoir?devoir.professeur:parent?parent.professeur:champ(data.professeur||"",120);
 const dossier=parent?.dossier||data.id,version=parent?parent.version+1:1;
 const refs=await corpus(env,u,data.sources,dossier);
 demander(refs.length>0,"Choisissez au moins une source de comparaison.");
 const config=await configuration(env);
 const options={bibliographie:data.options?.bibliographie??config.bibliographie,citations:data.options?.citations??config.citations,minimum:config.minimum};
 const exact=comparer(data.text,refs,options);
 const semantic=compacterSemantique(data.semantic,refs,data.text);
 const warnings=Array.isArray(data.warnings)?data.warnings.slice(0,25).map(s=>String(s).slice(0,400)):[];
 const partial=!!data.partial;const etat=exact.score==null||partial?"incomplet":"en_revue";
 const objet="devoirs/"+crypto.randomUUID(),t=now();
 demander([undefined,null,"","fr","en","mg"].includes(data.langueIndice),"Choisissez une langue proposée pour l’indice de rédaction.");
 const style=data.langueIndice?indiceRedaction(textePourSemantique(data.text,options),data.langueIndice,partial):{status:"off"};
 const detail={signaux:(data.text.match(/[\u200B-\u200F\u2060\uFEFF]/gu)||[]).length,text:data.text,exact,semantic,style,consentCorpus:data.consentCorpus===true,options,warnings,partial};
 const keys=[objet+"/original",objet+"/rapport"];
 await stocker(env,[[keys[0],await file.arrayBuffer(),{httpMetadata:{contentType:MIME[ext]}}],[keys[1],JSON.stringify({...detail,sourceIds:refs.map(r=>r.id)})]]);
 try{
  const resultat=await env.DB.batch([
   env.DB.prepare("INSERT INTO devoirs(id,owner,dossier,version,parent,devoir_cours,passages,signal_ia,titre,etudiant,professeur,fichier,taille,objet,etat,score,mots,communs,cree) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ? IS NULL OR (SELECT count(*) FROM devoirs WHERE owner=? AND devoir_cours=?)<?")
    .bind(data.id,u.owner,dossier,version,parent?.id??null,devoirCours,exact.matchCount,style.status==="calcule"?(style.passages.some(p=>p.signale)?"signal":"sous le seuil"):null,titre,etudiant,professeur,filename,file.size,objet,etat,exact.score,exact.eligible,exact.covered,t,devoirCours,u.owner,devoirCours,devoir?.maximum??0),
   env.DB.prepare("INSERT INTO journal(id,devoir,date,action,acteur,motif) SELECT ?,?,?,?,?,? WHERE changes()>0").bind(crypto.randomUUID(),data.id,t,"Dépôt",etudiant||u.nom,partial?"Extraction partielle à vérifier.":"Document et analyse enregistrés.")
  ]);
  demander(resultat[0].meta.changes===1,"Le nombre de dépôts autorisés pour ce devoir est atteint.",409);
 }catch(err){await nettoyer(env,keys);const prev=await env.DB.prepare("SELECT id FROM devoirs WHERE id=? AND owner=?").bind(data.id,u.owner).first();if(prev)return json({id:prev.id});if(String(err).match(/unique|constraint/i))throw new Erreur(409,"Une nouvelle version existe déjà. Actualisez la liste des devoirs.");throw err;}
 return json({id:data.id},201);
}
async function ajouterSource(req,env,u){
 const {data,file,ext,filename}=await soumission(req);
 const old=await env.DB.prepare("SELECT id FROM sources WHERE id=? AND owner=?").bind(data.id,u.owner).first();if(old)return json({id:old.id});
 const titre=champ(data.titre,160,true),mots=compterMots(data.text);demander(mots>=8,"La source doit contenir au moins huit mots.");
 const o="sources/"+crypto.randomUUID(),keys=[o+"/texte",o+"/original"];
 await stocker(env,[[keys[0],JSON.stringify({text:data.text})],[keys[1],await file.arrayBuffer(),{httpMetadata:{contentType:MIME[ext]}}]]);
 try{await env.DB.prepare("INSERT INTO sources(id,owner,titre,fichier,mots,objet,cree,partage) VALUES(?,?,?,?,?,?,?,?)").bind(data.id,u.owner,titre,filename,mots,o,now(),u.centre?1:0).run();}
 catch(e){await nettoyer(env,keys);const d=await env.DB.prepare("SELECT id FROM sources WHERE id=? AND owner=?").bind(data.id,u.owner).first();if(d)return json(d);throw e;}
 return json({id:data.id},201);
}
const transitions={transmettre:{from:["en_revue","reexamen","pret"],to:"transmis",label:"Transmis au professeur"},disciplinaire:{from:["en_revue","reexamen"],to:"disciplinaire",label:"Orientation disciplinaire"},autoriser:{from:["en_revue","reexamen"],to:"pret",label:"Prêt à remettre"},corriger:{from:["en_revue","reexamen"],to:"corriger",label:"À corriger"},contester:{from:["corriger"],to:"reexamen",label:"Réexamen demandé"},remettre:{from:["pret"],to:"remis",label:"Remise confirmée"}};
async function changer(req,env,u,d){
 const data=await req.json();demander(Object.hasOwn(transitions,data.action),"Action inconnue.");const tr=transitions[data.action];
 const revue=["autoriser","corriger","transmettre","disciplinaire"].includes(data.action);
 if(data.action==="transmettre")demander((inList(env.UAZ_ENSEIGNANTS,d.professeur.trim().toLowerCase())||(await roleEnregistre(env,d.professeur.trim().toLowerCase()))==="professeur"),"Le devoir doit être associé à l’adresse d’un professeur habilité.");
 const conseil=data.action==="corriger"?champ(data.conseil||"",1600):"";
 demander(revue?u.centre:d.owner===u.owner,revue?"Cette décision est réservée au centre.":"Cette action appartient au déposant.",403);
 const motif=champ(data.motif||"",1600,data.action!=="remettre");
 demander(tr.from.includes(d.etat),"L’état de cette version a changé. Actualisez le rapport.",409);
 const q="UPDATE devoirs SET etat=? WHERE id=? AND owner=? AND etat=? AND NOT EXISTS (SELECT 1 FROM devoirs WHERE owner=? AND dossier=? AND version>?)";
 const r=await env.DB.batch([env.DB.prepare(q).bind(tr.to,d.id,d.owner,d.etat,d.owner,d.dossier,d.version),env.DB.prepare("INSERT INTO journal(id,devoir,date,action,acteur,motif,conseil) SELECT ?,?,?,?,?,?,? WHERE changes()>0").bind(crypto.randomUUID(),d.id,now(),tr.label,u.nom,motif||"Remise confirmée par le déposant.",conseil)]);
 demander(r[0].meta.changes===1,"Une autre action a déjà modifié ce dossier.",409);return json({etat:tr.to});
}
async function indexer(env,u,d){
 demander(u.centre,"L’ajout d’un devoir au corpus est réservé au centre.",403);
 const known=await env.DB.prepare("SELECT id FROM sources WHERE owner=? AND devoir=?").bind(u.owner,d.id).first();if(known)return json(known);
 const doc=await lireJSON(env.BUCKET,d.objet+"/rapport");demander(doc.consentCorpus,"Le déposant doit avoir autorisé la réutilisation de cette version.",403);
 const mots=compterMots(doc.text);demander(mots>=8&&!doc.partial,"Il faut une version lisible et complète pour l’indexer.");
 const id=crypto.randomUUID(),objet="sources/"+id;await env.BUCKET.put(objet+"/texte",JSON.stringify({text:doc.text}));
 try{await env.DB.prepare("INSERT INTO sources(id,owner,titre,fichier,mots,objet,cree,dossier,devoir,partage) VALUES(?,?,?,?,?,?,?,?,?,2)").bind(id,u.owner,d.titre+" · v"+d.version,d.fichier,mots,objet,now(),d.dossier,d.id).run();}
 catch(e){await nettoyer(env,[objet+"/texte"]);const other=await env.DB.prepare("SELECT id FROM sources WHERE owner=? AND devoir=?").bind(u.owner,d.id).first();if(other)return json(other);throw e;}return json({id},201);
}
export async function api(req,env){
 try{
  const url=new URL(req.url),u=await identite(req,env),m=req.method,parts=url.pathname.split("/").filter(Boolean).slice(1);
  if(m!=="GET"&&req.headers.get("origin"))demander(req.headers.get("origin")===url.origin,"Origine de la requête invalide.",403);
  const [kind,id,op]=parts;
  if(kind==="espace"&&m==="GET"){
   const [r,sources,revue,config,transmis,agenda,roles]=await Promise.all([
    env.DB.prepare("SELECT "+VISIBLE+" FROM devoirs WHERE owner=? ORDER BY cree DESC").bind(u.owner).all(),getSources(env,u),
    u.centre?env.DB.prepare("SELECT "+VISIBLE+" FROM devoirs ORDER BY cree DESC").all():{results:[]},configuration(env),
    u.enseignant?env.DB.prepare("SELECT "+VISIBLE+" FROM devoirs WHERE lower(trim(professeur))=? AND etat='transmis' ORDER BY cree DESC").bind(u.email).all():{results:[]},
    env.DB.prepare("SELECT * FROM devoirs_cours ORDER BY echeance,cours,titre").all(),
    u.admin?env.DB.prepare("SELECT email,role FROM roles_uaz ORDER BY email").all():{results:[]}]);
   return json({nom:u.nom,centre:u.centre,admin:u.admin,enseignant:u.enseignant,devoirs:r.results.map(sansScore),revue:revue.results,transmis:transmis.results,sources,config,agenda:u.admin||u.centre?agenda.results:agenda.results.map(({professeur,...devoir})=>devoir),roles:roles.results});
  }
  if(kind==="roles"&&m==="PUT"){
   demander(u.admin,"Action réservée à l’administration.",403);
   const body=await req.json();
   const email=champ(body.email,160,true).toLowerCase();
   demander(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)&&["etudiant","centre","professeur"].includes(body.role),"Vérifiez l’adresse et le rôle.");
   await env.DB.prepare("INSERT INTO roles_uaz(email,role) VALUES(?,?) ON CONFLICT(email) DO UPDATE SET role=excluded.role").bind(email,body.role).run();
   return json({ok:true});
  }
  if(kind==="cours"&&m==="POST"){
   demander(u.admin,"Action réservée à l’administration.",403);
   const b=await req.json(),cours=champ(b.cours,120,true),titre=champ(b.titre,160,true),prof=champ(b.professeur,160,true).toLowerCase(),echeance=champ(b.echeance||"",10);
   demander(!echeance||/^\d{4}-\d{2}-\d{2}$/.test(echeance),"Date limite invalide.");
   demander(Number.isInteger(b.maximum)&&b.maximum>=1&&b.maximum<=100,"Vérifiez le nombre maximal de dépôts.");
   demander(inList(env.UAZ_ENSEIGNANTS,prof)||(await roleEnregistre(env,prof))==="professeur","Attribuez d’abord le rôle professeur à cette adresse.");
   await env.DB.prepare("INSERT INTO devoirs_cours(id,cours,titre,professeur,echeance,maximum) VALUES(?,?,?,?,?,?)").bind(crypto.randomUUID(),cours,titre,prof,echeance,b.maximum).run();
   return json({ok:true},201);
  }
  if(kind==="configuration"&&m==="PUT"){
   demander(u.admin,"Action réservée à l’administration.",403);
   const {bas,moyen,bibliographie,citations,minimum,conservation=null}=await req.json();
   demander((bas===null&&moyen===null)||(Number.isFinite(bas)&&Number.isFinite(moyen)&&bas>=0&&bas<moyen&&moyen<=100),"Renseignez deux seuils ordonnés entre 0 et 100.");
   demander(Number.isInteger(minimum)&&minimum>=8&&minimum<=100&&typeof bibliographie==="boolean"&&typeof citations==="boolean","Vérifiez les valeurs d’exclusion.");
   demander(conservation===null||(Number.isInteger(conservation)&&conservation>=1&&conservation<=240),"Vérifiez la durée de conservation.");
   const valeur=JSON.stringify({bas,moyen,bibliographie,citations,minimum,conservation});
   await env.DB.prepare("INSERT INTO configuration(cle,valeur) VALUES(?,?) ON CONFLICT(cle) DO UPDATE SET valeur=excluded.valeur").bind("analyse",valeur).run();
   return json({ok:true});
  }
  if(kind==="sources"&&!id&&m==="POST")return await ajouterSource(req,env,u);
  if(kind==="sources"&&id&&m==="GET"){
   const s=await env.DB.prepare("SELECT * FROM sources WHERE id=? AND (owner=? OR partage=1 OR (partage=2 AND ?=1))").bind(id,u.owner,Number(u.centre)).first();demander(s,"Source introuvable.",404);
   return json({id:s.id,title:s.titre,...await lireJSON(env.BUCKET,s.objet+"/texte")});
  }
  if(kind==="devoirs"&&!id&&m==="POST")return await ajouterDevoir(req,env,u);
  if(kind==="devoirs"&&id&&UUID.test(id)){
   const d=await parId(env,u,id);
   if(m==="POST"&&op==="apercu-exclusions"){
    demander(u.centre,"Action réservée au centre.",403);
    const b=await req.json();
    demander(typeof b.bibliographie==="boolean"&&typeof b.citations==="boolean"&&Number.isInteger(b.minimum)&&b.minimum>=8&&b.minimum<=100,"Vérifiez les exclusions.");
    const doc=await lireJSON(env.BUCKET,d.objet+"/rapport");
    const ids=doc.sourceIds??doc.exact.sources.map(s=>s.id);
    const refs=await corpus(env,{...u,owner:d.owner},ids,d.dossier);
    demander(refs.length===ids.length,"Certaines références du dépôt ne sont plus disponibles.",409);
    const options={bibliographie:b.bibliographie,citations:b.citations,minimum:b.minimum};
    return json({exact:comparer(doc.text,refs,options),options});
   }
   if(m==="PATCH"&&op==="decision")return await changer(req,env,u,d);
   if(m==="POST"&&op==="indexer")return await indexer(env,u,d);
   if(m==="GET"&&op==="original"){
    const o=await env.BUCKET.get(d.objet+"/original");demander(o,"Original introuvable.",404);
    return new Response(o.body,{headers:{"Content-Type":"application/octet-stream","Content-Disposition":"attachment; filename*=UTF-8''"+encodeURIComponent(d.fichier),"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
   }
   if(m==="GET"&&!op){
    const [doc,evt]=await Promise.all([lireJSON(env.BUCKET,d.objet+"/rapport"),env.DB.prepare("SELECT date,action,acteur,motif,conseil FROM journal WHERE devoir=? ORDER BY date").bind(d.id).all()]);
    const {owner,objet,...publicData}=d;
    if(!u.centre&&!enseignantDossier(u,d))return json({...sansScore(publicData),propre:true,vue:"etudiant",journal:evt.results.filter(e=>e.action!=="Orientation disciplinaire"),partial:doc.partial});
    return json({...publicData,propre:owner===u.owner,vue:u.centre?"centre":"professeur",...doc,journal:evt.results});
   }
  }throw new Erreur(404,"Page introuvable.");
 }catch(e){if(!(e instanceof Erreur))console.error("UAZ request failure",e.name, String(e.message).slice(0,250));return json({error:e instanceof Erreur?e.message:"Impossible de traiter cette demande pour le moment. Réessayez."},e instanceof Erreur?e.code:503);}
}
