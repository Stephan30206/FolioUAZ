// Feature order is shared by the training script and the report generator.
const functionWords = {
  fr: "je nous vous on il ils elle les leur ses ceci cette qui que dont avec pour car donc en dans sur peut très plus mais et par comme ainsi ou quand souvent également généralement notamment peut-être mon".split(" "),
  en: "i we you they he she its that this their our can may generally often however therefore furthermore because which whereas also but and by for in of as so very might usually would your my overall sometimes".split(" "),
};
const wordPattern = /[\p{L}\p{M}]+(?:[’'-][\p{L}\p{M}]+)*|\p{N}+/gu;
export function samples(text, maximum = 5) {
  const words = [...text.matchAll(wordPattern)];
  if (words.length < 100) return [];
  const count = Math.min(maximum, Math.ceil(words.length / 180), Math.floor(words.length / 100));
  const width = Math.min(180, Math.floor(words.length / count));
  return Array.from({length: count}, (_, i) => {
    const first = count === 1 ? Math.floor((words.length-width)/2) : Math.round(i*(words.length-width)/(count-1));
    const start = words[first].index, last = words[first+width-1];
    let end = last.index+last[0].length;
    while (end < text.length && /[.,!?:;…)»”]/u.test(text[end])) end++;
    return {start, end, words: width, text: text.slice(start, end)};
  });
}
export function features(text, language) {
  const matches = [...text.matchAll(wordPattern)];
  const tokens = matches.map(x=>x[0].toLowerCase().replaceAll("’","'"));
  const n = tokens.length || 1, freq = new Map();
  for (const token of tokens) freq.set(token, (freq.get(token)||0)+1);
  const count = pattern => (text.match(pattern)||[]).length/n;
  const lengths = tokens.map(t=>t.length), avg = lengths.reduce((a,b)=>a+b,0)/n;
  const sentences = text.split(/[.!?]+/u).map(s=>(s.match(wordPattern)||[]).length).filter(Boolean);
  const meanSentence = n/Math.max(1,sentences.length);
  return [
    avg, Math.sqrt(lengths.reduce((s,w)=>s+(w-avg)**2,0)/n),
    lengths.filter(w=>w>=8).length/n, freq.size/n, [...freq.values()].filter(f=>f===1).length/n,
    meanSentence, Math.sqrt(sentences.reduce((s,v)=>s+(v-meanSentence)**2,0)/Math.max(1,sentences.length)),
    ...[/,/gu, /[;:]/gu, /[!?]/gu, /[()]/gu, /[«»"“”]/gu, /[’']/gu, /-/gu, /\d+/gu].map(count),
    ...functionWords[language].map(w=>(freq.get(w)||0)/n),
  ];
}
