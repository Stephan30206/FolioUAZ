import React,{useState} from "react";
import {api,FormField,Notice} from "./ui";

const catalogue=[
 ["HAL","Archive ouverte francophone","https://api.hal.science/docs/oai"],
 ["African Journals Online","Revues scientifiques africaines","https://www.ajol.info/"],
 ["SciELO","Réseau de revues en accès ouvert","https://www.scielo.org/"],
 ["OpenAlex","Index bibliographique et repérage de publications","https://help.openalex.org/api/"],
 ["DOAJ","Répertoire de revues ouvertes","https://doaj.org/"],
 ["Wikipédia","Encyclopédie généraliste · exports Wikimedia","https://wikitech.wikimedia.org/wiki/MediaWiki_Content_File_Exports"],
];
export function Catalogue(){
 return <details className="panel supplemental"><summary>Catalogues documentaires à consulter</summary><p>Pour enrichir le corpus UAZ, vérifiez la provenance, la version et les droits d’indexation de chaque texte intégral avant import.</p><ul>{catalogue.map(([nom,type,url])=><li key={nom}><a href={url} target="_blank" rel="noreferrer">{nom}</a> · {type}</li>)}</ul><p>Les analyses comparent les références importées et les devoirs autorisés du corpus interne.</p></details>;
}
export function Tableau({espace}:any){
 const own=espace.devoirs||[], review=espace.revue||[];
 const groupes=espace.centre?[
 ["Dossiers à examiner",review.filter((d:any)=>d.etat==="en_revue").length,"centre"],
 ["Réexamens",review.filter((d:any)=>d.etat==="reexamen").length,"decisions"],
 ["Transmis au professeur",review.filter((d:any)=>d.etat==="transmis").length,"decisions"]
 ]:[
 ["Mes dépôts",own.length,"devoirs"],
 ["En revue",own.filter((d:any)=>["en_revue","reexamen"].includes(d.etat)).length,"devoirs"],
 ["À reprendre",own.filter((d:any)=>d.etat==="corriger").length,"devoirs"]
 ];
 return <div className="source-grid">{groupes.map(([label,n,route])=><a key={label} className="panel source-card" href={"#"+route}><h2>{label}</h2><strong className="metric-number">{n}</strong></a>)}</div>;
}
export function Administration({espace,reload}:any){
 const c=espace.config;
 const [bas,B]=useState(String(c.bas??"")),[moyen,M]=useState(String(c.moyen??""));
 const [minimum,N]=useState(c.minimum),[conservation,K]=useState(String(c.conservation??"")),[citations,C]=useState(c.citations),[bibliographie,G]=useState(c.bibliographie);
 const [retour,R]=useState(""),[busy,W]=useState(false),[error,E]=useState(false);
 async function save(e:React.FormEvent){
  e.preventDefault();if(busy)return;W(true);R("");E(false);
  try{await api("configuration",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({bas:bas===""?null:Number(bas),moyen:moyen===""?null:Number(moyen),minimum,citations,bibliographie,conservation:conservation===""?null:Number(conservation)})});await reload();R("Paramètres enregistrés. Les exclusions par défaut s’appliquent aux nouveaux dépôts.");}catch(error){E(true);R((error as Error).message)}finally{W(false)}
 }
 return <><section className="panel supplemental"><h2>Seuils de routage et exclusions</h2><p>Les seuils servent à classer les dossiers pour la relecture. Laissez les deux champs vides pour désactiver la priorité.</p><form onSubmit={save}>
 <div className="row-fields"><FormField label="Priorité basse jusqu’à (%)"><input type="number" min="0" max="100" value={bas} onChange={e=>B(e.target.value)}/></FormField><FormField label="Priorité normale jusqu’à (%)"><input type="number" min="0" max="100" value={moyen} onChange={e=>M(e.target.value)}/></FormField></div>
 <label className="choice"><input type="checkbox" checked={citations} onChange={e=>C(e.target.checked)}/>Exclure les passages entre guillemets</label>
 <label className="choice"><input type="checkbox" checked={bibliographie} onChange={e=>G(e.target.checked)}/>Exclure la bibliographie</label>
 <FormField label="Longueur minimale des correspondances (mots)"><input type="number" min="8" max="100" required value={minimum} onChange={e=>N(e.target.valueAsNumber)}/></FormField>
 <FormField label="Durée de conservation envisagée (mois)"><input type="number" min="1" max="240" value={conservation} onChange={e=>K(e.target.value)}/></FormField><p className="fine">Ce réglage documente la durée retenue. La purge automatique est à configurer.</p>
 {retour&&<Notice tone={error?"error":undefined}>{retour}</Notice>}<button className="primary" disabled={busy}>Enregistrer les paramètres</button></form></section><Gestion espace={espace} reload={reload}/><Catalogue/></>;
}
export function Gestion({espace,reload}:any){
 const [message,M]=useState(""),[erreur,E]=useState(false),[busy,B]=useState(false);
 async function inscrire(e:React.FormEvent<HTMLFormElement>){
  e.preventDefault();if(busy)return;
  const body=Object.fromEntries(new FormData(e.currentTarget));B(true);M("");E(false);
  try{await api("inscriptions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});M("Inscription enregistrée.");}
  catch(error){E(true);M((error as Error).message)}finally{B(false)}
 }
 async function envoyer(e:React.FormEvent<HTMLFormElement>,gestionRoles:boolean){
  e.preventDefault();if(busy)return;
  const form=e.currentTarget,champs=Object.fromEntries(new FormData(form));
  B(true);M("");E(false);
  try{
   await api(gestionRoles?"roles":"cours",{method:gestionRoles?"PUT":"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(gestionRoles?champs:{...champs,maximum:Number(champs.maximum)})});
   await reload();form.reset();M(gestionRoles?"Rôle enregistré.":"Devoir publié dans les dépôts.");
  }catch(error){E(true);M((error as Error).message)}finally{B(false)}
 }
 return <>
 {message&&<Notice tone={erreur?"error":undefined}>{message}</Notice>}
 <section className="panel supplemental"><h2>Utilisateurs et rôles</h2><p>Créez les comptes de l’Université et attribuez-leur un rôle.</p>
 <form onSubmit={e=>envoyer(e,true)}><div className="row-fields"><FormField label="Nom complet"><input name="nom" maxLength={120} required/></FormField><FormField label="Adresse du compte"><input type="email" name="email" maxLength={160} required/></FormField>
 <FormField label="Rôle"><select name="role"><option value="etudiant">Étudiant</option><option value="centre">Relecteur du centre</option><option value="professeur">Professeur</option><option value="admin">Administrateur</option></select></FormField></div><FormField label="Mot de passe initial (12 caractères minimum)"><input type="password" name="password" minLength={12} maxLength={72} autoComplete="new-password"/></FormField><button className="primary" disabled={busy}>Enregistrer le compte</button></form>
 {espace.roles?.length>0&&<div className="tablewrap"><table><thead><tr><th>Adresse</th><th>Rôle attribué</th></tr></thead><tbody>{espace.roles.map((item:any)=><tr key={item.email}><td>{item.email}</td><td>{({etudiant:"Étudiant",centre:"Relecteur du centre",professeur:"Professeur",admin:"Administrateur"} as any)[item.role]}</td></tr>)}</tbody></table></div>}</section>
 <section className="panel supplemental"><h2>Cours et devoirs</h2>
 <form onSubmit={e=>envoyer(e,false)}><div className="row-fields"><FormField label="Cours"><input name="cours" maxLength={120} required/></FormField><FormField label="Titre du devoir"><input name="titre" maxLength={160} required/></FormField></div>
 <div className="row-fields"><FormField label="Adresse du professeur"><input type="email" name="professeur" maxLength={160} required/></FormField><FormField label="Date limite (facultative)"><input type="date" name="echeance"/></FormField></div>
 <FormField label="Nombre maximal de dépôts par étudiant"><input type="number" name="maximum" min="1" max="100" required/></FormField><button className="primary" disabled={busy}>Créer le devoir</button></form>
 {espace.agenda?.length>0&&<div className="tablewrap"><table><thead><tr><th>Cours</th><th>Devoir</th><th>Échéance</th><th>Dépôts max.</th></tr></thead><tbody>{espace.agenda.map((d:any)=><tr key={d.id}><td>{d.cours}</td><td>{d.titre}</td><td>{d.echeance||"—"}</td><td>{d.maximum}</td></tr>)}</tbody></table></div>}</section>
 <section className="panel supplemental"><h2>Inscrire un étudiant</h2><form onSubmit={inscrire}>
 <FormField label="Cours"><select name="cours" required><option value="">Sélectionner</option>{(espace.cours||[]).map((c:any)=><option key={c.id} value={c.id}>{c.nom}</option>)}</select></FormField>
 <FormField label="Étudiant"><select name="email" required><option value="">Sélectionner</option>{(espace.roles||[]).filter((u:any)=>u.role==="etudiant").map((u:any)=><option key={u.email} value={u.email}>{u.nom}</option>)}</select></FormField>
 <button className="primary" disabled={busy}>Inscrire au cours</button></form></section></>;
}
