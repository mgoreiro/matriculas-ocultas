// Ajusta la caja del detector a la silueta real de la matrícula (polígono convexo) para ocultar solo la matrícula.
// Idea: la matrícula es una zona clara (o azul, la banda UE) frente a la carrocería; se toma el componente conectado
// claro/azul que coincide con la caja y se calcula su envolvente convexa. Si no hay contraste fiable devuelve null
// y se usa la caja del detector.
const cv = document.createElement('canvas');

function hullOf(pts) { // cadena monótona de Andrew; pts: [[x,y],...]
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of pts) { while (lo.length >= 2 && cross(lo.at(-2), lo.at(-1), p) <= 0) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cross(up.at(-2), up.at(-1), p) <= 0) up.pop(); up.push(p); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
function area(poly) { let s = 0; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s) / 2; }
function dp(pts, eps) { // Douglas-Peucker sobre un tramo abierto
  if (pts.length < 3) return pts;
  const a = pts[0], b = pts.at(-1), dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
  let m = 0, mi = 0;
  for (let i = 1; i < pts.length - 1; i++) { const d = Math.abs(dy * (pts[i][0] - a[0]) - dx * (pts[i][1] - a[1])) / len; if (d > m) { m = d; mi = i; } }
  if (m <= eps) return [a, b];
  return dp(pts.slice(0, mi + 1), eps).slice(0, -1).concat(dp(pts.slice(mi), eps));
}
function simplify(poly, eps) {
  let k = 0, md = 0;
  for (let i = 1; i < poly.length; i++) { const d = Math.hypot(poly[i][0] - poly[0][0], poly[i][1] - poly[0][1]); if (d > md) { md = d; k = i; } }
  const a = dp(poly.slice(0, k + 1), eps), b = dp(poly.slice(k).concat([poly[0]]), eps);
  return a.slice(0, -1).concat(b.slice(0, -1));
}


// Reduce un polígono convexo a un cuadrilátero: colapsa repetidamente la arista que, al prolongar sus vecinas,
// añade menos área. El resultado envuelve la silueta de forma ajustada (admite perspectiva).
function toQuad(poly) {
  let p = poly.map(q => q.slice());
  const inter = (a, b, c, d) => { // recta ab con recta cd -> {pt,t,u}
    const r = [b[0] - a[0], b[1] - a[1]], q = [d[0] - c[0], d[1] - c[1]], den = r[0] * q[1] - r[1] * q[0];
    if (Math.abs(den) < 1e-9) return null;
    const t = ((c[0] - a[0]) * q[1] - (c[1] - a[1]) * q[0]) / den, u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
    return { pt: [a[0] + t * r[0], a[1] + t * r[1]], t, u };
  };
  while (p.length > 4) {
    const n = p.length; let best = null;
    for (let i = 0; i < n; i++) {
      const a = p[(i - 1 + n) % n], b = p[i], c = p[(i + 1) % n], d = p[(i + 2) % n];
      const x = inter(a, b, d, c); // a->b prolongada con d->c prolongada
      let cost, pt = null;
      if (x && x.t > 1 && x.u > 1) { pt = x.pt; cost = area([b, pt, c]); }
      else cost = 1e12 + area([a, b, c]);
      if (!best || cost < best.cost) best = { cost, i, pt };
    }
    const { i, pt } = best, c = (i + 1) % n;
    if (pt) { p[i] = pt; p.splice(c, 1); } else p.splice(i, 1);
  }
  return p;
}

export function refinePlate(src, W, H, b) {
  const mx = Math.max(4, b.w * 0.2), my = Math.max(4, b.h * 0.2);
  const x0 = Math.max(0, Math.floor(b.x - mx)), y0 = Math.max(0, Math.floor(b.y - my));
  const x1 = Math.min(W, Math.ceil(b.x + b.w + mx)), y1 = Math.min(H, Math.ceil(b.y + b.h + my));
  const rw = x1 - x0, rh = y1 - y0, s = Math.min(1, 640 / rw);
  const w = Math.max(8, Math.round(rw * s)), h = Math.max(8, Math.round(rh * s));
  cv.width = w; cv.height = h;
  const c = cv.getContext('2d', { willReadFrequently: true });
  c.imageSmoothingQuality = 'high';
  c.drawImage(src, x0, y0, rw, rh, 0, 0, w, h);
  const d = c.getImageData(0, 0, w, h).data;
  const L = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) L[i] = d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11;
  const bx0 = (b.x - x0) * s, by0 = (b.y - y0) * s, bx1 = bx0 + b.w * s, by1 = by0 + b.h * s;
  const ring = [], inside = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (x >= bx0 && x < bx1 && y >= by0 && y < by1) inside.push(L[y * w + x]); else ring.push(L[y * w + x]);
  }
  if (ring.length < 20 || inside.length < 20) return null;
  ring.sort((a, b2) => a - b2); inside.sort((a, b2) => a - b2);
  const lring = ring[ring.length >> 1], lp = inside[Math.floor(inside.length * 0.9)];
  if (lp - lring < 35) return null; // sin contraste (p. ej. matrícula blanca sobre coche blanco)
  const thr = (lp + lring) / 2;
  // zona permitida: caja ampliada un 8 %
  const ax0 = bx0 - (bx1 - bx0) * 0.08, ax1 = bx1 + (bx1 - bx0) * 0.08, ay0 = by0 - (by1 - by0) * 0.08, ay1 = by1 + (by1 - by0) * 0.08;
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (x < ax0 || x >= ax1 || y < ay0 || y >= ay1) continue;
    const i = y * w + x, r = d[i * 4], g = d[i * 4 + 1], bl = d[i * 4 + 2];
    if (L[i] > thr || (bl - r > 30 && bl - g > 5 && bl > 70)) mask[i] = 1;
  }
  // componentes conectados; nos quedamos con el mayor cuyo centroide cae dentro de la caja
  const lab = new Int32Array(w * h); let best = null, id = 0;
  const stack = new Int32Array(w * h);
  for (let st = 0; st < w * h; st++) {
    if (!mask[st] || lab[st]) continue;
    id++; let sp = 0, n = 0, sx = 0, sy = 0; stack[sp++] = st; lab[st] = id;
    while (sp) {
      const i = stack[--sp], x = i % w, y = (i / w) | 0; n++; sx += x; sy += y;
      if (x > 0 && mask[i - 1] && !lab[i - 1]) { lab[i - 1] = id; stack[sp++] = i - 1; }
      if (x < w - 1 && mask[i + 1] && !lab[i + 1]) { lab[i + 1] = id; stack[sp++] = i + 1; }
      if (y > 0 && mask[i - w] && !lab[i - w]) { lab[i - w] = id; stack[sp++] = i - w; }
      if (y < h - 1 && mask[i + w] && !lab[i + w]) { lab[i + w] = id; stack[sp++] = i + w; }
    }
    const cx = sx / n, cy = sy / n;
    if (cx >= bx0 && cx < bx1 && cy >= by0 && cy < by1 && (!best || n > best.n)) best = { id, n };
  }
  if (!best || best.n < 0.2 * (bx1 - bx0) * (by1 - by0)) return null;
  const pts = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (lab[i] !== best.id) continue;
    if ((x > 0 && lab[i - 1] === best.id) && (x < w - 1 && lab[i + 1] === best.id) && (y > 0 && lab[i - w] === best.id) && (y < h - 1 && lab[i + w] === best.id)) continue;
    pts.push([x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]);
  }
  const hull = hullOf(pts);
  const ratio = area(hull) / ((bx1 - bx0) * (by1 - by0));
  if (hull.length < 3 || ratio < 0.35 || ratio > 1.3) return null;
  const quad = toQuad(simplify(hull, 0.5));
  if (quad.length !== 4) return null;
  return quad.map(([x, y]) => [x0 + x / s, y0 + y / s]);
}
