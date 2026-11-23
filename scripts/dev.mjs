import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import {api} from "../src/api.mjs";
import {bindings} from "./local-store.mjs";
const portArg=process.argv.indexOf("--port"),port=Number(process.env.PORT||(portArg>=0?process.argv[portArg+1]:5173));
const env=bindings(".sites-runtime/local");
env.UAZ_RELECTEURS="centre@example.test";
const mime={html:"text/html; charset=utf-8",js:"application/javascript",mjs:"application/javascript",css:"text/css",woff2:"font/woff2",webp:"image/webp",wasm:"application/wasm",json:"application/json",gz:"application/gzip"};
http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,req.headers.origin||"http://"+req.headers.host);
 if(url.pathname.startsWith("/api/")){
  const headers=new Headers();for(const [k,v] of Object.entries(req.headers))if(typeof v==="string")headers.set(k,v);
  if(!headers.get("oai-authenticated-user-id")){headers.set("oai-authenticated-user-id","compte-de-test-local");headers.set("oai-authenticated-user-full-name","Centre UAZ");headers.set("oai-authenticated-user-email","centre@example.test");}
  const parts=[];for await(const chunk of req)parts.push(chunk);
  const request=new Request(url,{method:req.method,headers,...(!["GET","HEAD"].includes(req.method)?{body:Buffer.concat(parts)}:{})});
  const response=await api(request,env);
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
 }
 const base=path.resolve("dist/client"),local=path.resolve(base,"."+decodeURIComponent(url.pathname==="/"?"/index.html":url.pathname));
 if(!local.startsWith(base+path.sep)){res.writeHead(404).end();return}
 const data=await fs.readFile(local);res.writeHead(200,{"Content-Type":mime[local.split(".").pop()]||"application/octet-stream"});res.end(data);
 }catch{res.writeHead(404).end("Ressource introuvable.");}
}).listen(port,"127.0.0.1",()=>console.log("Folio UAZ disponible sur le port",port));
