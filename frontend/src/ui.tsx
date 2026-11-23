import React,{useEffect,useRef} from "react";
import icons from "./icon-data.json";
export function Icon({name,size=19,className=""}:{name:string,size?:number,className?:string}){
 const paths=(icons as any)[name]||(name==="help"?[["circle",{cx:12,cy:12,r:9}],["path",{d:"M9.5 9a2.5 2.5 0 0 1 5 .4c0 1.6-2.5 1.9-2.5 3.6m0 3h.01"}]]:(icons as any).info);
 return <svg className={className} aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" width={size} height={size}>{paths.map(([tag,attrs]:any,i:number)=>React.createElement(tag,{...attrs,key:i}))}</svg>;
}
export const etats:Record<string,string>={en_revue:"En revue",reexamen:"En réexamen",incomplet:"À compléter",corriger:"À reprendre",transmis:"Transmis au professeur",disciplinaire:"Orientation disciplinaire",pret:"Prêt à remettre",remis:"Remis"};
export const score=(s:number|null)=>s===null?"Non calculable":new Intl.NumberFormat("fr-FR",{maximumFractionDigits:1}).format(s)+" %";
export const date=(str:string)=>new Intl.DateTimeFormat("fr-FR",{day:"numeric",month:"short",year:"numeric"}).format(new Date(str));
export const octets=(n:number)=>n<1024*1024?Math.max(1,Math.round(n/1024))+" Ko":(n/1048576).toFixed(1).replace(".",",")+" Mo";
export function go(page:string){window.location.hash=page;}
export async function api<T=any>(url:string,options:RequestInit={}):Promise<T>{
 const method=options?.method?.toUpperCase()||"GET";
 const headers=new Headers(options?.headers);
 if(!["GET","HEAD","OPTIONS"].includes(method)){
   const csrf=await fetch("/api/csrf",{credentials:"same-origin",signal:options?.signal});
   if(!csrf.ok)throw new Error("Impossible d’ouvrir la session.");
   const {header,token}=await csrf.json();headers.set(header,token);
 }
 options={...options,headers};
 let res:Response;try{res=await fetch("/api/"+url,{credentials:"same-origin",...options});}catch(e){if((e as Error).name==="AbortError")throw e;throw new Error("Connexion interrompue. Vérifiez votre connexion puis réessayez.");}
 if(res.status===204)return undefined as T;
 const data=await res.json().catch(()=>({error:"Le service ne répond pas. Rechargez la page."}));
 if(!res.ok||data.error)throw Object.assign(new Error(data.error||"La demande a échoué."),{status:res.status});return data;
}
export function Notice({children,tone="info"}:any){return <div className={"notice "+tone} role={tone==="error"?"alert":"status"}><Icon name={tone==="error"?"circle-alert":"info"} size={18}/><div>{children}</div></div>}
export function Modal({title,onClose,children,large=false}:any){
 const ref=useRef<HTMLDialogElement>(null);useEffect(()=>{const el=ref.current;if(el&&!el.open)el.showModal();return()=>el?.close();},[]);
 return <dialog ref={ref} onCancel={e=>{e.preventDefault();onClose()}} className={large?"large":""} onClick={e=>{if(e.target===e.currentTarget)onClose()}}><div className="modal-content"><header><h2>{title}</h2><button type="button" className="iconbutton" aria-label="Fermer" onClick={onClose}><Icon name="x"/></button></header>{children}</div></dialog>;
}
export function Badge({state}:any){return <span className={"badge b-"+state}>{etats[state]||state}</span>}
export function FormField({label,extra,children}:any){return <label className="field"><span>{label} {extra&&<small>{extra}</small>}</span>{children}</label>}
export function Loading({message="Chargement…"}:any){return <div className="loading" role="status"><Icon name="loader-circle" className="spin"/>{message}</div>}
export function Stage({progress}:any){return <div role="status" className="stage"><span><Icon name="loader-circle" className="spin" size={17}/>{progress.label}</span><progress max={1} value={progress.n}/></div>}
export function ProgressDrop({file,onFile,onClear,disabled=false}:any){
 const input=useRef<HTMLInputElement>(null);const [over,setOver]=React.useState(false);
 return <div className={"drop"+(over?" hovering":"")+(file?" filled":"")} onDragOver={e=>{e.preventDefault();if(!disabled)setOver(true)}} onDragLeave={()=>setOver(false)} onDrop={e=>{e.preventDefault();setOver(false);if(!disabled&&e.dataTransfer.files[0])onFile(e.dataTransfer.files[0]);}}>
  <input ref={input} className="sr" type="file" aria-label="Sélectionner le fichier" accept=".pdf,.docx,.txt" disabled={disabled} onChange={e=>{const f=e.target.files?.[0];if(f)onFile(f);e.target.value=""}}/>
  <button type="button" className="drop-target" disabled={disabled} onClick={()=>input.current?.click()} aria-label={file?"Remplacer le fichier":"Choisir un fichier à déposer"}>
   <div className="dropicon"><Icon name={file?"file-text":"cloud-upload"} size={31}/></div>
   {file?<><strong>{file.name}</strong><p>{octets(file.size)} · Cliquer pour remplacer</p></>:<><strong>Glissez votre fichier ici</strong><p>ou <span className="inline-link">parcourez vos fichiers</span></p><div className="formats"><span>PDF</span><span>DOCX</span><span>TXT</span><i>·</i>20 Mo maximum</div></>}
  </button>{file&&!disabled&&<button className="remove" type="button" aria-label="Retirer le fichier" onClick={onClear}><Icon name="x" size={16}/></button>}
 </div>
}
export const validerFichier=(f:File)=>!(/\.(pdf|docx|txt)$/i.test(f.name))?"Choisissez un fichier PDF, DOCX ou TXT.":f.size===0?"Ce fichier est vide.":f.size>20*1024*1024?"Le fichier dépasse la limite de 20 Mo.":"";
export const titreFichier=(f:string)=>f.replace(/\.[^.]+$/,"").replace(/[_-]+/g," ").trim().slice(0,159);
