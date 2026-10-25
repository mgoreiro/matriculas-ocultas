// Detección de matrículas con YOLOv9 (ONNX, open-image-models) ejecutado en el navegador con onnxruntime-web.
const ort = window.ort;
ort.env.wasm.wasmPaths = new URL('../vendor/', import.meta.url).href;
ort.env.wasm.numThreads = 1; // sin cabeceras COOP/COEP no hay SharedArrayBuffer

export const MODELS = {
  fast: { url: 'models/yolo-v9-t-640-license-plates-end2end.onnx', size: 640, label: 'Rápido (8 MB)' },
  accurate: { url: 'models/yolo-v9-s-608-license-plates-end2end.onnx', size: 608, label: 'Preciso (29 MB)' },
};

const sessions = {};
export async function getSession(key) {
  if (!sessions[key]) {
    sessions[key] = ort.InferenceSession.create(MODELS[key].url, { executionProviders: ['wasm'] });
  }
  return sessions[key];
}

const work = document.createElement('canvas');

// Recorta (sx,sy,sw,sh) de src, lo escala con bandas grises (letterbox) a SxS y lo pasa a tensor CHW float32 RGB.
function preprocess(src, sx, sy, sw, sh, S) {
  work.width = work.height = S;
  const c = work.getContext('2d', { willReadFrequently: true });
  const scale = Math.min(S / sw, S / sh);
  const nw = Math.round(sw * scale), nh = Math.round(sh * scale);
  const padX = Math.floor((S - nw) / 2), padY = Math.floor((S - nh) / 2);
  c.fillStyle = 'rgb(114,114,114)';
  c.fillRect(0, 0, S, S);
  c.imageSmoothingQuality = 'high';
  c.drawImage(src, sx, sy, sw, sh, padX, padY, nw, nh);
  const d = c.getImageData(0, 0, S, S).data;
  const n = S * S, t = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    t[i] = d[i * 4] / 255;
    t[n + i] = d[i * 4 + 1] / 255;
    t[2 * n + i] = d[i * 4 + 2] / 255;
  }
  return { t, scale, padX, padY };
}

async function runPass(session, S, src, sx, sy, sw, sh) {
  const { t, scale, padX, padY } = preprocess(src, sx, sy, sw, sh, S);
  const out = await session.run({ images: new ort.Tensor('float32', t, [1, 3, S, S]) });
  const o = out.output0, rows = o.dims[0], v = o.data, res = [];
  for (let i = 0; i < rows; i++) {
    const [, x1, y1, x2, y2, , score] = v.subarray(i * 7, i * 7 + 7);
    res.push({
      x1: (x1 - padX) / scale + sx, y1: (y1 - padY) / scale + sy,
      x2: (x2 - padX) / scale + sx, y2: (y2 - padY) / scale + sy, score,
    });
  }
  return res;
}

function iou(a, b) {
  const iw = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1), ih = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
  if (iw <= 0 || ih <= 0) return { iou: 0, min: 0 };
  const inter = iw * ih, aa = (a.x2 - a.x1) * (a.y2 - a.y1), ab = (b.x2 - b.x1) * (b.y2 - b.y1);
  return { iou: inter / (aa + ab - inter), min: inter / Math.min(aa, ab) };
}

function nms(dets) {
  dets.sort((a, b) => b.score - a.score);
  const keep = [];
  for (const d of dets) {
    if (!keep.some(k => { const r = iou(k, d); return r.iou > 0.4 || r.min > 0.7; })) keep.push(d);
  }
  return keep;
}

// Devuelve cajas en píxeles de la imagen original. Con tiles=true se añaden pasadas sobre mosaicos
// solapados (el modelo ve las matrículas lejanas más grandes).
export async function detect(src, W, H, { model = 'fast', tiles = true, onProgress } = {}) {
  const session = await getSession(model), S = MODELS[model].size;
  const passes = [[0, 0, W, H]];
  if (tiles) {
    const n = Math.max(W, H) <= 3000 ? 2 : 3;
    const tw = Math.min(W, (W / n) * 1.3), th = Math.min(H, (H / n) * 1.3);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      passes.push([(W - tw) * i / (n - 1), (H - th) * j / (n - 1), tw, th]);
    }
  }
  let all = [];
  for (let k = 0; k < passes.length; k++) {
    onProgress?.((k + 1) / passes.length);
    all = all.concat(await runPass(session, S, src, ...passes[k]));
    await new Promise(r => setTimeout(r)); // deja respirar a la UI
  }
  return nms(all.filter(d => d.score >= 0.15)).map(d => ({
    x: Math.max(0, d.x1), y: Math.max(0, d.y1),
    w: Math.min(W, d.x2) - Math.max(0, d.x1), h: Math.min(H, d.y2) - Math.max(0, d.y1), score: d.score,
  })).filter(b => b.w > 2 && b.h > 2);
}
