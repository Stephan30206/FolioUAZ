import React,{useRef,useState,useEffect} from "react";
import {Icon,FormField,ProgressDrop,Stage,Notice,Modal,validerFichier,titreFichier,go,api} from "./ui";
export function Depot({espace,reload,parent}:any){
 const [file,setFile]=useState<File|null>(null),[devoirCours,D]=useState(parent?.devoir_cours||"");
 const [consentCorpus,C]=useState(false),[error,E]=useState(""),[busy,B]=useState(false);
 const agenda=espace.agenda||[];
 const requestId=useRef(crypto.randomUUID()), inFlight=useRef(false);
 function charger(f:File){
   const error=validerFichier(f);
   if(error){E(error);return}
   E("");setFile(f);requestId.current=crypto.randomUUID();
 }
 async function lancer(ev:React.FormEvent){
   ev.preventDefault();
   if(inFlight.current)return;
   if(!file||!devoirCours){E("Choisissez un devoir et un fichier.");return}
   inFlight.current=true;B(true);E("");
   try{
     const body=new FormData();
     body.append("fichier",file);
     body.append("donnees",JSON.stringify({id:requestId.current,devoirCours,parent:parent?.id,consentCorpus}));
     const resp=await api("devoirs",{method:"POST",body});
     await reload();go("rapport/"+resp.id);
   }catch(e){E((e as Error).message)}
   finally{inFlight.current=false;B(false)}
 }
 return <div className="columns"><form className="panel upload-panel" onSubmit={lancer}>
  <div className="panel-title"><span className="soft-icon"><Icon name="file-up" size={22}/></span><div><h2>{parent?"Nouvelle version":"Document à analyser"}</h2><p>{parent?"Dossier « "+parent.titre+" » · version "+(parent.version+1):"PDF, Word ou texte : commencez par ajouter votre travail."}</p></div></div>
  <fieldset disabled={busy}><ProgressDrop file={file} disabled={busy} onFile={charger} onClear={()=>{setFile(null);E("")}}/>
  <FormField label="Cours et devoir"><select required disabled={!!parent} value={devoirCours} onChange={e=>D(e.target.value)}>
    <option value="">Choisissez un devoir</option>{agenda.map((d:any)=><option key={d.id} value={d.id}>{d.cours} · {d.titre}</option>)}
  </select></FormField>
  {!agenda.length&&<Notice>Aucun devoir disponible. Le service administratif doit d’abord vous inscrire à un cours comportant un devoir.</Notice>}
  <label className="choice"><input type="checkbox" checked={consentCorpus} onChange={e=>C(e.target.checked)}/>J’autorise le centre à ajouter cette version aux références des futurs devoirs.</label></fieldset>
  {error&&<Notice tone="error">{error}</Notice>}
  <div className="form-bottom"><span><Icon name="lock" size={14}/>Dépôt privé</span><button className="primary" type="submit" disabled={busy||!agenda.length}>{busy?"Analyse en cours…":"Lancer l’analyse"}</button></div>
   </form><aside className="rail"><section className="visual-card"><img src="/media/lecture-ouvrage.webp" alt="" className="book-photo"/><div><h2>Après le dépôt</h2><p>Le centre relit le dossier et peut transmettre le devoir ou demander une correction.</p><button type="button" onClick={()=>go("devoirs")}>Suivre mes devoirs</button></div></section><section className="panel analysis-guide"><div className="analysis-guide-head"><span className="eyebrow">LA MÉTHODE</span><h3>Une analyse, en toute clarté</h3><p>Du document au rapport, chaque résultat reste à interpréter.</p></div><ol><li><span>01</span><div><b>Extraire le texte</b><p>Le contenu lisible de votre fichier est préparé pour la comparaison.</p></div></li><li><span>02</span><div><b>Comparer les passages</b><p>Les mots communs sont recherchés dans le corpus du centre, sans recherche automatique sur le Web.</p></div></li><li><span>03</span><div><b>Examiner les résultats</b><p>Le centre consulte les extraits et leurs sources dans le rapport.</p></div></li></ol><div className="analysis-note"><b>À garder en tête</b><p>Une similitude n’est pas une preuve de plagiat. Les citations et le contexte nécessitent une lecture humaine.</p></div></section></aside></div>
}
export async function ajouterSource(f:File,titre:string,signal:AbortSignal,onProgress:(p:any)=>void,id:string){
 const body=new FormData();body.append("fichier",f);body.append("donnees",JSON.stringify({id,titre}));
 onProgress({label:"Extraction du texte et import…",n:.45});
 return api("sources",{method:"POST",body,signal});
}
