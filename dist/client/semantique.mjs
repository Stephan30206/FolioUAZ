/*
 * Local Sentence Transformers inference; only immutable model/runtime assets
 * are downloaded. Document text is exchanged with a same-origin Web Worker.
 */
const RUNTIME = new URL("./vendor/nlp/", import.meta.url).href;
const HEAD_REVISION = "836121a0533e5664b21c7aacc5d22951f2b8b25b";
const HEAD_URL = `https://huggingface.co/sentence-transformers/LaBSE/resolve/${HEAD_REVISION}/2_Dense/model.safetensors`;

export const SEMANTIC_MODELS = Object.freeze({
  minilm: Object.freeze({
    id: "minilm", label: "MiniLM multilingue", family: "Sentence Transformers",
    repo: "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
    revision: "2c4055b12046f11709e9df2c122e59ffbdc2f900",
    dimensions: 384, modelMB: 118, tokenizerMB: 17.1, threshold: 0.70,
    description: "Poids de 118 Mo, plus le vocabulaire et le moteur au premier lancement.",
  }),
  labse: Object.freeze({
    id: "labse", label: "LaBSE", family: "Sentence Transformers",
    repo: "Xenova/LaBSE", revision: "147002d501fc76ecd313c631999ea796520fea74",
    dimensions: 768, modelMB: 472, tokenizerMB: 13.6, headMB: 2.36, threshold: 0.72,
    description: "Poids de 472 Mo, plus le vocabulaire, la projection et le moteur au premier lancement.",
  }),
});

const QUERY_LIMIT = 36;
const SOURCE_LIMIT = 96;
const RESULT_LIMIT = 12;
const MIN_WORDS = 5;
const CHUNK_WORDS = 40;
const WORDS = /[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:[’'-][\p{L}\p{N}][\p{L}\p{M}\p{N}]*)*/gu;

function includedRanges(length, excluded) {
  const cuts = (Array.isArray(excluded) ? excluded : [])
    .filter(r => Array.isArray(r) && Number.isInteger(r[0]) && Number.isInteger(r[1]))
    .map(([a, b]) => [Math.max(0, a), Math.min(length, b)])
    .filter(([a, b]) => a < b).sort((a, b) => a[0] - b[0]);
  const result = [];
  let start = 0;
  for (const [a, b] of cuts) {
    if (start < a) result.push([start, a]);
    start = Math.max(start, b);
  }
  if (start < length) result.push([start, length]);
  return result;
}

function sentenceSpans(content, excluded = []) {
  const spans = [];
  const segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter("fr", {granularity: "sentence"}) : null;
  for (const [lo, hi] of includedRanges(content.length, excluded)) {
    const included = content.slice(lo, hi);
    const sentences = segmenter ? segmenter.segment(included) : Array.from(
      included.matchAll(/[^.!?\n]+[.!?]*/gu), m => ({segment: m[0], index: m.index}),
    );
    for (const {index, segment} of sentences) {
      const words = [...segment.matchAll(WORDS)];
      if (words.length < MIN_WORDS) continue;
      const count = Math.ceil(words.length / CHUNK_WORDS);
      for (let part = 0; part < count; part++) {
        const first = Math.floor(part * words.length / count);
        const last = Math.floor((part + 1) * words.length / count) - 1;
        const start = lo + index + words[first].index;
        const end = lo + index + words[last].index + words[last][0].length;
        spans.push({start, end});
      }
    }
  }
  return spans;
}

function evenlySpaced(values, count) {
  if (values.length <= count) return values;
  if (count === 0) return [];
  if (count === 1) return [values[Math.floor((values.length - 1) / 2)]];
  return Array.from({length: count}, (_, i) => values[Math.round(i * (values.length - 1) / (count - 1))]);
}

/** Sources use {id, title, text}; excludeRanges use half-open UTF-16 offsets. */
export function planSemanticComparison({text, sources, excludeRanges = []}) {
  if (typeof text !== "string" || !Array.isArray(sources)) throw new Error("Le texte et les sources sont requis.");
  const queries = sentenceSpans(text, excludeRanges);
  const allGroups = sources.filter(s => s && typeof s.text === "string").map(s => ({
    source: s, ranges: sentenceSpans(s.text, s.excludeRanges), take: 0,
  }));
  const eligibleGroups = allGroups.filter(g => g.ranges.length);
  const groups = evenlySpaced(eligibleGroups, SOURCE_LIMIT);
  let remaining = SOURCE_LIMIT;
  while (remaining > 0 && groups.some(g => g.take < g.ranges.length)) {
    for (const group of groups) {
      if (remaining <= 0) break;
      if (group.take < group.ranges.length) { group.take++; remaining--; }
    }
  }
  const query = evenlySpaced(queries, QUERY_LIMIT).map(g => ({...g, text: text.slice(g.start, g.end)}));
  const reference = groups.flatMap(({source, ranges, take}) => evenlySpaced(ranges, take).map(g => ({
    ...g, sourceId: source.id, sourceTitle: String(source.title ?? "Source"), text: source.text.slice(g.start, g.end),
  })));
  const referenceTotal = allGroups.reduce((n, group) => n + group.ranges.length, 0);
  const coverage = {
    queryTotal: queries.length, queryExamined: query.length,
    referenceTotal, referenceExamined: reference.length,
    sourcesTotal: sources.length, sourcesExamined: groups.length,
    sampled: query.length < queries.length || reference.length < referenceTotal,
    pairsExamined: reference.length * query.length,
  };
  return {query, reference, coverage};
}

function unit(vector) {
  let n = 0;
  for (const x of vector) n += x * x;
  if (!Number.isFinite(n) || n <= 0) throw new Error("Le modèle a produit un vecteur inexploitable.");
  const scale = Math.sqrt(n);
  return Float32Array.from(vector, x => x / scale);
}

function cosine(a, b) {
  let total = 0;
  for (let i = 0; i < a.length; i++) total += a[i] * b[i];
  return Math.max(-1, Math.min(1, total));
}

function normalizedText(t) {
  return t.normalize("NFKC").toLocaleLowerCase("fr").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function rank(plan, embeddings, model) {
  const matches = [];
  const firstReference = plan.query.length;
  for (const [qi, q] of plan.query.entries()) {
    const perSource = new Map();
    for (const [ri, s] of plan.reference.entries()) {
      const similarity = cosine(embeddings[qi], embeddings[firstReference + ri]);
      if (similarity < model.threshold || (perSource.get(s.sourceId)?.similarity ?? -1) >= similarity) continue;
      perSource.set(s.sourceId, {
        sourceId: s.sourceId, sourceTitle: s.sourceTitle, similarity,
        queryStart: q.start, queryEnd: q.end, sourceStart: s.start, sourceEnd: s.end,
        queryText: q.text, sourceText: s.text, identical: normalizedText(q.text) === normalizedText(s.text),
      });
    }
    matches.push(...[...perSource.values()].sort((a, b) => b.similarity - a.similarity).slice(0, 2));
  }
  matches.sort((a, b) => b.similarity - a.similarity || a.queryStart - b.queryStart);
  return {
    model: model.id, modelLabel: model.label, candidateThreshold: model.threshold,
    matches: matches.slice(0, RESULT_LIMIT), coverage: plan.coverage, totalCandidates: matches.length,
  };
}

// The published LaBSE sentence model applies CLS pooling, a *separate* learned
// linear layer with tanh, then L2 normalization. Encoder output alone differs.
async function loadLaBSEProjection() {
  const request = new Request(HEAD_URL, {mode: "cors", credentials: "omit", referrerPolicy: "no-referrer"});
  let cache;
  try { cache = await globalThis.caches?.open("uaz-immutable-model-assets-v1"); } catch { /* storage may be disabled */ }
  let response = cache && await cache.match(request);
  if (!response) {
    response = await fetch(request);
    if (!response.ok) throw new Error("La projection de LaBSE n’a pas pu être téléchargée.");
    if (cache) {
      try { await cache.put(request, response.clone()); } catch { /* inference can continue without disk cache */ }
    }
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength < 16 || bytes.byteLength > 3_000_000) throw new Error("Projection LaBSE invalide.");
  const headerSize = Number(new DataView(bytes).getBigUint64(0, true));
  if (headerSize < 2 || headerSize > 65_536 || 8 + headerSize >= bytes.byteLength) throw new Error("En-tête LaBSE invalide.");
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 8, headerSize)));
  const readTensor = (suffix, expected) => {
    const names = Object.keys(header).filter(k => k === suffix || k.endsWith("." + suffix));
    const desc = names.length === 1 ? header[names[0]] : null;
    if (!desc || desc.dtype !== "F32" || JSON.stringify(desc.shape) !== JSON.stringify(expected)) {
      throw new Error("La projection LaBSE reçue a un format inattendu.");
    }
    const [start, end] = desc.data_offsets;
    const n = expected.reduce((a, b) => a * b, 1);
    const offset = 8 + headerSize + start;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end - start !== n * 4 ||
        offset % 4 || 8 + headerSize + end > bytes.byteLength) throw new Error("Projection LaBSE incomplète.");
    return new Float32Array(bytes, offset, n);
  };
  const weights = readTensor("weight", [768, 768]), bias = readTensor("bias", [768]);
  return vector => {
    const result = new Float32Array(768);
    for (let row = 0; row < 768; row++) {
      let sum = bias[row];
      for (let col = 0; col < 768; col++) sum += vector[col] * weights[row * 768 + col];
      result[row] = Math.tanh(sum);
    }
    return unit(result);
  };
}

async function infer({plan, model: id}, progress) {
  const model = SEMANTIC_MODELS[id];
  if (!model) throw new Error("Ce modèle n’est pas disponible.");
  progress({phase: "runtime", message: "Chargement du moteur d’IA dans le navigateur…", fraction: 0.02});
  const {env, pipeline} = await import(RUNTIME + "transformers.min.js");
  env.allowLocalModels = false;
  if (env.backends?.onnx?.wasm) {
    env.backends.onnx.wasm.numThreads = 1;
    env.backends.onnx.wasm.proxy = false;
    env.backends.onnx.wasm.wasmPaths = RUNTIME;
  }
  const files = new Map();
  let lastUpdate = 0;
  progress({phase: "model", message: `Chargement de ${model.label}…`, fraction: 0.04});
  const extractor = await pipeline("feature-extraction", model.repo, {
    revision: model.revision, dtype: "q8", device: "wasm",
    progress_callback: event => {
      if (event.status !== "progress" || !Number.isFinite(event.loaded)) return;
      files.set(event.file, event.loaded);
      if (Date.now() - lastUpdate < 150) return;
      lastUpdate = Date.now();
      const mb = [...files.values()].reduce((a, b) => a + b, 0) / 1_000_000;
      const fraction = 0.04 + 0.44 * Math.min(1, mb / (model.modelMB + model.tokenizerMB));
      progress({phase: "model", message: `${model.label} · ${Math.round(mb)} Mo chargés`, fraction});
    },
  });
  try {
    const project = id === "labse" ? await loadLaBSEProjection() : unit;
    const items = [...plan.query, ...plan.reference], vectors = [];
    const batch = id === "labse" ? 3 : 6;
    for (let i = 0; i < items.length; i += batch) {
      progress({
        phase: "encode", fraction: 0.5 + 0.47 * i / items.length,
        message: `Lecture des passages avec ${model.label} · ${i} sur ${items.length}`,
      });
      const texts = items.slice(i, i + batch).map(x => x.text);
      const output = await extractor(texts, {pooling: id === "labse" ? "cls" : "mean", normalize: false});
      try {
        if (output.dims.length !== 2 || output.dims[0] !== texts.length || output.dims[1] !== model.dimensions) {
          throw new Error("Le modèle a renvoyé des dimensions inattendues.");
        }
        for (let j = 0; j < texts.length; j++) {
          const offset = j * model.dimensions;
          vectors.push(project(output.data.subarray(offset, offset + model.dimensions)));
        }
      } finally { output.dispose?.(); }
    }
    progress({phase: "compare", message: "Comparaison des passages encodés…", fraction: 0.98});
    return rank(plan, vectors, model);
  } finally { await extractor.dispose?.(); }
}

/**
 * Returns actual cosine candidates and sampling counts or throws on failure.
 * No model downloads are initiated until the caller requests this analysis.
 * onProgress({phase, message, fraction}) uses fractions from 0 to 1.
 */
export async function analyzeSemantic({text, sources, model = "minilm", onProgress = () => {}, signal, excludeRanges = []}) {
  if (!Object.hasOwn(SEMANTIC_MODELS, model)) throw new Error("Modèle sémantique inconnu.");
  if (signal?.aborted) throw new DOMException("Analyse sémantique annulée.", "AbortError");
  const plan = planSemanticComparison({text, sources, excludeRanges});
  if (!plan.query.length || !plan.reference.length) {
    throw new Error("Il faut au moins un passage de cinq mots dans le devoir et dans une source pour comparer leur sens.");
  }
  if (typeof Worker === "undefined" || typeof WebAssembly === "undefined") {
    throw new Error("Ce navigateur ne propose pas l’exécution locale des modèles d’IA.");
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), {type: "module", name: "uaz-embeddings"});
    let timeout;
    function cleanup() {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      worker.terminate();
    }
    function fail(error) { cleanup(); reject(error); }
    function abort() { fail(new DOMException("Analyse sémantique annulée.", "AbortError")); }
    function arm() {
      clearTimeout(timeout);
      timeout = setTimeout(() => fail(new Error("Le chargement ou le calcul du modèle a dépassé le délai disponible.")), 150_000);
    }
    signal?.addEventListener("abort", abort, {once: true});
    worker.onmessage = ({data}) => {
      arm();
      if (data.type === "progress") onProgress(data.value);
      else if (data.type === "result") {
        cleanup(); onProgress({phase: "done", message: "Comparaison sémantique terminée.", fraction: 1}); resolve(data.value);
      } else if (data.type === "error") fail(new Error(data.message));
    };
    worker.onerror = event => fail(new Error(event.message || "Le navigateur n’a pas pu démarrer le moteur sémantique."));
    worker.onmessageerror = () => fail(new Error("Le navigateur n’a pas pu lire le résultat du moteur sémantique."));
    arm();
    try { worker.postMessage({type: "analyze", plan, model}); } catch (error) { fail(error); }
  });
}

if (typeof WorkerGlobalScope !== "undefined" && typeof document === "undefined" &&
    typeof globalThis.postMessage === "function" && globalThis instanceof WorkerGlobalScope) {
  globalThis.addEventListener("message", async ({data}) => {
    if (data?.type !== "analyze") return;
    try {
      const result = await infer(data, value => globalThis.postMessage({type: "progress", value}));
      globalThis.postMessage({type: "result", value: result});
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      globalThis.postMessage({type: "error", message:
        `L’analyse avec ${SEMANTIC_MODELS[data.model]?.label || "le modèle"} est indisponible. ` +
        "Vérifiez la connexion pour le premier chargement et la mémoire disponible. " + detail.slice(0, 220)});
    }
  });
}
