import React,{useState,useEffect} from "react";
import {createRoot} from "react-dom/client";
import {Icon,Modal,Notice,Loading,go,api} from "./ui";
import {Depot} from "./depot";
import {Liste,Sources,Rapport} from "./pages";
import {Administration,Tableau,Catalogue} from "./espaces";
const paths=[{id:"tableau",name:"Tableau de bord",ic:"files"},{id:"depot",name:"Nouveau dépôt",ic:"file-up"},{id:"devoirs",name:"Mes devoirs",ic:"files"},{id:"sources",name:"Sources de référence",ic:"library-big"},{id:"centre",name:"Revue du centre",ic:"clipboard-check"},{id:"decisions",name:"Décisions et recours",ic:"clipboard-check"},{id:"transmis",name:"Devoirs transmis",ic:"files"},{id:"administration",name:"Administration",ic:"sliders-horizontal"}];
const titles:Record<string,[string,string]>={tableau:["Tableau de bord","Retrouvez l’état des dossiers de votre espace."],decisions:["Décisions et recours","Retrouvez les dossiers traités et les demandes de réexamen."],transmis:["Devoirs transmis","Ouvrez les rapports transmis par le centre en lecture seule."],administration:["Administration","Réglez la priorité de relecture et les exclusions par défaut."],depot:["Analyser un document","Déposez votre travail et comparez-le aux sources de votre corpus."],devoirs:["Mes devoirs","Retrouvez vos dépôts, leurs versions et les rapports de similitude."],sources:["Sources de référence","Constituez le corpus auquel vos devoirs seront comparés."],centre:["Revue du centre","Examinez les travaux en attente et motivez la décision de remise."],revision:["Déposer une révision","La nouvelle version sera analysée et soumise à une nouvelle décision."],rapport:["Rapport du devoir","Consultez les passages retrouvés et les sources qui leur correspondent."],};
function useRoute(){const [route,R]=useState(()=>location.hash.slice(1)||"depot");useEffect(()=>{const f=()=>{R(location.hash.slice(1)||"depot");scrollTo(0,0)};window.addEventListener("hashchange",f);return()=>window.removeEventListener("hashchange",f)},[]);return route;}
function App(){
 const route=useRoute(),[raw,id]=route.split("/"),page=titles[raw]?raw:"depot";
 const [connexion,Connexion]=useState(false),[loginBusy,LB]=useState(false);
 const [espace,set]=useState<any>({nom:"",centre:false,devoirs:[],revue:[],transmis:[],sources:[]}),[ready,Ready]=useState(false),[err,E]=useState(""),[guide,H]=useState(false),[menu,N]=useState(false);
 async function reload(){try{const e=await api("espace");set(e);Ready(true);Connexion(false);E("");return e;}catch(e){if((e as any).status===401){Connexion(true);Ready(false);}else E((e as Error).message);return null}}
 useEffect(()=>{void reload()},[]);
 useEffect(()=>{N(false);document.title=titles[page][0]+" · AcadCheck"},[page,id]);
 const active=page==="rapport"?"devoirs":page==="revision"?"depot":page;
 const account=espace.nom||"Espace privé",initials=espace.nom?espace.nom.split(/\s+/).slice(0,2).map((s:string)=>s[0]).join("").toLocaleUpperCase():"U";
 const waiting=(espace.revue||[]).filter((d:any)=>["en_revue","reexamen"].includes(d.etat)).length;
 const help=<><p>Les étudiants déposent un fichier PDF, DOCX ou TXT pour un devoir de leur cours.</p><p>Le centre relit les passages communs et motive sa décision. Le professeur consulte ensuite les versions qui lui ont été transmises.</p></>;
 async function entrer(e:React.FormEvent<HTMLFormElement>){
  e.preventDefault();LB(true);E("");
  const f=new FormData(e.currentTarget);
  try{
   await api("session",{method:"POST",body:new URLSearchParams({username:String(f.get("email")),password:String(f.get("password"))})});
   const compte=await reload();if(compte)go(compte.admin?"administration":"tableau");
  }catch(e){E((e as Error).message)}finally{LB(false)}
 }
 async function sortir(){
  try{await api("deconnexion",{method:"POST"});set({nom:"",devoirs:[],revue:[],transmis:[],sources:[]});Ready(false);Connexion(true);E("");}catch(e){E((e as Error).message)}
 }
 if(connexion)return <main className="login"><form className="panel supplemental" onSubmit={entrer}>
  <h1>AcadCheck</h1><p>Université Adventiste Zurcher</p>
  <label>Adresse électronique<input type="email" name="email" autoComplete="username" required/></label>
  <label>Mot de passe<input type="password" name="password" autoComplete="current-password" required/></label>
  {err&&<Notice tone="error">{err}</Notice>}<button className="primary" disabled={loginBusy}>Se connecter</button>
 </form></main>;
 return <div className="shell"><a className="skip" href="#contenu" onClick={e=>{e.preventDefault();document.getElementById("contenu")?.focus()}}>Aller au contenu</a>{menu&&<button type="button" className="mobile-shade" aria-label="Fermer le menu" onClick={()=>N(false)}/>}
 <aside className={"sidebar"+(menu?" open":"")}><a href="#depot" className="brand" aria-label="AcadCheck, accueil"><span className="emblem"><Icon name="book-open" size={26}/></span><div>Acad<span>Check</span></div></a><div className="side-line"/>
 <div className="nav-label">ESPACE DE TRAVAIL</div><nav aria-label="Navigation principale">{paths.filter(p=>(["centre","decisions"].includes(p.id)?espace.centre:p.id==="transmis"?espace.enseignant:p.id==="administration"?espace.admin:p.id==="sources"?espace.admin||espace.centre:["depot","devoirs"].includes(p.id)?espace.role==="etudiant":true)).map(p=><a href={"#"+p.id} key={p.id} className={active===p.id?"active":""} aria-current={active===p.id?"page":undefined} onClick={()=>N(false)}><Icon name={p.ic} size={20}/><span>{p.name}</span>{p.id==="centre"&&waiting>0&&<small>{waiting}</small>}</a>)}</nav>
 <div className="side-bottom">{ready&&<button onClick={sortir}>Se déconnecter</button>}<button onClick={()=>{N(false);H(true)}}><Icon name="help" size={19}/>Aide et utilisation</button><div className="side-line"/><div className="identity"><span className="user-circle">{initials}</span><div><b>{account}</b><small>{espace.admin?"Administration":espace.centre?"Centre de recherche":espace.enseignant?"Professeur":"Espace étudiant"}</small></div></div></div></aside>
 <div className="workspace"><header className="topbar"><div><button className="mobile-menu iconbutton" onClick={()=>N(!menu)} aria-label="Ouvrir le menu"><Icon name="menu"/></button><span className="crumb">Espace de travail</span><Icon name="chevron-right" size={13}/><b>{page==="rapport"?"Rapport":page==="revision"?"Révision":paths.find(p=>p.id===page)?.name}</b></div><button className="top-help" onClick={()=>H(true)}><Icon name="help" size={17}/><span>Guide d’utilisation</span></button></header>
 <main id="contenu" tabIndex={-1}><div className="page-head"><div className="kicker"><span className="kicker-line"/>ANALYSE DOCUMENTAIRE · ACADCHECK</div><h1>{titles[page][0]}</h1><p>{titles[page][1]}</p></div>
 {err&&<Notice tone="error">{err} <button className="text-button" onClick={reload}>Réessayer</button></Notice>}
 {page==="depot"&&(ready?(espace.role==="etudiant"?<Depot key="new" espace={espace} reload={reload}/>:<Tableau espace={espace}/>):!err&&<Loading/>)}
 {page==="revision"&&(ready?(espace.devoirs.some((d:any)=>d.id===id)?<Depot key={id} parent={espace.devoirs.find((d:any)=>d.id===id)} espace={espace} reload={reload}/>:<Notice>Ce dossier est introuvable.</Notice>):<Loading/>)}
 {(page==="devoirs"||page==="centre")&&(ready?<>{page==="centre"&&!espace.centre?<Notice>La revue des dossiers est réservée au centre de recherche.</Notice>:<Liste key={page} items={page==="centre"?espace.revue:espace.devoirs} centre={page==="centre"} config={espace.config} agenda={espace.agenda}/>}</>:!err&&<Loading/>)}
 {page==="sources"&&ready&&(espace.admin||espace.centre)&&<><Sources reload={reload} espace={espace}/>{espace.centre&&<Catalogue/>}</>}
 {ready&&page==="tableau"&&<Tableau espace={espace}/>}
 {ready&&page==="decisions"&&(espace.centre?<Liste items={espace.revue.filter((d:any)=>!["en_revue","incomplet"].includes(d.etat))} config={espace.config}/>:<Notice>Accès réservé au centre de recherche.</Notice>)}
 {ready&&page==="transmis"&&(espace.enseignant?<Liste items={espace.transmis}/>:<Notice>Accès réservé aux professeurs habilités.</Notice>)}
 {ready&&page==="administration"&&(espace.admin?<Administration espace={espace} reload={reload}/>:<Notice>Accès réservé à l’administration.</Notice>)}
 {page==="rapport"&&ready&&<Rapport key={page+id} id={id} espace={espace} reload={reload}/>}
 </main><footer><span>AcadCheck</span><span>Centre de recherche · Intégrité académique</span></footer></div>
 {guide&&<Modal title="Guide d’utilisation" onClose={()=>H(false)}>{help}</Modal>}</div>
}
createRoot(document.getElementById("root")!).render(<App/>);
