import React,{useRef,useState,useEffect} from "react";
import {Icon,FormField,ProgressDrop,Stage,Notice,Modal,validerFichier,titreFichier,go,api} from "./ui";
import {sourcesExemple,texteExemple} from "../public/corpus.mjs";
import {textePourSemantique} from "../public/moteur.mjs";
const lire=()=>import(/* @vite-ignore */ "/lecture.mjs");
const sem=()=>import(/* @vite-ignore */ "/semantique.mjs");
export function Depot({espace,reload,parent}:any){
 const [file,setFile]=useState<File|null>(null),[titre,T]=useState(parent?.titre||""),[etudiant,E]=useState(parent?.etudiant||""),[prof,P]=useState(parent?.professeur||"");
 const [idDevoir,ID]=useState(parent?.devoir_cours||"");
 const agenda=espace.agenda||[], fiche=agenda.find((d:any)=>d.id===idDevoir);
 const [model,M]=useState("off"),[bibliographie,B]=useState(espace.config?.bibliographie??true),[citations,C]=useState(espace.config?.citations??false),[settings,S]=useState(false),[pick,Q]=useState(false);
 const [langueIndice,setLangueIndice]=useState(""),[consentCorpus,consentir]=useState(false);
 const [error,X]=useState(""),[prog,G]=useState<any>(null),[omits,O]=useState<string[]>([]);
 const abort=useRef<AbortController|null>(null),ident=useRef(crypto.randomUUID()),busy=useRef(false);
 const all=[...espace.sources.filter((s:any)=>!parent||!s.dossier||s.dossier!==parent.dossier).map((s:any)=>({id:s.id,title:s.titre,kind:s.protection?"Archive · comparaison exacte":"Source importée",protection:!!s.protection})),...sourcesExemple.map(s=>({...s,kind:"Document d’exemple"}))];
 const selection=all.filter(s=>!omits.includes(s.id));
 useEffect(()=>()=>abort.current?.abort(),[]);
 function charger(f:File){const err=validerFichier(f);if(err){X(err);return}X("");if(!parent&&(!titre||titre===titreFichier(file?.name||"")))T(titreFichier(f.name));setFile(f);ident.current=crypto.randomUUID();}
 async function lancer(ev:React.FormEvent){ev.preventDefault();if(busy.current)return;
  if(!file||!selection.length||!(fiche?.titre||titre).trim()){X(!file?"Ajoutez le fichier du devoir pour lancer l’analyse.":!selection.length?"Sélectionnez une source de comparaison.":"Indiquez un titre pour le devoir.");return}
  X("");busy.current=true;const ctl=new AbortController();abort.current=ctl;const {signal}=ctl;
  const update=(n:number,label:string)=>{if(!signal.aborted)G({n,label})};update(.02,"Lecture du document…");
  try{
   const {lireDocument}=await lire();const doc=await lireDocument(file,{signal,onProgress:(x:any)=>update(.03+.29*(x.progress||0),x.detail||"Extraction du texte…")});
   let semantic:any={status:"off"};
   if(model!=="off"){
    update(.34,"Préparation des sources pour l’IA…");
    try{
     const lisibles=selection.filter(s=>!s.protection);
     if(!lisibles.length)throw new Error("Les sources sélectionnées sont des devoirs archivés. Leur contenu est réservé au centre. Ajoutez une référence consultable pour comparer le sens des passages.");
     const refs=await Promise.all(lisibles.map(async s=>s.text?s:await api("sources/"+s.id,{signal})));
     const references=refs.map(s=>({...s,text:textePourSemantique(s.text,{bibliographie,citations})}));
     const {analyzeSemantic}=await sem();
     const result=await analyzeSemantic({text:textePourSemantique(doc.text,{bibliographie,citations}),sources:references,model,signal,onProgress:(p:any)=>update(.34+.48*(p.fraction||0),p.message)});
     semantic={status:"done",model:result.modelLabel,matches:result.matches,coverage:result.coverage};
    }catch(e){if(signal.aborted)throw e;semantic={status:"unavailable",message:(e as Error).message};}
   }
   signal.throwIfAborted();update(.88,"Comparaison avec les sources et enregistrement du rapport…");
   const form=new FormData();form.append("fichier",file);form.append("donnees",JSON.stringify({id:ident.current,text:doc.text,titre:fiche?.titre||titre,devoirCours:idDevoir||undefined,etudiant,professeur:prof,parent:parent?.id,sources:selection.map(s=>s.id),options:{bibliographie,citations},warnings:doc.warnings||[],partial:doc.partial,semantic,langueIndice,consentCorpus}));
   const resp=await api("devoirs",{method:"POST",body:form,signal});await reload();go("rapport/"+resp.id);
  }catch(e){if(!signal.aborted)X((e as Error).message);else X("Analyse annulée. Votre fichier reste sélectionné.");}
  finally{busy.current=false;abort.current=null;G(null);}
 }
 return <div className="columns"><form className="panel upload-panel" onSubmit={lancer}>
  <div className="panel-title"><span className="soft-icon"><Icon name="file-up" size={22}/></span><div><h2>{parent?"Nouvelle version":"Document à analyser"}</h2><p>{parent?"Dossier « "+parent.titre+" » · version "+(parent.version+1):"Ajoutez le fichier de votre devoir."}</p></div></div>
  <fieldset disabled={!!prog}><ProgressDrop file={file} disabled={!!prog} onFile={charger} onClear={()=>{setFile(null);X("")}}/>
  {!file&&!parent&&<button type="button" className="sample" onClick={()=>{charger(new File([texteExemple],"Relevé de la rivière.txt",{type:"text/plain"}));}}><Icon name="flask-conical" size={15}/>Essayer avec un fichier d’exemple</button>}
  <div className="inputs">{(agenda.length>0||idDevoir)&&<FormField label="Cours et devoir"><select disabled={!!parent} value={idDevoir} onChange={e=>ID(e.target.value)}><option value="">Dépôt libre</option>{agenda.map((d:any)=><option key={d.id} value={d.id}>{d.cours} · {d.titre}</option>)}</select></FormField>}{!fiche&&<FormField label="Titre du devoir"><input value={titre} onChange={e=>T(e.target.value)} maxLength={160} placeholder="Ex. Rapport de méthodologie" readOnly={!!parent}/></FormField>}
  <div className="row-fields"><FormField label="Étudiant" extra="(facultatif)"><input maxLength={120} value={etudiant} onChange={e=>E(e.target.value)} placeholder="Nom et prénom" readOnly={!!parent}/></FormField>
   {!fiche&&<FormField label="Enseignant" extra="(facultatif)"><input maxLength={120} value={prof} onChange={e=>P(e.target.value)} placeholder="Adresse institutionnelle ou nom" readOnly={!!parent}/></FormField>}</div></div>
  <label className="ai-switch"><Icon name="sparkles" size={20}/><span><b>Rechercher les reformulations avec l’IA</b><small>Comparer aussi le sens des passages</small></span><input type="checkbox" role="switch" checked={model!=="off"} onChange={e=>M(e.target.checked?"minilm":"off")}/><i aria-hidden="true"/></label>
  {model!=="off"&&<div className="ai-config"><FormField label="Modèle sémantique"><select value={model} onChange={e=>M(e.target.value)}><option value="minilm">MiniLM multilingue · Sentence Transformers</option><option value="labse">LaBSE · comparaison multilingue</option></select></FormField>
  <p className="fine">{model==="minilm"?"Premier chargement d’environ 135 Mo de modèle et vocabulaire, puis mise en cache par le navigateur.":"Premier chargement d’environ 490 Mo de modèle et vocabulaire. Prévoir une connexion stable."}</p></div>}
  <label className="choice style-choice"><input type="checkbox" checked={!!langueIndice} onChange={e=>setLangueIndice(e.target.checked?"fr":"")}/><span><b>Examiner l’indice de rédaction par IA</b><small>Expérimental · indépendant du score de similitude</small></span></label>
  {langueIndice&&<div className="ai-config"><FormField label="Langue principale du devoir"><select value={langueIndice} onChange={e=>setLangueIndice(e.target.value)}><option value="fr">Français</option><option value="en">Anglais</option><option value="mg">Malgache</option></select></FormField><p className="fine">{langueIndice==="mg"?"Indice indisponible en malgache. La comparaison avec les sources reste accessible.":"À partir de 100 mots. Le rapport indique les limites de cette estimation expérimentale."}</p></div>}
  <div className="settings"><button type="button" className="settings-toggle" aria-expanded={settings} onClick={()=>S(!settings)}><Icon name="sliders-horizontal" size={17}/><b>Sources et exclusions</b><span>{selection.length} source{selection.length>1?"s":""}</span><Icon className={settings?"down":"chev"} name="chevron-right" size={16}/></button>
  {settings&&<div className="settings-body">
  <label className="choice"><input type="checkbox" checked={bibliographie} onChange={e=>B(e.target.checked)}/>Exclure la bibliographie</label><label className="choice"><input type="checkbox" checked={citations} onChange={e=>C(e.target.checked)}/>Exclure les passages entre guillemets</label>
  <label className="choice"><input type="checkbox" checked={consentCorpus} onChange={e=>consentir(e.target.checked)}/>J’autorise le centre à ajouter cette version aux références des futurs devoirs.</label>{selection.some(s=>s.protection)&&<p className="fine">Les devoirs archivés sont comparés mot pour mot. La recherche de reformulations porte sur les références consultables.</p>}<button type="button" className="text-button" onClick={()=>Q(true)}><Icon name="library-big" size={16}/>Choisir les sources ({selection.length})</button></div>}</div></fieldset>
  {error&&<Notice tone="error">{error}</Notice>}{prog&&<Stage progress={prog}/>}
  <div className="form-bottom"><span><Icon name="lock" size={14}/>Dépôt privé</span>{prog?<button type="button" className="secondary" onClick={()=>abort.current?.abort()}>Annuler</button>:<button className="primary" type="submit"><Icon name="scan-text" size={18}/>Lancer l’analyse</button>}</div>
 </form><aside className="rail"><section className="visual-card"><img src="/media/lecture-ouvrage.webp" alt="" className="book-photo"/><div><span className="guide-tag"><Icon name="book-open" size={14}/> Guide de lecture</span><h2>Comprendre le rapport</h2><p>Repérez les passages communs et retrouvez leur source.</p><button onClick={()=>go("exemple")}><Icon name="eye" size={16}/>Voir un rapport d’exemple</button></div></section>
 <section className="panel rail-card"><span className="soft-icon cream"><Icon name="library-big" size={21}/></span><h3>Corpus de référence</h3><p><b>{selection.length} source{selection.length>1?"s":""}</b> sélectionnée{selection.length>1?"s":""} pour cette analyse.</p><button className="text-button" type="button" disabled={!!prog} onClick={()=>Q(true)}>Consulter les sources <Icon name="chevron-right" size={15}/></button></section></aside>
 {pick&&<Modal title="Sources de comparaison" onClose={()=>Q(false)}><p>Cochez les textes à comparer avec ce devoir.</p><div className="source-checks">{all.map(s=><label className="choice" key={s.id}><input type="checkbox" checked={!omits.includes(s.id)} onChange={e=>O(a=>e.target.checked?a.filter(id=>id!==s.id):[...a,s.id])}/><span><b>{s.title}</b><small>{s.kind}</small></span></label>)}</div><button className="primary" type="button" onClick={()=>Q(false)}>Valider la sélection</button></Modal>}</div>
}

export async function ajouterSource(f:File,titre:string,signal:AbortSignal,onProgress:(p:any)=>void,id:string){
 const {lireDocument}=await lire();const doc=await lireDocument(f,{signal,onProgress:(p:any)=>onProgress({label:p.detail||"Lecture de la source…",n:p.progress*.8})});
 if(doc.partial)throw new Error("La source est partiellement lisible. Importez une version textuelle complète.");
 const body=new FormData();body.append("fichier",f);body.append("donnees",JSON.stringify({id,titre,text:doc.text}));
 onProgress({label:"Enregistrement de la source…",n:.9});return api("sources",{method:"POST",body,signal});
}
