// Worker: ejecuta LaMa fuera del hilo principal para no bloquear la pestaña.
importScripts('../vendor/ort.wasm.min.js');
ort.env.wasm.wasmPaths = new URL('../vendor/', self.location.href).href;
ort.env.wasm.numThreads = 1;
let session = null;
self.onmessage = async ({ data }) => {
  try {
    session ||= await ort.InferenceSession.create(new URL('../models/lama_fp32.onnx', self.location.href).href, { executionProviders: ['wasm'] });
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
