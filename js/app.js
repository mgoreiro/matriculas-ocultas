import { detect, MODELS } from './detect.js';
import { hideBox } from './inpaint.js';
import { refinePlate } from './refine.js';
import { lamaHide, lamaInstalled } from './lama.js';

const $ = id => document.getElementById(id);
const src = document.createElement('canvas'), out = document.createElement('canvas');
const sctx = src.getContext('2d', { willReadFrequently: true }), octx = out.getContext('2d', { willReadFrequently: true });
let W = 0, H = 0, name = 'foto', origType = 'image/jpeg', boxes = [], nextId = 1, rafId = 0;
$('stageA').prepend(src); $('stageB').append(out);

const setStatus = t => { $('status').textContent = t; };

// ---------- carga ----------
async function loadFile(file) {
  try { await loadFile0(file); } catch (e) { console.error(e); window.warn?.('No se pudo procesar la imagen: ' + e.message); $('drop').style.display = ''; $('work').style.display = 'none'; }
}
async function loadFile0(file) {
  if (!file || !file.type.startsWith('image/')) { window.warn?.('Eso no parece una imagen (formatos: JPG, PNG, WebP…).'); return; }
  name = file.name.replace(/\.[^.]+$/, ''); origType = file.type;
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  W = src.width = out.width = bmp.width; H = src.height = out.height = bmp.height;
  sctx.drawImage(bmp, 0, 0); bmp.close();
  $('drop').style.display = 'none'; $('work').style.display = 'block';
  $('dims').textContent = `${W}×${H} px (la descarga conserva esta resolución)`;
  $('fmt').value = origType === 'image/png' ? 'png' : 'jpeg'; syncFmt();
  boxes = []; await runDetect();
}

async function runDetect() {
  setStatus('Cargando modelo y detectando…');
  $('redetect').disabled = true;
  const manual = boxes.filter(b => b.manual);
  try {
    const dets = await detect(src, W, H, {
      model: $('model').value, tiles: $('tiles').checked,
      onProgress: p => setStatus(`Detectando… ${Math.round(p * 100)}%`),
    });
    boxes = manual.concat(dets.map(d => ({ ...d, id: nextId++, on: true, manual: false })));
    fitAll();
    note = `${dets.length} matrícula(s) detectada(s).`; setStatus(note);
  } catch (e) { console.error(e); setStatus('Error al detectar: ' + e.message); }
  $('redetect').disabled = false;
  refresh();
}

// ---------- ajuste a la silueta ----------
function fitBox(b) { b.poly = $('fit').checked ? refinePlate(src, W, H, b) : null; }
function fitAll() { boxes.forEach(fitBox); }

// ---------- render ----------
const visible = b => b.on && (b.manual || b.score >= +$('thr').value);
let rendering = false, pending = false, note = '';
function refresh() { cancelAnimationFrame(rafId); rafId = requestAnimationFrame(render); }
async function render() {
  if (rendering) { pending = true; return; }
  rendering = true;
  try {
    do {
      pending = false;
      octx.drawImage(src, 0, 0);
      const o = { mode: $('mode').value, pad: +$('pad').value, feather: +$('feather').value, strength: +$('strength').value };
      const todo = boxes.filter(visible); let n = 0;
      for (const b of todo) {
        n++;
        if (o.mode === 'lama') {
          setStatus(`Aplicando IA (LaMa) ${n}/${todo.length}… la página sigue usable.`);
          try { await lamaHide(octx, W, H, b, o, p => setStatus(`Descargando el modelo de IA (solo esta vez, se guarda en el navegador): ${Math.round(p.progress * 100)} % de ${Math.round(p.total / 1e6)} MB`)); } catch (e) { console.error(e); setStatus(e.message); pending = false; break; }
          setStatus(note); updateLamaLabel();
        } else hideBox(octx, W, H, b, o);
        if (pending) break;
      }
      drawOverlay(); drawList();
    } while (pending);
  } finally { rendering = false; }
}

function boxEl(b, cls) {
  const d = document.createElement('div');
  d.className = 'box ' + cls;
  Object.assign(d.style, { left: b.x / W * 100 + '%', top: b.y / H * 100 + '%', width: b.w / W * 100 + '%', height: b.h / H * 100 + '%' });
  return d;
}
function drawOverlay() {
  const ov = $('overlay'); ov.replaceChildren();
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('preserveAspectRatio', 'none');
  svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
  for (const b of boxes) {
    if (!b.poly || !b.on || (!b.manual && b.score < +$('thr').value)) continue;
    const p = document.createElementNS(ns, 'polygon');
    p.setAttribute('points', b.poly.map(q => q.join(',')).join(' '));
    p.setAttribute('fill', 'rgba(255,45,149,.18)'); p.setAttribute('stroke', '#ff2d95'); p.setAttribute('stroke-width', Math.max(1, W / 900));
    svg.append(p);
  }
  ov.append(svg);
  for (const b of boxes) {
    if (!b.manual && b.score < +$('thr').value) continue;
    const e = boxEl(b, !b.on ? 'off' : b.poly ? 'fit' : ''); e.dataset.id = b.id; ov.append(e);
  }
}
function crop(canvas, b, target) {
  const m = Math.max(b.w, b.h) * 0.35, x = Math.max(0, b.x - m), y = Math.max(0, b.y - m);
  const w = Math.min(W - x, b.w + 2 * m), h = Math.min(H - y, b.h + 2 * m);
  canvas.width = target; canvas.height = Math.round(target * h / w);
  canvas.getContext('2d').drawImage(canvas.dataset.from === 'src' ? src : out, x, y, w, h, 0, 0, canvas.width, canvas.height);
}
function drawList() {
  const list = $('list'); list.replaceChildren();
  boxes.filter(b => b.manual || b.score >= +$('thr').value).forEach((b, i) => {
    const it = document.createElement('div'); it.className = 'item';
    const c1 = document.createElement('canvas'), c2 = document.createElement('canvas');
    c1.dataset.from = 'src'; c2.dataset.from = 'out'; crop(c1, b, 120); crop(c2, b, 120);
    c1.style.width = c2.style.width = '84px';
    const meta = document.createElement('div'); meta.className = 'meta';
    meta.innerHTML = `<b>#${i + 1}</b> ${b.manual ? 'manual' : 'conf. ' + b.score.toFixed(2)}<br>${Math.round(b.w)}×${Math.round(b.h)} px`;
    const tog = document.createElement('button'); tog.textContent = b.on ? 'Quitar' : 'Ocultar';
    tog.onclick = () => { b.on = !b.on; refresh(); };
    const del = document.createElement('button'); del.textContent = '✕'; del.className = 'del'; del.title = 'Eliminar caja';
    del.onclick = () => { boxes = boxes.filter(x => x !== b); refresh(); };
    const btns = document.createElement('div'); btns.style.cssText = 'display:flex;flex-direction:column;gap:4px';
    btns.append(tog, del);
    it.append(c1, c2, meta, btns); list.append(it);
  });
}

// ---------- dibujar / activar cajas ----------
(() => {
  const ov = $('overlay'); let start = null, draft = null;
  const pos = e => { const r = ov.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H }; };
  ov.addEventListener('pointerdown', e => { ov.setPointerCapture(e.pointerId); start = pos(e); start.cx = e.clientX; start.cy = e.clientY; });
  ov.addEventListener('pointermove', e => {
    if (!start) return;
    if (!draft && Math.hypot(e.clientX - start.cx, e.clientY - start.cy) < 5) return;
    const p = pos(e), x = Math.max(0, Math.min(start.x, p.x)), y = Math.max(0, Math.min(start.y, p.y));
    const b = { x, y, w: Math.min(W, Math.max(start.x, p.x)) - x, h: Math.min(H, Math.max(start.y, p.y)) - y };
    draft?.remove(); draft = boxEl(b, 'draft'); draft.dataset.b = JSON.stringify(b); ov.append(draft);
  });
  ov.addEventListener('pointerup', e => {
    if (!start) return;
    if (draft) {
      const b = JSON.parse(draft.dataset.b);
      if (b.w > 4 && b.h > 4) { const nb = { ...b, id: nextId++, on: true, manual: true, score: 1 }; fitBox(nb); boxes.push(nb); }
    } else { // clic: activar/desactivar caja bajo el cursor
      const p = pos(e), hit = boxes.filter(b => (b.manual || b.score >= +$('thr').value) && p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h)
        .sort((a, b) => a.w * a.h - b.w * b.h)[0];
      if (hit) hit.on = !hit.on;
    }
    draft = null; start = null; refresh();
  });
})();

// ---------- descarga ----------
function syncFmt() { $('ql').style.display = $('fmt').value === 'jpeg' ? '' : 'none'; }
$('fmt').onchange = syncFmt;
$('download').onclick = () => {
  const type = $('fmt').value === 'png' ? 'image/png' : 'image/jpeg';
  out.toBlob(blob => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `${name}-sin-matriculas.${type === 'image/png' ? 'png' : 'jpg'}`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }, type, +$('quality').value / 100);
};

// ---------- eventos ----------
const drop = $('drop');
$('pick').onclick = e => { e.stopPropagation(); $('file').click(); };
drop.onclick = () => $('file').click();
$('file').onchange = e => loadFile(e.target.files[0]);
$('another').onclick = () => { $('work').style.display = 'none'; drop.style.display = ''; $('file').value = ''; };
for (const t of ['dragenter', 'dragover']) addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); });
for (const t of ['dragleave', 'drop']) addEventListener(t, e => { e.preventDefault(); drop.classList.remove('over'); });
addEventListener('drop', e => loadFile(e.dataTransfer.files[0]));
$('redetect').onclick = runDetect;
$('fit').onchange = () => { fitAll(); refresh(); };
$('model').onchange = runDetect;
for (const id of ['mode', 'pad', 'feather', 'strength', 'thr']) $(id).oninput = () => {
  $('padv').textContent = $('pad').value + 'px'; $('featherv').textContent = $('feather').value + 'px'; $('thrv').textContent = $('thr').value;
  $('strl').hidden = !['blur','pixel'].includes($('mode').value); refresh();
};
async function updateLamaLabel() {
  const o = [...$('mode').options].find(x => x.value === 'lama');
  o.textContent = (await lamaInstalled()) ? 'Inteligente (IA, LaMa · instalado)' : 'Inteligente (IA, LaMa · descarga única de 198 MB)';
}
updateLamaLabel();
window.__appReady = true;
window.__test = { loadFile, get boxes() { return boxes; }, render }; // gancho para pruebas
