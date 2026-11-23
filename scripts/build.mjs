import fs from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {build} from "esbuild";
const root=new URL("../",import.meta.url);process.chdir(fileURLToPath(root));
await fs.mkdir("dist/client",{recursive:true});await fs.mkdir("dist/server",{recursive:true});await fs.mkdir("dist/.openai",{recursive:true});
await fs.cp("public","dist/client",{recursive:true});
await fs.copyFile("node_modules/@fontsource/baskervville/files/baskervville-latin-400-normal.woff2","dist/client/media/baskervville.woff2");
await fs.copyFile("node_modules/@fontsource/baskervville/LICENSE","dist/client/media/LICENCE-baskervville.txt");
await build({entryPoints:["src/app.tsx"],outfile:"dist/client/app.js",bundle:true,format:"esm",jsx:"automatic",target:"es2022",minify:true,legalComments:"eof",external:["/lecture.mjs","/semantique.mjs"],define:{"process.env.NODE_ENV":'"production"'}});
const types={".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"text/javascript; charset=utf-8",".mjs":"text/javascript; charset=utf-8",".woff2":"font/woff2",".webp":"image/webp"};
const embedded={};
for(const p of ["index.html","style.css","app.js","corpus.mjs","moteur.mjs","lecture.mjs","semantique.mjs","media/lecture-ouvrage.webp","media/inter.woff2","media/baskervville.woff2"]){
 const ext=path.extname(p),bin=[".webp",".woff2"].includes(ext);embedded[p]=[types[ext],bin?"base64":"text",(await fs.readFile("dist/client/"+p)).toString(bin?"base64":"utf8")];
}
await fs.writeFile("src/embedded.generated.mjs","export const embedded="+JSON.stringify(embedded)+";\n");
await build({entryPoints:["src/worker.mjs"],outfile:"dist/server/index.js",bundle:true,format:"esm",target:"es2022",minify:true});
await fs.copyFile(".openai/hosting.json","dist/.openai/hosting.json");
await fs.writeFile("dist/server/wrangler.json",JSON.stringify({name:"folio-uaz",main:"index.js",compatibility_date:"2026-05-15",assets:{directory:"../client",binding:"ASSETS"},d1_databases:[{binding:"DB",database_name:"folio",database_id:"00000000-0000-4000-8000-000000000000"}],r2_buckets:[{binding:"BUCKET",bucket_name:"folio-documents"}]}));
console.log("Interface React et API prêtes.");
