import {api} from "./api.mjs";
import {embedded} from "./embedded.generated.mjs";
export default { async fetch(req,env){
 const path=new URL(req.url).pathname;
 if(path.startsWith("/api/"))return api(req,env);
 if(req.method!=="GET"&&req.method!=="HEAD")return new Response(null,{status:405});
 const key=path==="/"?"index.html":path.slice(1), asset=embedded[key];
 if(asset){const [type,encoding,data]=asset;let body=data;if(encoding==="base64")body=Uint8Array.from(atob(data),ch=>ch.charCodeAt(0));return new Response(req.method==="HEAD"?null:body,{headers:{"Content-Type":type,"Cache-Control":key==="index.html"?"no-cache":"public, max-age=300","X-Content-Type-Options":"nosniff"}})}
 if(env.ASSETS){return env.ASSETS.fetch(req);}
 return new Response("Ressource introuvable.",{status:404});
}};
