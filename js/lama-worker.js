// Worker: ejecuta LaMa fuera del hilo principal para no bloquear la pestaña.
importScripts('../vendor/ort.wasm.min.js');
ort.env.wasm.wasmPaths = new URL('../vendor/', self.location.href).href;
ort.env.wasm.numThreads = 1;
const MODEL_URL = new URL('../models/lama_fp32.onnx', self.location.href).href;
const CACHE = 'matriculas-modelos-v1';
let session = null;

// El modelo (198 MB) se descarga una sola vez y queda guardado en el navegador (Cache Storage);
// las siguientes veces se lee de ahí, sin red.
async function modelBytes() {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(MODEL_URL);
  if (hit) return new Uint8Array(await hit.arrayBuffer());
  const r = await fetch(MODEL_URL);
  if (!r.ok) throw new Error('HTTP ' + r.status + ' al descargar el modelo');
  const total = +r.headers.get('content-length') || 0, chunks = []; let got = 0;
  const rd = r.body.getReader();
  for (;;) {
    const { done, value } = await rd.read();
    if (done) break;
    chunks.push(value); got += value.length;
    self.postMessage({ progress: total ? got / total : 0, got, total });
  }
  const bytes = new Uint8Array(got); let o = 0;
  for (const c of chunks) { bytes.set(c, o); o += c.length; }
  await cache.put(MODEL_URL, new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } }));
  return bytes;
}
self.onmessage = async ({ data }) => {
  try {
    session ||= await ort.InferenceSession.create(await modelBytes(), { executionProviders: ['wasm'] });
    if (data.type === 'load') return self.postMessage({ id: data.id, ok: true });
    const S = 512;
    const r = await session.run({ image: new ort.Tensor('float32', data.image, [1, 3, S, S]), mask: new ort.Tensor('float32', data.mask, [1, 1, S, S]) });
    const out = r.output.data;
    self.postMessage({ id: data.id, ok: true, out }, [out.buffer]);
  } catch (e) {
    session = null;
    self.postMessage({ id: data.id, ok: false, error: String(e.message || e) });
  }
};
