import readline from "node:readline";
import {createHash} from "node:crypto";
import {features, samples} from "../src/style-features.mjs";
const language=process.argv[2];
for await (const line of readline.createInterface({input:process.stdin, crlfDelay:Infinity})) {
  if (!line.trim()) continue;
  const row=JSON.parse(line);
  const sample=samples(row.text,1)[0];
  if (sample) {
    const fingerprint=createHash("sha256").update(sample.text.toLowerCase().replace(/\s+/gu," ").trim()).digest("hex");
    console.log(JSON.stringify([row.source+":"+row.id, fingerprint, Number(!row.is_human), features(sample.text,language)]));
  }
}
