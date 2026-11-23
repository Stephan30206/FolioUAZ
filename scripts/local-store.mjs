import fs from "node:fs/promises";
import {readFileSync,readdirSync,mkdirSync} from "node:fs";
import path from "node:path";
import {DatabaseSync} from "node:sqlite";
export function bindings(dir){
 mkdirSync(dir,{recursive:true});const sqlite=new DatabaseSync(path.join(dir,"folio.db"));sqlite.exec("PRAGMA foreign_keys=ON");
 sqlite.exec("CREATE TABLE IF NOT EXISTS applied_migrations(name TEXT PRIMARY KEY)");
 for(const name of readdirSync("drizzle").filter(n=>n.endsWith(".sql")).sort()){
  if(sqlite.prepare("select 1 from applied_migrations where name=?").get(name))continue;
  sqlite.exec("BEGIN");try{sqlite.exec(readFileSync("drizzle/"+name,"utf8"));sqlite.prepare("INSERT INTO applied_migrations VALUES(?)").run(name);sqlite.exec("COMMIT");}catch(e){sqlite.exec("ROLLBACK");throw e;}
 }
 function stmt(q,args=[]){return {bind(...a){return stmt(q,a)},first(){return sqlite.prepare(q).get(...args)||null},all(){return {results:sqlite.prepare(q).all(...args)}},run(){const a=sqlite.prepare(q).run(...args);return {meta:{changes:a.changes}}}}}
 const DB={prepare:stmt,batch(statements){sqlite.exec("BEGIN");try{const r=statements.map(s=>s.run());sqlite.exec("COMMIT");return r;}catch(e){sqlite.exec("ROLLBACK");throw e;}}};
 const BUCKET={async put(key,v){const p=path.join(dir,"documents",key);await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,typeof v==="string"?v:Buffer.from(v));},async get(key){let v;try{v=await fs.readFile(path.join(dir,"documents",key));}catch{return null}return {body:v,json:()=>JSON.parse(v.toString("utf8"))};},async delete(key){await fs.rm(path.join(dir,"documents",key),{force:true});}};
 return {DB,BUCKET,close:()=>sqlite.close()};
}
