// Ocultación de una zona rectangular: relleno por difusión (con grano), desenfoque o pixelado.
// Todas las funciones leen/escriben directamente en un CanvasRenderingContext2D a resolución original.

function mulberry(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function gauss(rnd) { return Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd()); }

// Rellena los píxeles desconocidos interpolando los conocidos: pirámide push-pull + relajación (Laplace).
function diffuse(col, known, w, h) {
  const levels = [{ c: col, k: Float32Array.from(known), w, h }];
  while (levels.at(-1).w > 1 || levels.at(-1).h > 1) {
    const p = levels.at(-1), nw = (p.w + 1) >> 1, nh = (p.h + 1) >> 1;
    const c = new Float32Array(nw * nh * 3), k = new Float32Array(nw * nh);
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
      let sw = 0, r = 0, g = 0, b = 0, cnt = 0;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const px = 2 * x + dx, py = 2 * y + dy;
        if (px >= p.w || py >= p.h) continue;
        cnt++;
        const i = py * p.w + px, wt = p.k[i];
        sw += wt; r += p.c[i * 3] * wt; g += p.c[i * 3 + 1] * wt; b += p.c[i * 3 + 2] * wt;
      }
      const o = y * nw + x;
      k[o] = sw / cnt;
      if (sw > 0) { c[o * 3] = r / sw; c[o * 3 + 1] = g / sw; c[o * 3 + 2] = b / sw; }
    }
    levels.push({ c, k, w: nw, h: nh });
  }
  for (let l = levels.length - 2; l >= 0; l--) {
    const a = levels[l], b = levels[l + 1];
    for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) {
      const i = y * a.w + x, kw = a.k[i];
      if (kw >= 1) continue;
      const fx = Math.min(Math.max((x + 0.5) / 2 - 0.5, 0), b.w - 1), fy = Math.min(Math.max((y + 0.5) / 2 - 0.5, 0), b.h - 1);
      const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(x0 + 1, b.w - 1), y1 = Math.min(y0 + 1, b.h - 1);
      const tx = fx - x0, ty = fy - y0;
      for (let ch = 0; ch < 3; ch++) {
        const v = (b.c[(y0 * b.w + x0) * 3 + ch] * (1 - tx) + b.c[(y0 * b.w + x1) * 3 + ch] * tx) * (1 - ty) +
                  (b.c[(y1 * b.w + x0) * 3 + ch] * (1 - tx) + b.c[(y1 * b.w + x1) * 3 + ch] * tx) * ty;
        a.c[i * 3 + ch] = a.c[i * 3 + ch] * kw + v * (1 - kw);
      }
      a.k[i] = 1;
    }
  }
  // relajación Gauss-Seidel con sobre-relajación sobre los desconocidos
  const c = col, om = 1.5;
  for (let it = 0; it < 60; it++) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (known[i]) continue;
      for (let ch = 0; ch < 3; ch++) {
        let s = 0, n = 0;
        if (x > 0) { s += c[(i - 1) * 3 + ch]; n++; }
        if (x < w - 1) { s += c[(i + 1) * 3 + ch]; n++; }
        if (y > 0) { s += c[(i - w) * 3 + ch]; n++; }
        if (y < h - 1) { s += c[(i + w) * 3 + ch]; n++; }
        c[i * 3 + ch] += om * (s / n - c[i * 3 + ch]);
      }
    }
  }
}

function boxBlur(src, w, h, r) { // desenfoque de caja separable, bordes replicados; src Float32 RGB
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length), d = 2 * r + 1;
  for (let y = 0; y < h; y++) for (let ch = 0; ch < 3; ch++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += src[(y * w + Math.min(Math.max(k, 0), w - 1)) * 3 + ch];
    for (let x = 0; x < w; x++) {
      tmp[(y * w + x) * 3 + ch] = s / d;
      s += src[(y * w + Math.min(x + r + 1, w - 1)) * 3 + ch] - src[(y * w + Math.max(x - r, 0)) * 3 + ch];
    }
  }
  for (let x = 0; x < w; x++) for (let ch = 0; ch < 3; ch++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += tmp[(Math.min(Math.max(k, 0), h - 1) * w + x) * 3 + ch];
    for (let y = 0; y < h; y++) {
      out[(y * w + x) * 3 + ch] = s / d;
      s += tmp[(Math.min(y + r + 1, h - 1) * w + x) * 3 + ch] - tmp[(Math.max(y - r, 0) * w + x) * 3 + ch];
    }
  }
  return out;
}


// Busca en la propia imagen el parche (desplazado) cuyo contorno mejor encaje con el de la zona a rellenar
// y lo clona con corrección de color por difusión (clonado "seamless" aproximado). Devuelve null si no hay candidato fiable.
// U: máscara (ROI) de la zona a sustituir; ring: puntos [x,y] (px de imagen) justo fuera de U.
function exemplarFill(ctx, W, H, U, bb, ring, rx0, ry0, w, h, orig) {
  const [fx0, fy0, fx1, fy1] = bb, tw = fx1 - fx0, th = fy1 - fy0, B = 3;
  const e = Math.round(1.5 * Math.max(tw, th));
  const wx0 = Math.max(0, fx0 - e - B), wy0 = Math.max(0, fy0 - e - B), wx1 = Math.min(W, fx1 + e + B), wy1 = Math.min(H, fy1 + e + B);
  const ww = wx1 - wx0, wh = wy1 - wy0, win = ctx.getImageData(wx0, wy0, ww, wh).data;
  const at = (x, y) => ((y - wy0) * ww + (x - wx0)) * 4;
  const band = [];
  for (let k = 0; k < ring.length; k += 2) if (((ring[k] + ring[k + 1]) & 1) === 0) band.push(ring[k], ring[k + 1]);
  if (band.length < 16) return null;
  const CLAMP = 3000;
  let lastRg = 0;
  const bm = [0, 0, 0];
  for (let k = 0; k < band.length; k += 2) { const a = at(band[k], band[k + 1]); bm[0] += win[a]; bm[1] += win[a + 1]; bm[2] += win[a + 2]; }
  for (let c = 0; c < 3; c++) bm[c] /= band.length / 2;
  const cost = (dx, dy) => {
    if (fx0 + dx - B < 0 || fy0 + dy - B < 0 || fx1 + dx + B > W || fy1 + dy + B > H) return Infinity;
    if (Math.abs(dx) < tw + 2 * B && Math.abs(dy) < th + 2 * B) return Infinity; // solapa con la zona a tapar
    let s = 0;
    for (let k = 0; k < band.length; k += 2) {
      const a = at(band[k], band[k + 1]), b = at(band[k] + dx, band[k + 1] + dy);
      const r = win[a] - win[b], g = win[a + 1] - win[b + 1], bl = win[a + 2] - win[b + 2];
      s += Math.min(r * r + g * g + bl * bl, CLAMP); // robusto: un obstáculo (retrovisor, sombra) no decide
    }
    // prefiere parches lisos y de color parecido al contorno: evita clonar aristas, cristales, neumáticos...
    let rg = 0, n = 0, m0 = 0, m1 = 0, m2 = 0, off = 0;
    for (let y = fy0 + dy; y < fy1 + dy - 1; y += 2) for (let x = fx0 + dx; x < fx1 + dx - 1; x += 2) {
      const a = at(x, y), l = win[a] * 0.3 + win[a + 1] * 0.59 + win[a + 2] * 0.11;
      const b = at(x + 1, y), c = at(x, y + 1);
      rg += Math.abs(l - (win[b] * 0.3 + win[b + 1] * 0.59 + win[b + 2] * 0.11)) + Math.abs(l - (win[c] * 0.3 + win[c + 1] * 0.59 + win[c + 2] * 0.11));
      n++; if ((win[a] - bm[0]) ** 2 + (win[a + 1] - bm[1]) ** 2 + (win[a + 2] - bm[2]) ** 2 > 7500) off++;
      m0 += win[a]; m1 += win[a + 1]; m2 += win[a + 2];
    }
    n = Math.max(n, 1); lastRg = rg / n;
    const cm = (m0 / n - bm[0]) ** 2 + (m1 / n - bm[1]) ** 2 + (m2 / n - bm[2]) ** 2;
    return s / (band.length / 2) + 0.02 * Math.hypot(dx, dy) + 0.3 * Math.abs(dx) + 200 * rg / n + 2 * cm + 500000 * off / n;
  };
  let best = { c: Infinity, dx: 0, dy: 0 };
  const search = (cx, cy, rng, step) => {
    for (let dy = cy - rng; dy <= cy + rng; dy += step) for (let dx = cx - rng; dx <= cx + rng; dx += step) {
      const c = cost(dx, dy); if (c < best.c) best = { c, dx, dy };
    }
  };
  const step = Math.max(2, Math.round(Math.min(tw, th) / 6));
  search(0, 0, e, step);
  if (!isFinite(best.c)) return null;
  search(best.dx, best.dy, step, Math.max(1, Math.round(step / 3)));
  const { dx, dy } = best;
  cost(dx, dy);
  if (lastRg > 3.5) return null; // demasiadas aristas (pliegues, rótulos): mejor difusión suave
  const fill = Float32Array.from(orig), D = new Float32Array(w * h * 3), known = new Uint8Array(w * h);
  for (let k = 0; k < ring.length; k += 2) {
    const x = ring[k], y = ring[k + 1], i = (y - ry0) * w + (x - rx0), b = at(x + dx, y + dy);
    let sq = 0;
    for (let ch = 0; ch < 3; ch++) { D[i * 3 + ch] = orig[i * 3 + ch] - win[b + ch]; sq += D[i * 3 + ch] ** 2; }
    known[i] = sq < 4 * CLAMP ? 1 : 0; // descarta puntos del contorno que no encajan con el parche
  }
  diffuse(D, known, w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (!U[i]) continue;
    const b = at(rx0 + x + dx, ry0 + y + dy);
    for (let ch = 0; ch < 3; ch++) fill[i * 3 + ch] = win[b + ch] + D[i * 3 + ch];
  }
  return fill;
}

function boxBlur1(a, w, h, r) { // desenfoque de caja 1 canal
  const t = new Float32Array(a.length), o = new Float32Array(a.length), d = 2 * r + 1;
  for (let y = 0; y < h; y++) { let s = 0; for (let k = -r; k <= r; k++) s += a[y * w + Math.min(Math.max(k, 0), w - 1)];
    for (let x = 0; x < w; x++) { t[y * w + x] = s / d; s += a[y * w + Math.min(x + r + 1, w - 1)] - a[y * w + Math.max(x - r, 0)]; } }
  for (let x = 0; x < w; x++) { let s = 0; for (let k = -r; k <= r; k++) s += t[Math.min(Math.max(k, 0), h - 1) * w + x];
    for (let y = 0; y < h; y++) { o[y * w + x] = s / d; s += t[Math.min(y + r + 1, h - 1) * w + x] - t[Math.max(y - r, 0) * w + x]; } }
  return o;
}
function dilate(m, w, h, r) { // máximo en ventana cuadrada (r px)
  const t = new Float32Array(m.length), o = new Float32Array(m.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = 0; for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) if (m[y * w + k]) { v = 1; break; } t[y * w + x] = v; }
  for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) { let v = 0; for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) if (t[k * w + x]) { v = 1; break; } o[y * w + x] = v; }
  return o;
}
function inPoly(poly, x, y) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
function grow(poly, padPct, minPx) { // aleja los vértices del centro del recuadro
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of poly) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return poly.map(([x, y]) => { const dx = x - cx, dy = y - cy, l = Math.hypot(dx, dy) || 1, n = l * (1 + padPct / 100) + minPx; return [cx + dx / l * n, cy + dy / l * n]; });
}

// box: {x,y,w,h, poly?} en px de imagen (poly = silueta ajustada de la matrícula).
// mode: 'fill' (clonado de parche cercano) | 'smooth' (difusión) | 'white' | 'blur' | 'pixel'.
// pad: % de ampliación; feather: px de difuminado del borde.
export function hideBox(ctx, W, H, box, { mode, pad, feather, strength }) {
  const base = box.poly || [[box.x, box.y], [box.x + box.w, box.y], [box.x + box.w, box.y + box.h], [box.x, box.y + box.h]];
  let ys = base.map(q => q[1]), hh = Math.max(...ys) - Math.min(...ys);
  const poly = grow(base, pad, Math.max(2, Math.min(6, hh * 0.1)));
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (const [x, y] of poly) { bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y); }
  const f = Math.max(0, Math.round(feather)), r1 = Math.ceil(f / 2);
  const m = Math.max(8, Math.round(Math.min(bx1 - bx0, by1 - by0) * 0.4)) + f;
  const rx0 = Math.max(0, Math.floor(bx0) - m), ry0 = Math.max(0, Math.floor(by0) - m);
  const rx1 = Math.min(W, Math.ceil(bx1) + m), ry1 = Math.min(H, Math.ceil(by1) + m);
  const w = rx1 - rx0, h = ry1 - ry0;
  if (w < 2 || h < 2) return;
  const img = ctx.getImageData(rx0, ry0, w, h), d = img.data;
  const orig = new Float32Array(w * h * 3);
  for (let i = 0; i < w * h; i++) { orig[i * 3] = d[i * 4]; orig[i * 3 + 1] = d[i * 4 + 1]; orig[i * 3 + 2] = d[i * 4 + 2]; }
  // M: silueta; alpha: M ampliada r1 y suavizada r1 (=1 sobre M, rampa hacia fuera); U: donde alpha > 0
  const M = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (inPoly(poly, rx0 + x + 0.5, ry0 + y + 0.5)) M[y * w + x] = 1;
  let alpha = r1 ? boxBlur1(dilate(M, w, h, r1), w, h, r1) : Float32Array.from(M);
  const U = new Uint8Array(w * h);
  let ux0 = w, uy0 = h, ux1 = 0, uy1 = 0, nU = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (alpha[y * w + x] > 0.001) {
    U[y * w + x] = 1; nU++; ux0 = Math.min(ux0, x); uy0 = Math.min(uy0, y); ux1 = Math.max(ux1, x + 1); uy1 = Math.max(uy1, y + 1);
  }
  if (!nU || nU === w * h) return;
  let fill = null;
  if (mode === 'fill') {
    const Ud = dilate(U, w, h, 3), ring = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (Ud[y * w + x] && !U[y * w + x]) ring.push(rx0 + x, ry0 + y);
    fill = exemplarFill(ctx, W, H, U, [rx0 + ux0, ry0 + uy0, rx0 + ux1, ry0 + uy1], ring, rx0, ry0, w, h, orig);
  }
  if (!fill && (mode === 'fill' || mode === 'smooth')) {
    const known = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) known[i] = U[i] ? 0 : 1;
    fill = Float32Array.from(orig);
    let acc = 0, cnt = 0;
    const l = j => orig[j * 3] * 0.3 + orig[j * 3 + 1] * 0.59 + orig[j * 3 + 2] * 0.11;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!(known[i] && known[i - 1] && known[i + 1] && known[i - w] && known[i + w])) continue;
      const e = l(i) - (l(i - 1) + l(i + 1) + l(i - w) + l(i + w)) / 4;
      acc += e * e; cnt++;
    }
    const sigma = Math.min(5, Math.sqrt(acc / Math.max(cnt, 1) / 1.25)) * 0.35;
    diffuse(fill, known, w, h);
    const rnd = mulberry(1234 + rx0 * 31 + ry0);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (known[y * w + x]) continue;
      const i = y * w + x, gl = gauss(rnd) * sigma;
      for (let ch = 0; ch < 3; ch++) fill[i * 3 + ch] += gl * 0.8 + gauss(rnd) * sigma * 0.2;
    }
  } else if (mode === 'white') {
    // blanco "de matrícula": media de la quinta parte más clara de los píxeles de la silueta
    const px = [];
    for (let i = 0; i < w * h; i++) if (M[i]) px.push([orig[i * 3] * 0.3 + orig[i * 3 + 1] * 0.59 + orig[i * 3 + 2] * 0.11, i]);
    px.sort((a, b) => b[0] - a[0]);
    const top = px.slice(0, Math.max(1, Math.floor(px.length / 5))); let r = 0, g = 0, b = 0;
    for (const [, i] of top) { r += orig[i * 3]; g += orig[i * 3 + 1]; b += orig[i * 3 + 2]; }
    const c = [r, g, b].map(v => Math.min(255, v / top.length * 1.12));
    fill = new Float32Array(w * h * 3);
    for (let i = 0; i < w * h; i++) { fill[i * 3] = c[0]; fill[i * 3 + 1] = c[1]; fill[i * 3 + 2] = c[2]; }
  } else if (mode === 'blur') {
    const r = Math.max(2, Math.round(Math.min(bx1 - bx0, by1 - by0) * 0.08 * strength));
    fill = boxBlur(boxBlur(boxBlur(orig, w, h, r), w, h, r), w, h, r);
  } else if (mode === 'pixel') {
    const bs = Math.max(3, Math.round(Math.min(bx1 - bx0, by1 - by0) / (11 - strength)));
    fill = Float32Array.from(orig);
    for (let by = uy0; by < uy1; by += bs) for (let bx = ux0; bx < ux1; bx += bs) {
      const x1 = Math.min(bx + bs, w), y1 = Math.min(by + bs, h);
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = by; y < y1; y++) for (let x = bx; x < x1; x++) { const i = y * w + x; r += orig[i * 3]; g += orig[i * 3 + 1]; b += orig[i * 3 + 2]; n++; }
      for (let y = by; y < y1; y++) for (let x = bx; x < x1; x++) { const i = y * w + x; fill[i * 3] = r / n; fill[i * 3 + 1] = g / n; fill[i * 3 + 2] = b / n; }
    }
  }
  for (let i = 0; i < w * h; i++) {
    const a = alpha[i];
    if (a <= 0.001) continue;
    for (let ch = 0; ch < 3; ch++) {
      const v = orig[i * 3 + ch] * (1 - a) + fill[i * 3 + ch] * a;
      d[i * 4 + ch] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
  }
  ctx.putImageData(img, rx0, ry0);
}
