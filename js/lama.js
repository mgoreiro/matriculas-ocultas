// Ocultación con LaMa (inpainting neuronal, ONNX 512x512, Apache-2.0) ejecutado en el navegador.
// Se recorta una ventana cuadrada alrededor de la matrícula, se rellena la silueta con LaMa y se pega solo esa zona.
import { grow, inPoly, dilate, boxBlur1 } from './inpaint.js';
export const LAMA_URL = 'models/lama_fp32.onnx';
let worker = null, nextId = 1, onProgress = null;
const CACHE = 'matriculas-modelos-v1';

// ¿Ya está instalado el modelo en este navegador?
export async function lamaInstalled() {
  try { return !!(await (await caches.open(CACHE)).match(new URL('../' + LAMA_URL, import.meta.url).href)); } catch { return false; }
}
const waiting = new Map();

// Llamada al worker (inferencia fuera del hilo principal)
function call(msg, transfer = []) {
  if (!worker) {
    worker = new Worker(new URL('./lama-worker.js', import.meta.url));
    worker.onmessage = ({ data }) => { if (data.progress !== undefined || data.phase) return onProgress?.(data); const w = waiting.get(data.id); waiting.delete(data.id); data.ok ? w.resolve(data.out) : w.reject(new Error('No se pudo ejecutar LaMa (¿ejecutaste ./descargar-lama.sh?): ' + data.error)); };
    worker.onerror = e => { for (const w of waiting.values()) w.reject(new Error('Error en el worker: ' + e.message)); waiting.clear(); worker = null; };
  }
  return new Promise((resolve, reject) => { const id = nextId++; waiting.set(id, { resolve, reject }); worker.postMessage({ ...msg, id }, transfer); });
}

const S = 512;
const win = document.createElement('canvas');

// Descarga (si hace falta) y prepara el modelo sin procesar nada; onProgress({progress, got, total} | {phase:'init'})
export async function lamaPreload(progress) {
  onProgress = progress || null;
  navigator.storage?.persist?.().catch(() => {});
  await call({ type: 'load' });
}

export async function lamaHide(ctx, W, H, box, { pad, feather }, progress) {
  onProgress = progress || null;
  navigator.storage?.persist?.().catch(() => {}); // pide que el navegador no borre el modelo
  const base = box.poly || [[box.x, box.y], [box.x + box.w, box.y], [box.x + box.w, box.y + box.h], [box.x, box.y + box.h]];
  const poly = grow(base, pad);
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (const [x, y] of poly) { bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y); }
  // ventana cuadrada de contexto (≈3,5 veces la matrícula), dentro de la imagen
  const side = Math.round(Math.min(Math.min(W, H), Math.max((bx1 - bx0) * 3.5, (by1 - by0) * 3.5, 160)));
  const wx0 = Math.round(Math.min(Math.max((bx0 + bx1) / 2 - side / 2, 0), W - side));
  const wy0 = Math.round(Math.min(Math.max((by0 + by1) / 2 - side / 2, 0), H - side));
  win.width = win.height = S;
  const wc = win.getContext('2d', { willReadFrequently: true });
  wc.imageSmoothingQuality = 'high';
  wc.drawImage(ctx.canvas, wx0, wy0, side, side, 0, 0, S, S);
  const px = wc.getImageData(0, 0, S, S).data, k = S / side;
  // máscara a 512 px (silueta + 2 px de holgura)
  const m0 = new Uint8Array(S * S), polyS = poly.map(([x, y]) => [(x - wx0) * k, (y - wy0) * k]);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (inPoly(polyS, x + 0.5, y + 0.5)) m0[y * S + x] = 1;
  // holgura de 8 px a 512 (cubre el reborde oscuro de la matrícula) y se borra la zona de la entrada: LaMa rinde mucho mejor así
  const mask = dilate(m0, S, S, 8);
  for (let i = 0; i < S * S; i++) if (mask[i]) { px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = 0; }
  const img = new Float32Array(3 * S * S);
  for (let i = 0; i < S * S; i++) { img[i] = px[i * 4] / 255; img[S * S + i] = px[i * 4 + 1] / 255; img[2 * S * S + i] = px[i * 4 + 2] / 255; }
  const maskF = Float32Array.from(mask);
  const out = await call({ type: 'run', image: img, mask: maskF }, [img.buffer, maskF.buffer]);
  let mx = 0; for (let i = 0; i < out.length; i += 97) mx = Math.max(mx, out[i]);
  const scale = mx > 2 ? 1 : 255;
  const rc = document.createElement('canvas'); rc.width = rc.height = S;
  const rimg = rc.getContext('2d').createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    rimg.data[i * 4] = out[i] * scale; rimg.data[i * 4 + 1] = out[S * S + i] * scale; rimg.data[i * 4 + 2] = out[2 * S * S + i] * scale; rimg.data[i * 4 + 3] = 255;
  }
  rc.getContext('2d').putImageData(rimg, 0, 0);
  // resultado a la resolución original de la ventana
  const fc = document.createElement('canvas'); fc.width = fc.height = side;
  const fctx = fc.getContext('2d', { willReadFrequently: true });
  fctx.imageSmoothingQuality = 'high'; fctx.drawImage(rc, 0, 0, side, side);
  const fd = fctx.getImageData(0, 0, side, side).data;
  // mezcla con el mismo alfa (silueta + rampa de difuminado) que el resto de modos
  const f = Math.max(0, Math.round(feather)), r1 = Math.ceil(f / 2), m = 4 + f;
  const rx0 = Math.max(0, Math.floor(bx0) - m), ry0 = Math.max(0, Math.floor(by0) - m);
  const rx1 = Math.min(W, Math.ceil(bx1) + m), ry1 = Math.min(H, Math.ceil(by1) + m), w = rx1 - rx0, h = ry1 - ry0;
  const M = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (inPoly(poly, rx0 + x + 0.5, ry0 + y + 0.5)) M[y * w + x] = 1;
  const alpha = r1 ? boxBlur1(dilate(M, w, h, r1), w, h, r1) : Float32Array.from(M);
  const dst = ctx.getImageData(rx0, ry0, w, h), d = dst.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const a = alpha[y * w + x]; if (a <= 0.001) continue;
    const gx = rx0 + x - wx0, gy = ry0 + y - wy0;
    if (gx < 0 || gy < 0 || gx >= side || gy >= side) continue;
    const i = (y * w + x) * 4, j = (gy * side + gx) * 4;
    for (let ch = 0; ch < 3; ch++) d[i + ch] = d[i + ch] * (1 - a) + fd[j + ch] * a;
  }
  ctx.putImageData(dst, rx0, ry0);
}
