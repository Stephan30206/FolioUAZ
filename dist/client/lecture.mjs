/* Lecture locale des devoirs. Le texte retourné sert de repère aux surlignages. */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_TEXT_CHARS = 1_000_000;
const MAX_PDF_PAGES = 200;
const MAX_XML_BYTES = 18 * 1024 * 1024;
const WORD_NS = new Set([
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  'http://purl.oclc.org/ooxml/wordprocessingml/main',
]);
const MC_NS = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const IGNORE_WORD = new Set(['del', 'moveFrom', 'pPr', 'rPr', 'instrText', 'delText', 'tblPr', 'trPr', 'tcPr']);
const FRA_MODEL = new URL('./vendor/lecture/ocr/fra.traineddata.gz', import.meta.url).href;
const resource = (name) => new URL('./vendor/lecture/' + name, import.meta.url).href;

function annule(signal) {
  if (signal?.aborted) throw new DOMException('Lecture annulée.', 'AbortError');
}

function limiteTexte(longueur) {
  if (longueur > MAX_TEXT_CHARS) throw new Error('Le texte extrait dépasse la limite d’un million de caractères. Dépose un document plus court.');
}

function sansControles(texte) {
  return texte.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ');
}

function checkTexteFinal(texte) {
  limiteTexte(texte.length);
  if (!/[\p{L}\p{N}]/u.test(texte)) {
    throw new Error('Aucun texte lisible dans ce fichier. Vérifie son contenu ou dépose une version textuelle.');
  }
}

function progres(options, stage, progress, detail) {
  annule(options.signal);
  options.onProgress?.({ stage, progress: Math.max(0, Math.min(1, progress)), detail });
}

function attendre(promise, signal, delai, avis) {
  if (!signal && !delai) return promise;
  return new Promise((resolve, reject) => {
    let timer;
    function terminer(fonction, resultat) {
      clearTimeout(timer);
      signal?.removeEventListener('abort', interrompre);
      fonction(resultat);
    }
    function interrompre() {
      terminer(reject, new DOMException('Lecture annulée.', 'AbortError'));
    }
    promise.then(v => terminer(resolve, v), e => terminer(reject, e));
    if (signal?.aborted) { interrompre(); return; }
    signal?.addEventListener('abort', interrompre, { once: true });
    if (delai) timer = setTimeout(() => terminer(reject, new Error(avis)), delai);
  });
}

async function lireTxt(bytes) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('Encodage du fichier TXT illisible. Enregistre-le en UTF-8 puis réessaie.');
  }
  if (text.includes('\u0000')) throw new Error('Ce fichier TXT contient des données binaires. Enregistre le texte en UTF-8.');
  return { text: sansControles(text), warnings: [], pages: null, ocrPages: [], pageRanges: [], partial: false };
}

// Seules les parties contenant du texte sont décompressées. Le plafond est
// contrôlé sur les octets réellement produits, avant leur concaténation.
async function xmlEntree(zip, path, signal, budget) {
  const entry = zip.file(path);
  if (!entry) return null;
  if (entry._data?.uncompressedSize > budget.remaining) throw new Error('Le contenu XML de ce DOCX est trop volumineux.');
  const chunks = [];
  await new Promise((resolve, reject) => {
    const stream = entry.internalStream('uint8array');
    let stopped = false;
    function done(error) {
      if (stopped) return;
      stopped = true;
      signal?.removeEventListener('abort', onAbort);
      if (error) { stream.pause(); reject(error); }
      else resolve();
    }
    const onAbort = () => done(new DOMException('Lecture annulée.', 'AbortError'));
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) { onAbort(); return; }
    stream.on('data', part => {
      if (stopped) return;
      budget.remaining -= part.length;
      if (budget.remaining < 0) { done(new Error('Le contenu XML de ce DOCX est trop volumineux.')); return; }
      chunks.push(part);
    }).on('end', () => done()).on('error', done).resume();
  });
  const data = await new Blob(chunks).arrayBuffer();
  const debut = new Uint8Array(data, 0, Math.min(2, data.byteLength));
  const enc = debut[0] === 255 && debut[1] === 254 ? 'utf-16le' :
    debut[0] === 254 && debut[1] === 255 ? 'utf-16be' : 'utf-8';
  try { return new TextDecoder(enc, { fatal: true }).decode(data); }
  catch { throw new Error('Le texte XML de ce DOCX est illisible.'); }
}

function contenuWord(xml, sax, refs, kind = 'document') {
  const parser = sax.parser(true, { xmlns: true, strictEntities: true, trim: false, normalize: false });
  const stack = [];
  const noteBodies = new Map();
  let text = '', characters = 0, hasBody = false, images = false, additions = false;
  function ajouter(s) {
    characters += s.length;
    limiteTexte(characters);
    text += s;
  }
  function idWord(node) {
    return Object.values(node.attributes).find(a => a.local === 'id' && WORD_NS.has(a.uri))?.value;
  }
  parser.ondoctype = () => { throw new Error('Ce DOCX utilise une définition XML non prise en charge.'); };
  parser.onopentag = node => {
    const parent = stack.at(-1);
    const word = WORD_NS.has(node.uri);
    const name = word ? node.local : '';
    let active = Boolean(parent?.active);
    let skip = Boolean(parent?.skip) || (word && IGNORE_WORD.has(name));
    const frame = { name, active, skip, choice: false, altStart: null, note: null };
    if (kind === 'document' && name === 'body') { active = true; hasBody = true; }
    if (kind !== 'document' && name === kind && !skip) {
      const id = idWord(node);
      active = refs[kind].has(id);
      if (active) { frame.note = id; text = ''; }
    }
    if (node.uri === MC_NS && node.local === 'AlternateContent') frame.altStart = text.length;
    if (node.uri === MC_NS && ['Choice', 'Fallback'].includes(node.local) && parent?.altStart !== null && parent?.altStart !== undefined) {
      if (parent.choice) skip = true;
      else frame.inAlternative = true;
    }
    frame.active = active;
    frame.skip = skip;
    stack.push(frame);
    if (!active || skip) return;
    if (name === 'tab' || name === 'ptab') ajouter('\t');
    if (name === 'br' || name === 'cr') ajouter('\n');
    if (name === 'noBreakHyphen') ajouter('‑');
    if (name === 'drawing' || name === 'pict' || name === 'object') images = true;
    if (name === 'altChunk') additions = true;
    if (name === 'footnoteReference' || name === 'endnoteReference') {
      const type = name === 'footnoteReference' ? 'footnote' : 'endnote';
      const id = idWord(node);
      if (id !== undefined) refs[type].add(id);
    }
  };
  parser.ontext = parser.oncdata = value => {
    const f = stack.at(-1);
    if (f?.active && !f.skip && f.name === 't') ajouter(value);
  };
  parser.onclosetag = () => {
    const f = stack.pop();
    if (!f?.active || f.skip) return;
    if (f.name === 'p') ajouter('\n');
    if (f.name === 'tc') {
      if (text.endsWith('\n')) text = text.slice(0, -1);
      ajouter('\t');
    }
    if (f.name === 'tr') {
      if (text.endsWith('\t')) text = text.slice(0, -1);
      ajouter('\n');
    }
    if (f.inAlternative) {
      const alternate = stack.at(-1);
      if (text.slice(alternate.altStart).trim()) alternate.choice = true;
    }
    if (f.note !== null) noteBodies.set(f.note, text.trimEnd());
  };
  parser.write(xml).close();
  return { text: sansControles(text.trimEnd()), noteBodies, hasBody, images, additions };
}

async function lireDocx(bytes, options) {
  const [{ default: JSZip }, { default: sax }] = await Promise.all([
    import('./vendor/lecture/jszip.mjs'), import('./vendor/lecture/sax.mjs'),
  ]);
  annule(options.signal);
  let zip;
  try { zip = await JSZip.loadAsync(bytes); }
  catch { throw new Error('Ce fichier DOCX est illisible ou protégé. Ouvre-le dans Word et enregistre une nouvelle copie.'); }
  const budget = { remaining: MAX_XML_BYTES };
  const refs = { footnote: new Set(), endnote: new Set() };
  const main = await xmlEntree(zip, 'word/document.xml', options.signal, budget);
  if (!main) throw new Error('Ce fichier ne contient pas le corps d’un document Word (.docx).');
  progres(options, 'lecture', 0.45, 'Lecture des paragraphes et des tableaux Word…');
  let word;
  const warnings = [];
  let partial = false;
  try {
    word = contenuWord(main, sax, refs);
    if (!word.hasBody) throw new Error('Corps du document Word introuvable.');
    if (word.images) warnings.push('Word contient des objets graphiques. Vérifie le texte présent uniquement dans ces images.');
    if (word.additions) { warnings.push('Une section Word incorporée nécessite une vérification dans le document original.'); partial = true; }
    for (const type of ['footnote', 'endnote']) {
      if (!refs[type].size) continue;
      const part = await xmlEntree(zip, 'word/' + type + 's.xml', options.signal, budget);
      const notes = part ? contenuWord(part, sax, refs, type).noteBodies : new Map();
      for (const ref of refs[type]) {
        if (notes.has(ref)) word.text += '\n\n' + notes.get(ref);
        else { partial = true; warnings.push('Une note de ce document n’a pas pu être lue.'); }
      }
    }
  } catch (err) {
    if (err.name === 'AbortError' || !/\nLine:|Unexpected close tag|Unclosed root/i.test(err.message)) throw err;
    throw new Error('Le contenu XML du fichier Word est endommagé. Enregistre une nouvelle copie en DOCX.');
  }
  return { text: word.text, warnings: [...new Set(warnings)], pages: null, ocrPages: [], pageRanges: [], partial };
}

function textePdf(items) {
  let out = '', precedent;
  for (const item of items) {
    if (typeof item.str !== 'string') continue;
    if (!item.str) {
      if (item.hasEOL && out && !out.endsWith('\n')) out += '\n';
      continue;
    }
    if (precedent && out && !/\s$/u.test(out) && !/^\s/u.test(item.str)) {
      const a = precedent.transform, b = item.transform;
      if (a && b) {
        const h = Math.max(1, Math.min(Math.abs(precedent.height) || 10, Math.abs(item.height) || 10));
        const decalage = Math.abs(a[5] - b[5]);
        if (decalage > h * 0.75) out += '\n';
        else if (b[4] - (a[4] + precedent.width) > h * 0.13 && item.dir !== 'rtl') out += ' ';
      }
    }
    out += item.str;
    if (item.hasEOL) out += '\n';
    precedent = item;
  }
  return sansControles(out.trimEnd());
}

let frenchData = null;
async function languesOCR(options, warnings) {
  if (options.ocrLanguage === 'eng') return { langs: 'eng', label: 'anglais' };
  const url = FRA_MODEL;
  const controller = new AbortController();
  const stopper = () => controller.abort();
  const timer = setTimeout(stopper, 9000);
  options.signal?.addEventListener('abort', stopper, { once: true });
  try {
    annule(options.signal);
    if (!frenchData) {
      const response = await fetch(url, { signal: controller.signal, cache: 'force-cache', credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!response.ok) throw new Error();
      const pack = new Uint8Array(await response.arrayBuffer());
      if (pack.length < 10000 || pack[0] !== 31 || pack[1] !== 139) throw new Error();
      frenchData = pack;
    }
    return { langs: [{ code: 'fra', data: frenchData }, 'eng'], label: 'français et anglais' };
  } catch {
    annule(options.signal);
    warnings.push('Le modèle OCR français est indisponible. La lecture du scan utilise le modèle anglais fourni. Vérifie notamment les accents.');
    return { langs: 'eng', label: 'anglais' };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', stopper);
  }
}

function encre(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  // Une miniature suffit pour distinguer une page blanche d’une page illustrée.
  const min = document.createElement('canvas');
  min.width = Math.min(240, canvas.width); min.height = Math.max(1, Math.round(canvas.height * min.width / canvas.width));
  if (min.height > 320) { min.width = Math.max(1, Math.round(min.width * 320 / min.height)); min.height = 320; }
  const petit = min.getContext('2d', { willReadFrequently: true });
  if (!ctx || !petit) return true;
  petit.drawImage(canvas, 0, 0, min.width, min.height);
  const { data } = petit.getImageData(0, 0, min.width, min.height);
  let sombres = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i+3] > 100 && Math.min(data[i], data[i+1], data[i+2]) < 210 && ++sombres > 3) return true;
  }
  return false;
}

function listePages(numeros) {
  const extraits = numeros.slice(0, 12).join(', ');
  return numeros.length > 12 ? extraits + '… (' + numeros.length + ' pages)' : extraits;
}

async function lirePdf(bytes, options) {
  const pdf = await import('./vendor/lecture/pdf.mjs');
  annule(options.signal);
  pdf.GlobalWorkerOptions.workerSrc = resource('pdf.worker.mjs');
  const job = pdf.getDocument({
    data: bytes, isEvalSupported: false, cMapUrl: resource('cmaps/'), cMapPacked: true,
    standardFontDataUrl: resource('standard_fonts/'), wasmUrl: resource('wasm/'), verbosity: 0,
  });
  let ocr = null, ocrReady = null, disposed = false, numPage = 0, nbPages = 0, langue = null;
  let renderTask = null;
  const warnings = [], sections = [], ocrPages = [], doute = [], sansLecture = [], faibles = [];
  let length = 0;
  const interrompt = () => {
    renderTask?.cancel();
    if (ocr) void ocr.terminate();
    void job.destroy().catch(() => {});
  };
  options.signal?.addEventListener('abort', interrompt, { once: true });
  function avancement(fraction, detail) {
    const progress = 0.08 + 0.89 * ((numPage - 1 + fraction) / Math.max(1, nbPages));
    if (!disposed && !options.signal?.aborted) progres(options, 'ocr', progress, detail);
  }
  async function ouvrirOCR() {
    if (ocr) return ocr;
    if (ocrReady) return ocrReady;
    avancement(0.12, 'Préparation de la reconnaissance des caractères…');
    const { default: tesseract } = await import('./vendor/lecture/ocr/tesseract.mjs');
    const choix = await languesOCR(options, warnings);
    langue = choix.label;
    annule(options.signal);
    let failed;
    const failure = new Promise((_, reject) => { failed = reject; });
    const creation = tesseract.createWorker(choix.langs, 1, {
      workerPath: resource('ocr/worker.min.js'), corePath: resource('ocr/tesseract-core-lstm.wasm.js'),
      langPath: resource('ocr/'), cachePath: 'uaz-ocr-v1', workerBlobURL: false, gzip: true,
      errorHandler: e => failed(new Error(String(e))),
      logger: m => { if (m.status === 'recognizing text') avancement(0.25 + 0.7 * m.progress, 'Lecture du scan · page ' + numPage + ' sur ' + nbPages); },
    }).then(w => {
      if (disposed || options.signal?.aborted) { void w.terminate(); throw new DOMException('Lecture annulée.', 'AbortError'); }
      ocr = w;
      return w;
    });
    ocrReady = attendre(Promise.race([creation, failure]), options.signal, 60000, 'Initialisation du moteur OCR impossible.');
    return ocrReady;
  }
  try {
    const doc = await attendre(job.promise, options.signal);
    nbPages = doc.numPages;
    if (nbPages > MAX_PDF_PAGES) throw new Error('Ce PDF dépasse 200 pages. Dépose-le en plusieurs parties.');
    for (numPage = 1; numPage <= nbPages; numPage++) {
      annule(options.signal);
      progres(options, 'lecture', 0.08 + 0.89 * (numPage - 1) / nbPages, 'Lecture de la page ' + numPage + ' sur ' + nbPages + '…');
      const page = await doc.getPage(numPage);
      let canvas;
      try {
        const content = await page.getTextContent({ disableNormalization: false });
        let texte = textePdf(content.items);
        let method = 'texte';
        const nbCar = (texte.match(/[\p{L}\p{N}]/gu) || []).length;
        let besoinOcr = nbCar === 0;
        if (!besoinOcr && nbCar < 85) {
          const ops = await page.getOperatorList();
          const images = new Set([pdf.OPS.paintImageXObject, pdf.OPS.paintImageXObjectRepeat, pdf.OPS.paintInlineImageXObject,
            pdf.OPS.paintInlineImageXObjectGroup, pdf.OPS.paintImageMaskXObject]);
          besoinOcr = ops.fnArray.some(op => images.has(op));
        }
        if (besoinOcr) {
          annule(options.signal);
          const normal = page.getViewport({ scale: 1 });
          const scale = Math.min(2.5, 2700 / Math.max(normal.width, normal.height), Math.sqrt(4_000_000 / (normal.width * normal.height)));
          const viewport = page.getViewport({ scale });
          canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.ceil(viewport.width)); canvas.height = Math.max(1, Math.ceil(viewport.height));
          renderTask = page.render({ canvas, viewport, background: '#ffffff' });
          await attendre(renderTask.promise, options.signal);
          renderTask = null;
          if (encre(canvas)) {
            try {
              const moteur = await ouvrirOCR();
              const { data } = await attendre(moteur.recognize(canvas), options.signal, 120000, 'Le délai de reconnaissance de cette page est dépassé.');
              const lu = sansControles((data.text || '').trim());
              const lisibles = (lu.match(/[\p{L}\p{N}]/gu) || []).length;
              if (lisibles > nbCar) {
                texte = lu; method = 'ocr'; ocrPages.push(numPage);
                if (data.confidence < 60) faibles.push(numPage);
              } else if (!nbCar) sansLecture.push(numPage);
              else if (!lisibles) doute.push(numPage);
            } catch (e) {
              annule(options.signal);
              if (!nbCar) sansLecture.push(numPage);
              else doute.push(numPage);
              if (!warnings.includes('La reconnaissance des caractères a rencontré une difficulté.')) {
                warnings.push('La reconnaissance des caractères a rencontré une difficulté.');
              }
            }
          } else if (!nbCar) method = 'blanche';
        }
        const start = length + (sections.length ? 2 : 0);
        length = start + texte.length;
        limiteTexte(length);
        sections.push({ page: numPage, start, end: length, method, text: texte });
      } finally {
        if (canvas) { canvas.width = 0; canvas.height = 0; }
        page.cleanup();
      }
    }
    if (ocrPages.length) warnings.push('Texte reconnu par Tesseract (' + langue + ') sur les pages ' + listePages(ocrPages) + '. Vérifie la transcription dans l’original.');
    if (faibles.length) warnings.push('Reconnaissance incertaine sur les pages ' + listePages(faibles) + '.');
    if (sansLecture.length) warnings.push('Aucun texte récupéré sur les pages illustrées ' + listePages(sansLecture) + '.');
    if (doute.length) warnings.push('Seule la couche texte des pages ' + listePages(doute) + ' a pu être retenue.');
    const text = sections.map(p => p.text).join('\n\n');
    if (!text.trim() && (sansLecture.length || doute.length)) {
      throw new Error('Ce PDF semble numérisé et la reconnaissance ne fournit aucun texte lisible. Utilise un scan plus net ou une version DOCX ou TXT.');
    }
    return { text, warnings, pages: nbPages, ocrPages, pageRanges: sections.map(({text, ...s}) => s),
      partial: sansLecture.length + doute.length > 0 };
  } catch (e) {
    annule(options.signal);
    if (e?.name === 'PasswordException') throw new Error('Ce PDF est protégé. Dépose une copie accessible sans mot de passe.');
    if (e?.name === 'InvalidPDFException') throw new Error('Ce PDF est illisible ou endommagé. Enregistre une nouvelle copie.');
    throw e;
  } finally {
    disposed = true;
    options.signal?.removeEventListener('abort', interrompt);
    if (ocr) await ocr.terminate().catch(() => {});
    await job.destroy().catch(() => {});
  }
}

/**
 * Lit un fichier utilisateur sans envoyer son contenu à un service tiers.
 * onProgress({ stage, progress: 0..1, detail }); signal = AbortSignal.
 * pages est propre aux PDF et pageRanges porte des bornes UTF-16 [start,end).
 * ocrLanguage: 'fra+eng' (défaut) ou 'eng' (tous les poids livrés avec le site).
 */
export async function lireDocument(file, options = {}) {
  annule(options.signal);
  if (!file || typeof file.arrayBuffer !== 'function') throw new Error('Choisis un document à déposer.');
  if (file.size <= 0) throw new Error('Le fichier est vide.');
  if (file.size > MAX_FILE_BYTES) throw new Error('Ce fichier dépasse la taille maximale de 20 Mio.');
  const format = String(file.name || '').split('.').at(-1).toUpperCase();
  if (!['PDF', 'DOCX', 'TXT'].includes(format)) throw new Error('Choisis un fichier PDF, DOCX ou TXT.');
  progres(options, 'lecture', 0.03, 'Ouverture du fichier ' + format + '…');
  const bytes = new Uint8Array(await attendre(file.arrayBuffer(), options.signal));
  annule(options.signal);
  const read = format === 'PDF' ? lirePdf : format === 'DOCX' ? lireDocx : lireTxt;
  const result = await read(bytes, options);
  annule(options.signal);
  checkTexteFinal(result.text);
  progres(options, 'lecture', 1, 'Texte prêt pour l’analyse.');
  return { ...result, format, fileName: file.name, size: file.size };
}
