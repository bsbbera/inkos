// Ochin shape kit for Quire builds: geo (trimmed) + shapes.js + finish.js + ochin-shape-tool.js.
// Generated from Output/Brand/photo-film by brands/ochin/kit/build.sh; edit the sources, not this.
// Ornament geometry. Pure maths, no Affinity calls, so it runs under Node for tests.
// Units: mm, y points down. A shape is an array of [x, y]; `shape.c = true` marks it closed,
// `shape.k` (1 or 2) paints a fill in accent colour 1 or 2 instead of the solid colour.
// Every generator returns { strokes: [shapes], fills: [shapes] }.
const G = (() => {
  const TAU = Math.PI * 2;

  function rng(seed) {                       // mulberry32: same seed, same ornament
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const pick = (r, a) => a[Math.floor(r() * a.length)];
  const closed = p => { p.c = true; return p; };
  const out = () => ({ strokes: [], fills: [] });
  const merge = (d, s) => { d.strokes.push(...s.strokes); d.fills.push(...s.fills); return d; };

  // move / rotate / scale / mirror a whole ornament
  function xf(o, { x = 0, y = 0, a = 0, s = 1, mx = false }) {
    const c = Math.cos(a), sn = Math.sin(a);
    const f = sh => {
      const r = sh.map(([px, py]) => { px *= mx ? -s : s; py *= s; return [x + px * c - py * sn, y + px * sn + py * c]; });
      r.c = sh.c; if (sh.k) r.k = sh.k; if (sh.u) r.u = true; return r;
    };
    return { strokes: o.strokes.map(f), fills: o.fills.map(f) };
  }

  function circle(cx, cy, r, n = 96) {
    const p = [];
    for (let i = 0; i < n; i++) p.push([cx + r * Math.cos(i / n * TAU), cy + r * Math.sin(i / n * TAU)]);
    return closed(p);
  }

  // Walk a curve by heading: head(t) gives the direction at t in [0,1].
  function walk(x, y, len, head, n = 60) {
    const p = [[x, y]];
    for (let i = 1; i <= n; i++) {
      const a = head((i - 0.5) / n);
      x += Math.cos(a) * len / n; y += Math.sin(a) * len / n; p.push([x, y]);
    }
    return p;
  }

  // Closed outline of a brush stroke along centreline c with half-width w(t);
  // ends with non-zero width get a round cap. Petals, fish, paisley, conch all come from this.
  function tube(c, w) {
    const N = c.length - 1, L = [], R = [];
    const tan = i => {
      const a = c[Math.max(0, i - 1)], b = c[Math.min(N, i + 1)];
      const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
      return [dx / l, dy / l];
    };
    for (let i = 0; i <= N; i++) {
      const [tx, ty] = tan(i), k = w(i / N);
      L.push([c[i][0] - ty * k, c[i][1] + tx * k]);
      R.push([c[i][0] + ty * k, c[i][1] - tx * k]);
    }
    const cap = (i, from) => {
      const k = w(i / N); if (k < 1e-3) return [];
      const [tx, ty] = tan(i), a0 = Math.atan2(tx, -ty), p = [];
      for (let j = 1; j < 14; j++) { const a = a0 + from - Math.PI * j / 14; p.push([c[i][0] + k * Math.cos(a), c[i][1] + k * Math.sin(a)]); }
      return p;
    };
    return closed([...L, ...cap(N, 0), ...R.reverse(), ...cap(0, Math.PI)]);
  }

  // Dashes along a polyline: the kantha running stitch.
  function stitch(pts, dash, gap) {
    const segs = [], P = pts.c ? [...pts, pts[0]] : pts;
    let cur = [P[0]], on = true, left = dash;
    for (let i = 1; i < P.length; i++) {
      let [x0, y0] = P[i - 1]; const [x1, y1] = P[i];
      let d = Math.hypot(x1 - x0, y1 - y0);
      while (d > left) {
        const t = left / d; x0 += (x1 - x0) * t; y0 += (y1 - y0) * t; d -= left;
        if (on) { cur.push([x0, y0]); segs.push(cur); } else cur = [[x0, y0]];
        on = !on; left = on ? dash : gap;
      }
      left -= d; if (on) cur.push([x1, y1]);
    }
    if (on && cur.length > 1) segs.push(cur);
    return segs;
  }

  function area(p) { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; } return a / 2; }
  // one winding for every fill, so overlapping fills never punch holes
  const orient = p => (area(p) < 0 ? Object.assign(p.slice().reverse(), { c: p.c, k: p.k, u: p.u }) : p);

  // ---- paths: at(s) -> [point, outward unit normal]; tangent is (-ny, nx) --------
  const circlePath = r => ({ L: TAU * r, c: true, at: s => { const a = s / r; return [[r * Math.cos(a), r * Math.sin(a)], [Math.cos(a), Math.sin(a)]]; } });

  function rectPath(x, y, w, h, rc) {
    const segs = [w - 2 * rc, Math.PI * rc / 2, h - 2 * rc, Math.PI * rc / 2, w - 2 * rc, Math.PI * rc / 2, h - 2 * rc, Math.PI * rc / 2];
    const L = segs.reduce((a, b) => a + b, 0);
    const corners = [[x + w - rc, y + rc], [x + w - rc, y + h - rc], [x + rc, y + h - rc], [x + rc, y + rc]];
    const starts = [[x + rc, y], [x + w, y + rc], [x + w - rc, y + h], [x, y + h - rc]];
    const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    return {
      L, c: true, at(s) {
        s = ((s % L) + L) % L;
        for (let k = 0; k < 8; k++) {
          if (s <= segs[k] || k === 7) {
            const side = k >> 1;
            if (k % 2 === 0) { const p = starts[side], d = dirs[side]; return [[p[0] + d[0] * s, p[1] + d[1] * s], [d[1], -d[0]]]; }
            const a = -Math.PI / 2 + side * Math.PI / 2 + s / rc, c = corners[side];
            return [[c[0] + rc * Math.cos(a), c[1] + rc * Math.sin(a)], [Math.cos(a), Math.sin(a)]];
          }
          s -= segs[k];
        }
      },
    };
  }

  function trace(path, off = 0, n = 400) {
    const p = [];
    for (let i = 0; i < n; i++) { const [q, m] = path.at(i / n * path.L); p.push([q[0] + m[0] * off, q[1] + m[1] * off]); }
    return path.c ? closed(p) : p;
  }

  function dotsOn(path, count, r, off = 0) {
    const o = out();
    for (let i = 0; i < count; i++) { const [q, m] = path.at((i + 0.5) / count * path.L); o.fills.push(circle(q[0] + m[0] * off, q[1] + m[1] * off, r, 24)); }
    return o;
  }

  // ---- Bengali motifs. Unit size: height 1, base at origin, pointing up (-y) ------
  // Each takes an optional rng r: without it you get the classic drawing, with it a seeded variant.
  // shared by every generator for one build: petal/leaf/grain width multiplier, forced motif style
  // w: per-kind width multipliers the studio can aim at one group of shapes: diamond, drop, dot, ray
  const OPT = { petalW: 1, style: '', w: {} };
  const wOf = k => OPT.w[k] ?? 1;
  function withOpts(o, fn) { const keep = { ...OPT }; Object.assign(OPT, o); try { return fn(); } finally { Object.assign(OPT, keep); } }
  function petal(width = 0.36) {
    width *= OPT.petalW;
    return tube(walk(0, 0, 1, () => -Math.PI / 2, 64), t => width / 2 * Math.pow(Math.sin(Math.PI * t), 0.75) * (1 - 0.25 * t));
  }
  const Fp = (w, o) => xf({ strokes: [], fills: [petal(w)] }, o).fills[0];
  const Sp = (w, o) => xf({ strokes: [petal(w)], fills: [] }, o).strokes[0];

  // padma: lotus, radius 1 around the origin. classic: outlined back ring with echo, solid front ring.
  function padma(n = 8, width = 0.42, r) {
    const o = out(), style = r ? pick(r, ['classic', 'classic', 'solid', 'layered']) : 'classic';
    if (r) { n = pick(r, [6, 8, 10, 12]); width = 0.34 + r() * 0.14; }
    for (let i = 0; i < n; i++) {
      const a = i / n * TAU, b = a + Math.PI / n, at = (ang, rad, s) => ({ x: Math.cos(ang) * rad, y: Math.sin(ang) * rad, a: ang + Math.PI / 2, s });
      if (style === 'layered') {
        o.strokes.push(Sp(width, at(a, 0.16, 0.84)), Sp(width * 0.9, at(b, 0.15, 0.6)), Sp(width * 0.8, at(a, 0.14, 0.38)));
        continue;
      }
      if (style === 'solid') { o.fills.push(Fp(width * 0.72, at(a, 0.16, 0.84))); continue; }
      o.strokes.push(...xf({ strokes: [petal(width), Sp(width * 0.7, { y: -0.12, s: 0.62 })], fills: [] }, at(a, 0.16, 0.84)).strokes);
      o.fills.push(Fp(width * 0.9, at(b, 0.14, 0.5)));
    }
    if (r && r() < 0.4) { o.fills.push(circle(0, 0, 0.06, 32)); for (let i = 0; i < n; i++) { const a = (i + 0.5) / n * TAU; o.fills.push(circle(Math.cos(a) * 0.11, Math.sin(a) * 0.11, 0.022, 14)); } }
    else o.fills.push(circle(0, 0, 0.1, 48));
    o.strokes.push(circle(0, 0, 0.145, 60));
    return o;
  }

  // kalka: paisley. Round belly, tail sweeping over and curling; inside: nested, dots, stripes or double.
  function kalka(bend = 2.4, r) {
    if (r) bend = 1.9 + r() * 0.9;
    const deco = r ? pick(r, ['nested', 'dots', 'stripes', 'double']) : 'nested';
    const head = t => -Math.PI / 2 + bend * Math.pow(t, 2.2), spine = walk(0, 0, 1, head, 70), wd = t => 0.3 * Math.pow(1 - t, 1.15);
    const body = (r0, len) => tube(walk(0, 0, len, head, 70), t => r0 * Math.pow(1 - t, 1.15));
    const o = out();
    o.strokes.push(tube(spine, wd));
    if (deco === 'nested' || deco === 'double') {
      o.strokes.push(xf({ strokes: [body(0.3, 0.9)], fills: [] }, { y: -0.04, s: 0.58 }).strokes[0]);
      if (deco === 'double') o.strokes.push(xf({ strokes: [body(0.3, 0.9)], fills: [] }, { y: -0.06, s: 0.3 }).strokes[0]);
      o.fills.push(circle(0, -0.04, deco === 'double' ? 0.04 : 0.08, 36));
    } else if (deco === 'dots') {
      for (let i = 3; i < 50; i += 6) { const t = i / 70; o.fills.push(circle(spine[i][0], spine[i][1], wd(t) * 0.38, 18)); }
    } else {
      for (let i = 4; i < 52; i += 5) {
        const t = i / 70, [x, y] = spine[i], [x2, y2] = spine[i + 1], a = Math.atan2(y2 - y, x2 - x) + Math.PI / 2, k = wd(t) * 0.62;
        o.strokes.push([[x - Math.cos(a) * k, y - Math.sin(a) * k], [x + Math.cos(a) * k, y + Math.sin(a) * k]]);
      }
    }
    return o;
  }

  // Catmull-Rom through the given points (drawn motifs are set as a few points, then smoothed).
  function cr(pts, isClosed, per = 10) {
    const N = pts.length, o = [], at = i => pts[isClosed ? (i + N) % N : Math.max(0, Math.min(N - 1, i))];
    for (let i = 0; i < (isClosed ? N : N - 1); i++) {
      const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
      for (let j = 0; j < per; j++) {
        const t = j / per, t2 = t * t, t3 = t2 * t;
        o.push([0, 1].map(d => 0.5 * (2 * p1[d] + (-p0[d] + p2[d]) * t + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * t2 + (-p0[d] + 3 * p1[d] - 3 * p2[d] + p3[d]) * t3)));
      }
    }
    if (!isClosed) o.push(pts[N - 1]);
    return isClosed ? closed(o) : o;
  }
  // mirror a right-hand half outline (top to bottom) into a symmetric closed outline
  const sym = half => [...half, ...half.slice(1, -1).reverse().map(([x, y]) => [-x, y])];

  // matsya: fish from above, head up: forked tail, two eyes, gill arc, scales, fins.
  // opt.scales: chevron | arcs | dots | net; opt.fins: solid | outline
  function matsya({ scales = 'chevron', fins = 'solid' } = {}) {
    const o = out();
    o.strokes.push(cr(sym([[0, -1], [0.08, -0.93], [0.15, -0.78], [0.17, -0.6], [0.14, -0.42], [0.08, -0.28], [0.04, -0.19],
      [0.12, -0.08], [0.2, 0.02], [0.08, -0.03], [0, -0.08]]), true, 8));
    for (const s of [-1, 1]) {
      o.fills.push(circle(s * 0.065, -0.86, 0.028, 20));
      const fin = { x: s * 0.15, y: -0.6, a: s * 2.2, s: 0.16 };
      if (fins === 'solid') o.fills.push(Fp(0.45, fin)); else o.strokes.push(Sp(0.45, fin));
    }
    o.strokes.push(cr([[-0.14, -0.72], [0, -0.77], [0.14, -0.72]], false, 10));
    const W = [0.15, 0.14, 0.11, 0.07];
    for (let k = 0; k < 4; k++) {
      const y = -0.66 + 0.1 * k, w = W[k];
      if (scales === 'chevron') o.strokes.push([[-w, y + 0.07], [0, y], [w, y + 0.07]]);
      else if (scales === 'net') o.strokes.push([[-w, y + 0.07], [0, y], [w, y + 0.07]], [[-w * 0.8, y], [0, y + 0.07], [w * 0.8, y]]);
      else if (scales === 'arcs') { const n = k < 2 ? 3 : 2; for (let j = 0; j < n; j++) { const x0 = -w + (2 * w) * j / n, x1 = x0 + 2 * w / n; o.strokes.push(cr([[x0, y + 0.02], [(x0 + x1) / 2, y + 0.075], [x1, y + 0.02]], false, 6)); } }
      else { const n = k < 2 ? 3 : 2; for (let j = 0; j < n; j++) o.fills.push(circle(-w * 0.6 + (n > 1 ? 1.2 * w * j / (n - 1) : 0), y + 0.04, 0.018, 12)); }
    }
    return o;
  }

  const matsyaPair = r => {
    const opt = r ? { scales: pick(r, ['chevron', 'arcs', 'dots', 'net']), fins: pick(r, ['solid', 'outline']) } : {};
    return merge(xf(matsya(opt), { x: -0.27, a: 0.06 }), xf(matsya(opt), { x: 0.27, a: -0.06, mx: true }));
  };

  // shankha: conch, spire up. Stepped whorls, broad shoulder, long siphon, aperture lip on the right.
  function shankha(r) {
    const o = out(), deco = r ? pick(r, ['dots', 'stripes', 'stitch']) : 'dots';
    o.strokes.push(cr([[0, -1], [0.05, -0.93], [0.1, -0.9], [0.12, -0.86], [0.2, -0.82], [0.22, -0.78], [0.33, -0.72], [0.37, -0.62],
      [0.34, -0.45], [0.25, -0.28], [0.13, -0.12], [0.04, -0.02], [0, 0], [-0.05, -0.06], [-0.14, -0.2], [-0.24, -0.4], [-0.28, -0.55],
      [-0.27, -0.66], [-0.2, -0.74], [-0.18, -0.78], [-0.12, -0.82], [-0.1, -0.86], [-0.05, -0.9], [-0.03, -0.95]], true, 8));
    o.strokes.push(cr([[0.31, -0.66], [0.14, -0.56], [0.07, -0.38], [0.05, -0.2], [0.02, -0.05]], false, 10));
    for (const [a, b, c] of [[[-0.05, -0.9], [0.03, -0.88], [0.1, -0.9]], [[-0.12, -0.82], [0.04, -0.79], [0.2, -0.82]], [[-0.2, -0.74], [0.06, -0.69], [0.31, -0.7]]])
      o.strokes.push(cr([a, b, c], false, 10));
    if (deco === 'dots') for (const [x, y] of [[-0.13, -0.52], [-0.1, -0.4], [-0.07, -0.28]]) o.fills.push(circle(x, y, 0.025, 18));
    else {
      const lines = [0.08, 0.15].map(d => cr([[0.2 - d * 1.4, -0.64], [0.04 - d, -0.54], [-0.02 - d * 0.8, -0.38], [-0.02 - d * 0.5, -0.2]], false, 10));
      if (deco === 'stripes') o.strokes.push(...lines); else for (const l of lines) o.strokes.push(...stitch(l, 0.04, 0.03));
    }
    return o;
  }

  // dhaner shish: ears of rice, drooping stems, grains alternating. Variants: 1-3 stalks, grain count, droop.
  function shish(r) {
    const o = out(), stalks = r ? pick(r, [1, 1, 2, 3]) : 1, g = r ? 7 + Math.floor(r() * 5) : 9, bend = r ? 0.45 + r() * 0.5 : 0.7, solid = r ? r() < 0.75 : true;
    for (let s = 0; s < stalks; s++) {
      const rot = (s - (stalks - 1) / 2) * 0.38, dir = rot < 0 ? -1 : 1, len = 1 - Math.abs(rot) * 0.35;
      const stem = walk(0, 0, len, t => -Math.PI / 2 + rot + dir * bend * t * t, 80);
      o.strokes.push(stem);
      const grain = (x, y, a) => { const q = { x, y, a, s: 0.15 }; if (solid) o.fills.push(Fp(0.42, q)); else o.strokes.push(Sp(0.42, q)); };
      for (let k = 0; k < g; k++) {
        const i = Math.round(28 + k * 50 / (g - 1)), [px, py] = stem[i], [qx, qy] = stem[i + 1], h = Math.atan2(qy - py, qx - px);
        grain(px, py, h + Math.PI / 2 + (k % 2 ? 1 : -1) * 0.55);
      }
      const [tx, ty] = stem[80], [ux, uy] = stem[79];
      grain(tx, ty, Math.atan2(ty - uy, tx - ux) + Math.PI / 2);
    }
    return o;
  }

  // pakhi: folk bird in profile, facing right, standing on the base. Wing and tail decorations vary.
  function pakhi(r) {
    const o = out(), wing = r ? pick(r, ['stripes', 'dots', 'chevrons', 'solid', 'feathers']) : 'stripes', tails = r ? pick(r, [2, 3, 3, 4]) : 3, crest = r ? r() < 0.4 : false;
    o.strokes.push(cr([[-0.34, -0.44], [-0.18, -0.6], [0.04, -0.64], [0.2, -0.6], [0.26, -0.71], [0.34, -0.79], [0.43, -0.79], [0.48, -0.73], [0.45, -0.65],
      [0.36, -0.57], [0.31, -0.42], [0.18, -0.28], [0, -0.24], [-0.18, -0.29], [-0.3, -0.37]], true, 8));
    o.fills.push(closed([[0.47, -0.765], [0.6, -0.74], [0.47, -0.71]]), circle(0.405, -0.745, 0.024, 16));
    o.strokes.push(circle(0.405, -0.745, 0.045, 24));
    const wq = { x: 0.2, y: -0.46, a: -1.37, s: 0.44 }, w = xf({ strokes: [petal(0.5)], fills: [] }, wq).strokes[0];
    if (wing === 'solid') o.fills.push(closed(w.slice())); else o.strokes.push(w);
    if (wing === 'stripes') for (let i = 1; i < 5; i++) { const t = i / 5; o.strokes.push([[0.2 - 0.43 * t, -0.46 - 0.09 * t + 0.07], [0.2 - 0.43 * t, -0.46 - 0.09 * t - 0.07]]); }
    else if (wing === 'dots') for (let i = 1; i < 4; i++) o.fills.push(circle(0.2 - 0.12 * i, -0.47 - 0.02 * i, 0.02, 12));
    else if (wing === 'chevrons') for (let i = 1; i < 4; i++) { const x = 0.2 - 0.11 * i; o.strokes.push([[x + 0.05, -0.53], [x, -0.47], [x + 0.05, -0.41]]); }
    else if (wing === 'feathers') for (let i = 0; i < 3; i++) o.strokes.push(Sp(0.4, { x: 0.12 - i * 0.09, y: -0.44, a: -1.9, s: 0.14 }));
    for (let i = 0; i < tails; i++) { const a = -1.9 - 0.5 + i * (1 / Math.max(1, tails - 1)) * 0.9; o.fills.push(Fp(0.42, { x: -0.3, y: -0.4, a, s: 0.3 })); }
    for (const x of [0.02, 0.12]) o.strokes.push([[x, -0.26], [x - 0.02, 0]], [[x - 0.07, 0], [x + 0.05, 0]]);
    if (crest) for (let i = -1; i <= 1; i++) o.fills.push(Fp(0.5, { x: 0.36, y: -0.78, a: i * 0.45 - 0.3, s: 0.12 }));
    return o;
  }

  // surya: sun disc, radius 1 around the origin. Rays: triangles, wavy flames or petals; centre: face ring, spiral or dots.
  function surya(r) {
    const o = out(), n = r ? pick(r, [12, 16, 18, 24]) : 16, rays = r ? pick(r, ['triangles', 'wavy', 'petals']) : 'triangles', core = r ? pick(r, ['rings', 'spiral', 'dots']) : 'rings';
    o.strokes.push(circle(0, 0, 0.5, 120)); o.fills.push(circle(0, 0, 0.44, 120));
    for (let i = 0; i < n; i++) {
      const a = i / n * TAU, long = i % 2 === 0, L = long ? 1 : 0.8, c = Math.cos(a), s = Math.sin(a), h = Math.PI / n * 0.7 * wOf('ray');
      if (rays === 'triangles') o.fills.push(closed([[Math.cos(a - h) * 0.55, Math.sin(a - h) * 0.55], [c * L, s * L], [Math.cos(a + h) * 0.55, Math.sin(a + h) * 0.55]]));
      else if (rays === 'wavy') o.fills.push(tube(Array.from({ length: 30 }, (_, j) => { const t = j / 29, q = 0.55 + t * (L - 0.55), wv = 0.04 * Math.sin(t * TAU * 1.5); return [c * q - s * wv, s * q + c * wv]; }), t => 0.035 * (1 - t) + 0.004));
      else o.strokes.push(Sp(0.36, { x: c * 0.55, y: s * 0.55, a: a + Math.PI / 2, s: L - 0.55 }));
    }
    const ring = K(circle(0, 0, 0.36, 100), 3);
    if (core === 'rings') o.fills.push(ring, circle(0, 0, 0.3, 80), K(circle(0, 0, 0.12, 40), 3));
    else if (core === 'spiral') o.fills.push(K(tube(Array.from({ length: 160 }, (_, j) => { const th = j / 159 * 4 * TAU, q = 0.33 * (1 - j / 170); return [q * Math.cos(th), q * Math.sin(th)]; }), () => 0.018), 3));
    else for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; o.fills.push(K(circle(Math.cos(a) * 0.24, Math.sin(a) * 0.24, 0.05, 16), 3)); }
    return o;
  }

  // pecha: the Pohela Boishakh owl mask, radius ~1 around the origin. Eye rings, crown and cheek stripes vary.
  function pecha(r) {
    const o = out(), rings = r ? pick(r, [2, 3, 4]) : 3, crown = r ? pick(r, ['zigzag', 'scallops', 'rays']) : 'zigzag', stripes = r ? pick(r, [2, 3, 4]) : 3;
    const face = cr(sym([[0, -0.78], [0.42, -0.74], [0.72, -0.5], [0.8, -0.1], [0.66, 0.36], [0.36, 0.74], [0.12, 0.92], [0, 0.96]]), true, 8);
    o.strokes.push(face);
    for (const s of [-1, 1]) {
      const cx = s * 0.34, cy = -0.18;
      for (let k = 0; k < rings; k++) o.strokes.push(circle(cx, cy, 0.26 - k * 0.055, 72));
      o.fills.push(circle(cx, cy, 0.08, 36), K(circle(cx + 0.02, cy - 0.025, 0.022, 12), 3));
      for (let i = 0; i < 9; i++) { const a = -Math.PI * (0.15 + 0.7 * i / 8); o.strokes.push([[cx + Math.cos(a) * 0.29, cy + Math.sin(a) * 0.29], [cx + Math.cos(a) * 0.37, cy + Math.sin(a) * 0.37]]); }
      o.strokes.push(cr([[s * 0.06, -0.5], [s * 0.3, -0.56], [s * 0.62, -0.46]], false, 12));
      for (let k = 0; k < stripes; k++) o.strokes.push(cr([[s * 0.2, 0.2 + k * 0.1], [s * 0.42, 0.14 + k * 0.1], [s * 0.62, 0.02 + k * 0.1]], false, 12));
    }
    o.fills.push(closed([[-0.1, -0.12], [0.1, -0.12], [0, 0.48]]));
    if (crown === 'zigzag') { const z = []; for (let i = 0; i <= 12; i++) z.push([-0.55 + 1.1 * i / 12, i % 2 ? -0.86 : -0.72]); o.strokes.push(z); }
    else if (crown === 'scallops') for (let i = 0; i < 6; i++) o.strokes.push(cr([[-0.54 + i * 0.18, -0.7], [-0.45 + i * 0.18, -0.86], [-0.36 + i * 0.18, -0.7]], false, 8));
    else for (let i = 0; i < 9; i++) { const a = -Math.PI * (0.2 + 0.6 * i / 8); o.fills.push(circle(Math.cos(a) * 0.9, Math.sin(a) * 0.9 + 0.05, 0.035, 14)); }
    return o;
  }

  // render styles: the same drawing as outline only, as drawn, as a solid silhouette with its
  // details cut out (negative space, k 3), or with its body tinted underneath (k 1, u = under the lines)
  const STYLES = ['classic', 'classic', 'line', 'solid', 'tinted'];
  const pip = ([x, y], poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
  const cen = s => { let x = 0, y = 0; for (const p of s) { x += p[0]; y += p[1]; } return [x / s.length, y / s.length]; };
  function styled(o, style) {
    if (style === 'classic') return o;
    const copy = s => { const q = s.slice(); q.c = s.c; q.k = s.k; q.u = s.u; return q; };
    if (style === 'line') return { strokes: [...o.strokes, ...o.fills.map(s => closed(s.slice()))], fills: o.fills.filter(s => s.k === 3) };
    const A = s => Math.abs(area(s)), shut = o.strokes.filter(s => s.c);
    if (!shut.length) return o;
    const big = Math.max(...shut.map(A)), body = shut.filter(s => A(s) > big * 0.35), inside = s => body.some(b => pip(cen(s), b));
    const res = out();
    if (style === 'tinted') {
      for (const b of body) { const f = closed(b.slice()); f.k = 1; f.u = true; res.fills.push(f); }
      res.strokes.push(...o.strokes); res.fills.push(...o.fills);
      return res;
    }
    for (const b of body) res.fills.push(closed(b.slice()));
    for (const s of o.strokes) if (!body.includes(s)) {
      if (inside(s)) res.fills.push(K(tube(s.c ? [...s, s[0]] : s, () => 0.014), 3)); else res.strokes.push(s);
    }
    for (const f of o.fills) res.fills.push(inside(f) && f.k !== 3 ? K(copy(f), 3) : f);
    return res;
  }
  // the seed always draws its style (so seeds stay stable); a forced style from the controls wins
  const withStyle = f => r => { if (!r) return OPT.style ? styled(f(), OPT.style) : f(); const o = f(r), st = pick(r, STYLES); return styled(o, OPT.style || st); };

  // with an rng every motif also takes a seeded render style, so the same shankha comes as line, solid or tinted
  const MOTIFS = { padma: withStyle(r => padma(8, 0.42, r)), kalka: withStyle(r => kalka(2.4, r)), matsya: withStyle(matsyaPair), shankha: withStyle(shankha), shish: withStyle(shish),
    pakhi: withStyle(pakhi), surya: withStyle(surya), pecha: withStyle(pecha) };
  const MOTIF_KEYS = ['padma', 'shankha', 'matsya', 'kalka', 'shish', 'pakhi', 'surya', 'pecha'];
  const CENTRED = new Set(['padma', 'surya', 'pecha']);                          // drawn around the origin, not stood on a base

  // lata: running creeper along any path. Sine vine, a leaf out of every crest,
  // a spiral tendril curling into the hollow beneath it.
  function lata(path, amp, { leaves = true, curls = true } = {}) {
    const o = out(), cycles = Math.max(3, Math.round(path.L / (5 * amp))), S = cycles * 48, vine = [];
    for (let i = 0; i < S; i++) {
      const [p, n] = path.at(i / S * path.L), off = amp * Math.sin(TAU * cycles * i / S);
      vine.push([p[0] + n[0] * off, p[1] + n[1] * off]);
    }
    o.strokes.push(path.c ? closed(vine) : vine);
    for (let k = 0; k < 2 * cycles; k++) {
      const [p, n] = path.at((k + 0.5) / (2 * cycles) * path.L), sg = k % 2 ? -1 : 1;
      const cp = [p[0] + n[0] * amp * sg, p[1] + n[1] * amp * sg];
      if (leaves) {
        const a = Math.atan2(n[1] * sg, n[0] * sg) + Math.PI / 2 - 0.55;
        o.fills.push(xf({ strokes: [], fills: [petal(0.4)] }, { x: cp[0], y: cp[1], a, s: amp * 1.05 }).fills[0]);
      }
      if (curls) {
        const R0 = amp * 0.5, cx = cp[0] - n[0] * sg * R0, cy = cp[1] - n[1] * sg * R0;
        const a0 = Math.atan2(cp[1] - cy, cp[0] - cx), dir = sg, sp = []; // sg: curl runs forward along the vine
        for (let i = 0; i <= 90; i++) { const th = i / 90 * 1.7 * TAU, r = R0 * Math.exp(-0.16 * th); sp.push([cx + r * Math.cos(a0 + dir * th), cy + r * Math.sin(a0 + dir * th)]); }
        o.strokes.push(sp);
      }
    }
    return o;
  }

  // ---- bands: any ornament strip along any path -------------------------------------
  // A band is centred on `path`, spans offsets -w/2 (inside) .. +w/2 (outside, along the normal).
  // Counts are multiples of m so every ring shares the medallion's symmetry.
  const at = (path, s, off) => { const [q, n] = path.at(s); return [q[0] + n[0] * off, q[1] + n[1] * off]; };
  function offsetLine(path, f, S = 1200) {
    const p = []; for (let i = 0; i < S; i++) p.push(at(path, i / S * path.L, f(i / S)));
    return path.c ? closed(p) : p;
  }
  // unit ornament (height 1, base at origin, pointing -y) stood on the path, pointing outward
  function place(path, s, off, h, o, turn = 0, mx = false) {
    const [q, n] = path.at(s);
    return xf(o, { x: q[0] + n[0] * off, y: q[1] + n[1] * off, a: Math.atan2(n[0], -n[1]) + turn, s: h, mx });
  }
  const nOf = (path, pitch, m) => Math.max(m, Math.round(path.L / pitch / m) * m);
  const F = sh => ({ strokes: [], fills: [sh] }), Sk = sh => ({ strokes: [sh], fills: [] });

  const dot = (x, y, R, n) => circle(x, y, R * wOf('dot'), n);   // band dots and beads follow the 'dot' width
  const BANDS = {
    creeper: (p, w, r) => lata(p, w * 0.27, { leaves: r() > 0.25, curls: true }),
    motifs(p, w, r, m) {
      const kinds = ['matsya', 'shankha', 'kalka', 'shish', 'padma', 'pakhi', 'surya'], A = pick(r, kinds), B = r() < 0.5 ? A : pick(r, kinds);
      const N = nOf(p, w * (A === 'matsya' || B === 'matsya' ? 1.25 : 0.95), m), o = out(), mA = MOTIFS[A](r), mB = B === A ? mA : MOTIFS[B](r);
      for (let i = 0; i < N; i++) {
        const k = i % 2 ? B : A, s = (i + 0.5) / N * p.L;
        const mo = i % 2 ? mB : mA; merge(o, CENTRED.has(k) ? place(p, s, 0, w * 0.42, mo) : place(p, s, -w * 0.45, w * 0.88, mo));
      }
      if (r() < 0.6) for (let i = 0; i < N; i++) o.fills.push(dot(...at(p, i / N * p.L, 0), w * 0.045, 16));
      return o;
    },
    petals(p, w, r, m) {
      const N = nOf(p, w * (0.32 + r() * 0.3), m), pw = 0.28 + r() * 0.22, solid = r() < 0.35, tip = r() < 0.5, o = out();
      for (let i = 0; i < N; i++) {
        const s = i / N * p.L;
        merge(o, place(p, s, -w / 2, w * (tip ? 0.8 : 0.95), solid ? F(petal(pw)) : Sk(petal(pw))));
        if (!solid) merge(o, place(p, s, -w / 2 + w * 0.08, w * 0.5, F(petal(pw * 0.8))));
        if (tip) o.fills.push(dot(...at(p, s, w * 0.42), w * 0.05, 16));
      }
      return o;
    },
    dots(p, w, r, m) {
      const rows = pick(r, [1, 2, 3]), o = out();
      for (let j = 0; j < rows; j++) {
        const off = rows === 1 ? 0 : -w / 2 + w * (j + 0.5) / rows, rad = w / rows * (0.16 + r() * 0.1);
        const N = nOf(p, rad * (3 + r() * 3), m), ph = j % 2 ? 0.5 : 0;
        for (let i = 0; i < N; i++) o.fills.push(dot(...at(p, (i + ph) / N * p.L, off), rad, 18));
      }
      return o;
    },
    scallops(p, w, r, m) {
      const N = nOf(p, w * (0.9 + r() * 0.8), m), o = out(), arch = k => u => -w / 2 + w * k * Math.abs(Math.sin(Math.PI * N * u));
      o.strokes.push(offsetLine(p, arch(0.92)), offsetLine(p, arch(0.55)));
      for (let i = 0; i < N; i++) o.fills.push(dot(...at(p, (i + 0.5) / N * p.L, -w * 0.2), w * 0.07, 16));
      return o;
    },
    diamonds(p, w, r, m) {
      const N = nOf(p, w * (0.7 + r() * 0.6), m), o = out(), tri = (u, ph) => { const f = (N * u + ph) % 1; return (Math.abs(f - 0.5) * 4 - 1) * w * 0.46; };
      o.strokes.push(offsetLine(p, u => tri(u, 0)), offsetLine(p, u => tri(u, 0.5)));
      const big = r() < 0.5;
      for (let i = 0; i < N; i++) o.fills.push(dot(...at(p, (i + 0.25) / N * p.L, 0), w * (big ? 0.11 : 0.06), 16));
      return o;
    },
    eyes(p, w, r, m) {
      const N = nOf(p, w * (1.1 + r() * 0.8), m), o = out(), e = k => u => k * w * 0.46 * Math.sin(Math.PI * N * u);
      o.strokes.push(offsetLine(p, e(1)), offsetLine(p, e(-1)));
      if (r() < 0.6) o.strokes.push(offsetLine(p, e(0.5)), offsetLine(p, e(-0.5)));
      for (let i = 0; i < N; i++) o.fills.push(dot(...at(p, (i + 0.5) / N * p.L, 0), w * 0.08, 16));
      return o;
    },
    garland(p, w, r, m) {
      const N = nOf(p, w * (0.35 + r() * 0.25), m), o = out(), lw = 0.4 + r() * 0.15, solid = r() < 0.6;
      o.strokes.push(offsetLine(p, () => 0));
      for (let i = 0; i < N; i++) {
        const leaf = petal(lw);
        merge(o, place(p, (i + 0.5) / N * p.L, 0, w * 0.5, solid ? F(leaf) : Sk(leaf), i % 2 ? 0.75 : Math.PI - 0.75));
      }
      return o;
    },
    paisleys(p, w, r, m) {
      const N = nOf(p, w * 1.3, m), o = out(), mir = r() < 0.5;
      for (let i = 0; i < N; i++) merge(o, place(p, (i + 0.5) / N * p.L, -w * 0.05, w * 0.62, kalka(), Math.PI / 2, mir && i % 2 === 1));
      return o;
    },
    rays(p, w, r, m) {
      const N = nOf(p, w * (0.16 + r() * 0.14), m), o = out();
      for (let i = 0; i < N; i++) {
        const s = i / N * p.L, long = i % 2 === 0;
        o.strokes.push([at(p, s, -w / 2), at(p, s, long ? w * 0.4 : w * 0.05)]);
        if (long) o.fills.push(dot(...at(p, s, w * 0.44), w * 0.05, 14));
      }
      return o;
    },
    braid(p, w, r, m) {
      const N = nOf(p, w * (0.9 + r() * 0.8), m), k = pick(r, [2, 3]), o = out();
      for (let j = 0; j < k; j++) o.strokes.push(offsetLine(p, u => w * 0.44 * Math.sin(TAU * (N * u + j / k)), 2400));
      return o;
    },
    // teardrops pointing outward with beads between (solid mandala rings)
    drops(p, w, r, m) {
      const N = nOf(p, w * (0.62 + r() * 0.35), m), o = out(), solid = r() < 0.7, ring = r() < 0.5, alt = r() < 0.4;
      const wd = wOf('drop'), drop = cr(sym([[0, -1], [0.12, -0.72], [0.25, -0.46], [0.32, -0.24], [0.3, -0.08], [0.18, 0.02], [0, 0.05]].map(([x, y]) => [x * wd, y])), true, 8);
      for (let i = 0; i < N; i++) {
        const d = place(p, (i + 0.5) / N * p.L, -w / 2, w * 0.95, { strokes: [], fills: [drop] }).fills[0];
        if (alt && i % 2) d.k = 1;
        (solid ? o.fills : o.strokes).push(d);
        if (!solid) o.fills.push(dot(...at(p, (i + 0.5) / N * p.L, -w * 0.3), w * 0.07, 14));
        o.fills.push(dot(...at(p, i / N * p.L, -w * 0.38), w * 0.08, 16));
      }
      if (ring) o.strokes.push(offsetLine(p, () => -w * 0.5));
      return o;
    },
    // diamonds with a smaller diamond (or a dot) inside
    lozenges(p, w, r, m) {
      const N = nOf(p, w * (0.75 + r() * 0.4), m), o = out(), inner = pick(r, ['diamond', 'dot', 'ring']), fill = r() < 0.35;
      const wd = 0.62 * wOf('diamond'), dia = k => closed([[0, -k], [k * wd, 0], [0, k], [-k * wd, 0]]);
      for (let i = 0; i < N; i++) {
        const s = (i + 0.5) / N * p.L, q = place(p, s, 0, 1, { strokes: [dia(w * 0.46)], fills: [inner === 'diamond' ? dia(w * 0.2) : circle(0, 0, w * 0.09, 18)] });
        (fill ? o.fills : o.strokes).push(q.strokes[0]);
        if (inner === 'ring') o.strokes.push(q.fills[0]); else if (!fill) o.fills.push(q.fills[0]); else o.fills.push(K(q.fills[0], 3));
      }
      return o;
    },
    // sawtooth of triangles, each holding a spiral, a dot cluster or a small fish
    sawtooth(p, w, r, m) {
      const N = nOf(p, w * (0.8 + r() * 0.5), m), o = out(), deco = pick(r, ['spiral', 'dots', 'fish']);
      o.strokes.push(offsetLine(p, u => { const f = (N * u) % 1; return (Math.abs(f - 0.5) * 4 - 1) * w * 0.46; }, 2400), offsetLine(p, () => -w * 0.46));
      const fish = matsya({ scales: 'dots', fins: 'solid' });
      for (let i = 0; i < N; i++) {
        const s = i / N * p.L, [q, n] = p.at(s), c = [q[0] - n[0] * w * 0.14, q[1] - n[1] * w * 0.14];   // inside the outward triangle
        if (deco === 'spiral') o.strokes.push(Array.from({ length: 60 }, (_, j) => { const th = j / 59 * 2.6 * TAU, rr = w * 0.17 * (1 - j / 66); return [c[0] + rr * Math.cos(th), c[1] + rr * Math.sin(th)]; }));
        else if (deco === 'dots') for (const [dx, dy] of [[0, -0.08], [-0.08, 0.06], [0.08, 0.06]]) o.fills.push(dot(c[0] + dx * w, c[1] + dy * w, w * 0.05, 12));
        else merge(o, place(p, s, -w * 0.42, w * 0.55, fish));
      }
      return o;
    },
    // double wave with dots in the crests
    waves(p, w, r, m) {
      const N = nOf(p, w * (0.9 + r() * 0.8), m), o = out(), dots = r() < 0.7;
      for (const ph of [0, 0.5]) o.strokes.push(offsetLine(p, u => w * 0.3 * Math.sin(TAU * (N * u + ph)), 2400));
      if (dots) for (let i = 0; i < 2 * N; i++) o.fills.push(dot(...at(p, (i + 0.25) / (2 * N) * p.L, (i % 2 ? -1 : 1) * w * 0.4), w * 0.06, 14));
      return o;
    },
    // half-disc beads along the edge (solid scallops), optional dot row inside
    beads(p, w, r, m) {
      const N = nOf(p, w * (0.55 + r() * 0.4), m), o = out(), row = r() < 0.6;
      for (let i = 0; i < N; i++) {
        const s0 = i / N * p.L, s1 = (i + 1) / N * p.L, arc = [];
        for (let j = 0; j <= 16; j++) { const t = j / 16, s = s0 + (s1 - s0) * t; arc.push(at(p, s, -w / 2 + w * 0.7 * wOf('dot') * Math.sin(Math.PI * t))); }
        o.fills.push(closed(arc));
        if (row) o.fills.push(dot(...at(p, (i + 0.5) / N * p.L, w * 0.38), w * 0.07, 14));
      }
      return o;
    },
    kantha(p, w, r) {
      const rows = pick(r, [2, 3]), o = out();
      for (let j = 0; j < rows; j++) o.strokes.push(...stitch(offsetLine(p, () => -w / 2 + w * (j + 0.5) / rows, 1600), w * 0.2, w * 0.12));
      return o;
    },
  };

  // ---- centres of a medallion, radius R ----------------------------------------------
  const CENTRES = {
    lotus: (R, r) => xf(padma(8, 0.42, r), { s: R }),
    tiered(R, r, m) {
      const o = out(), n = m >= 10 ? m : 2 * m;
      for (const [t, ph] of [[1, 0], [0.66, 0.5], [0.4, 0]]) for (let i = 0; i < n; i++) {
        const a = (i + ph) / n * TAU;
        merge(o, xf(Sk(petal(0.42)), { x: Math.cos(a) * R * t * 0.3, y: Math.sin(a) * R * t * 0.3, a: a + Math.PI / 2, s: R * t * 0.7 }));
      }
      o.fills.push(circle(0, 0, R * 0.1, 32));
      return o;
    },
    star(R, r, m) {
      const o = out(), k = 0.42 + r() * 0.15;
      const pts = n => closed(Array.from({ length: 2 * m }, (_, i) => { const a = i / (2 * m) * TAU - Math.PI / 2, q = n * (i % 2 ? k : 1); return [Math.cos(a) * q, Math.sin(a) * q]; }));
      o.strokes.push(pts(R), circle(0, 0, R * k * 0.8, 72));
      o.fills.push(pts(R * 0.45), circle(0, 0, R * 0.1, 24));
      return o;
    },
    sun(R, r, m) {
      const o = out(), n = m * 2;
      o.fills.push(circle(0, 0, R * 0.28, 48)); o.strokes.push(circle(0, 0, R * 0.36, 72));
      for (let i = 0; i < n; i++) {
        const a = i / n * TAU, len = i % 2 ? 0.35 : 0.55;
        o.fills.push(tube(walk(Math.cos(a) * R * 0.42, Math.sin(a) * R * 0.42, R * len, () => a, 20), t => R * 0.05 * (1 - t)));
      }
      return o;
    },
    pinwheel(R, r, m) {
      const o = out(), curl = (r() < 0.5 ? 1 : -1) * (1 + r());
      for (let i = 0; i < m; i++) {
        const a = i / m * TAU;
        o.fills.push(tube(walk(Math.cos(a) * R * 0.15, Math.sin(a) * R * 0.15, R * 0.85, t => a + curl * t, 40), t => R * 0.11 * Math.pow(Math.sin(Math.PI * Math.min(t * 1.2, 1)), 0.8) + 1e-4));
      }
      o.strokes.push(circle(0, 0, R * 0.2, 48));
      return o;
    },
    rings(R, r, m) {
      const o = out();
      for (const t of [1, 0.72, 0.44]) o.strokes.push(circle(0, 0, R * t * 0.95, 96));
      merge(o, dotsOn(circlePath(R * 0.83), m * 2, R * 0.05));
      merge(o, dotsOn(circlePath(R * 0.58), m, R * 0.06));
      o.fills.push(circle(0, 0, R * 0.2, 32));
      return o;
    },
    motifFlower(R, r, m) {
      const o = out(), k = pick(r, ['matsya', 'shankha', 'kalka', 'shish', 'pakhi']), n = k === 'matsya' ? Math.min(m, 6) : m, one = MOTIFS[k](r);
      for (let i = 0; i < n; i++) { const a = i / n * TAU - Math.PI / 2; merge(o, xf(one, { x: Math.cos(a) * R * 0.2, y: Math.sin(a) * R * 0.2, a: a + Math.PI / 2, s: R * 0.8 })); }
      o.fills.push(circle(0, 0, R * 0.12, 32));
      return o;
    },
  };

  function divider(o, rad, kind, m) {
    if (kind === 'single') o.strokes.push(circle(0, 0, rad, 240));
    else if (kind === 'double') o.strokes.push(circle(0, 0, rad - 0.006, 240), circle(0, 0, rad + 0.006, 240));
    else if (kind === 'dotted') merge(o, dotsOn(circlePath(rad), m * Math.max(4, Math.round(TAU * rad / 0.03 / m)), 0.006));
  }

  // ---- compositions ---------------------------------------------------------------
  // alpona medallion, radius 1: a centre, then rings of bands out to an edge band.
  function alpona(seed, { rings = 0, sym = 0 } = {}) {
    const r = rng(seed), o = out(), m = sym || pick(r, [6, 8, 8, 10, 12, 16]);
    const rc = 0.13 + r() * 0.14, k = rings || 3 + Math.floor(r() * 3), gap = 0.022;
    merge(o, CENTRES[pick(r, Object.keys(CENTRES))](rc, r, m));
    const kinds = Object.keys(BANDS), edge = ['petals', 'scallops', 'rays', 'dots', 'garland', 'diamonds', 'drops', 'beads', 'sawtooth'];
    const picks = []; for (let j = 0; j < k; j++) picks.push(pick(r, (j === k - 1 ? edge : kinds).filter(x => x !== picks[j - 1])));
    // figurative bands need room to stay readable; line bands can be thin
    const heavy = { motifs: 2.2, paisleys: 1.8, creeper: 1.4, petals: 1.3, garland: 1.2 };
    const wts = picks.map(x => (heavy[x] || 0.8) * (0.8 + r() * 0.5)), sum = wts.reduce((a, b) => a + b, 0);
    const room = 0.985 - rc - gap * (k + 1);
    let rad = rc + gap;
    divider(o, rad - gap / 2, pick(r, ['single', 'double', 'none']), m);
    for (let j = 0; j < k; j++) {
      const w = room * wts[j] / sum;
      merge(o, BANDS[picks[j]](circlePath(rad + w / 2), w, r, m));
      rad += w + gap;
      if (j < k - 1) divider(o, rad - gap / 2, pick(r, ['single', 'double', 'dotted', 'single', 'none']), m);
    }
    return o;
  }

  // Page frame: outer and inner rules with one or two bands between. w,h,margin,band in mm.
  function bengaliBorder(w, h, margin, band, seed) {
    const r = rng(seed), o = out(), rc = band * 0.7;
    const ring = inset => rectPath(inset, inset, w - 2 * inset, h - 2 * inset, Math.max(0.5, rc - (inset - margin)));
    o.strokes.push(trace(ring(margin), 0, 1200), trace(ring(margin + band), 0, 1200));
    const k = r() < 0.55 ? 1 : 2, gap = band * 0.1, bw = (band - gap * (k + 1)) / k;
    const kinds = Object.keys(BANDS).filter(x => x !== 'motifs' || bw > 8);
    let inset = margin + gap, last = '';
    for (let j = 0; j < k; j++) {
      last = pick(r, kinds.filter(x => x !== last));
      merge(o, BANDS[last](ring(inset + bw / 2), bw, r, 4));
      inset += bw + gap;
      if (j < k - 1) o.strokes.push(trace(ring(inset - gap / 2), 0, 1200));
    }
    if (r() < 0.5) merge(o, dotsOn(ring(margin - band * 0.14), Math.round(ring(margin).L / (band * 0.35)), band * 0.028));
    return o;
  }

  // Kolam: Gerdes mirror curve. Dots on an m x n grid, cut to a shape; the line is a light ray
  // bouncing between two-sided mirrors on the grid edges. Searches seeds for the fewest loops
  // (one loop = sikku kolam, one unbroken line).
  // opt.shape: square | diamond | cross | circle | octagon; opt.line: single | double; opt.dots: dot | ring | lotus | none
  const KOLAM_SHAPES = ['square', 'diamond', 'cross', 'circle', 'octagon'];
  function kolamMask(shape, m, n) {
    const cx = (m - 1) / 2, cy = (n - 1) / 2, R = (Math.min(m, n) - 1) / 2, sx = R / Math.max(cx, 1e-9), sy = R / Math.max(cy, 1e-9);
    return (i, j) => {
      if (i < 0 || j < 0 || i >= m || j >= n) return false;
      const dx = Math.abs(i - cx) * sx, dy = Math.abs(j - cy) * sy;
      if (shape === 'diamond') return dx + dy <= R + 0.01;
      if (shape === 'cross') return Math.abs(i - cx) <= m / 6 + 0.01 || Math.abs(j - cy) <= n / 6 + 0.01;
      if (shape === 'circle') return dx * dx + dy * dy <= (R + 0.5) * (R + 0.5);
      if (shape === 'octagon') return dx + dy <= R * 1.45 + 0.01;
      return true;
    };
  }

  function kolam(m, n, seed, density = 0.35, spacing = 10, tries = 120, opt = {}) {
    const shape = opt.shape || 'square', line = opt.line || 'single', dots = opt.dots || 'dot';
    const inside = kolamMask(shape, m, n);
    let best = null;
    for (let k = 0; k < tries; k++) {
      const res = kolamOnce(m, n, seed * 7919 + k, density, inside);
      if (!best || res.loops.length < best.loops.length) best = res;
      if (best.loops.length === 1) break;
    }
    const o = out(), u = spacing / 2;
    for (const loop of best.loops) {
      const c = smoothLoop(loop.map(([x, y]) => [x * u, y * u]), 10);
      if (line === 'double') { const d = spacing * 0.07; o.strokes.push(closed(offsetPts(c, d)), closed(offsetPts(c, -d))); }
      else o.strokes.push(closed(c));
    }
    for (let i = 0; i < m; i++) for (let j = 0; j < n; j++) {
      if (!inside(i, j)) continue;
      const x = (2 * i + 1) * u, y = (2 * j + 1) * u;
      if (dots === 'dot') o.fills.push(circle(x, y, spacing * 0.06, 24));
      else if (dots === 'ring') o.strokes.push(circle(x, y, spacing * 0.08, 24));
      else if (dots === 'lotus') merge(o, xf(padma(6, 0.45), { x, y, s: spacing * 0.13 }));
    }
    o.loops = best.loops.length;
    return o;
  }
  // closed polyline offset along its normals (for the double-line kambi style)
  function offsetPts(c, d) {
    const N = c.length;
    return c.map((p, i) => {
      const a = c[(i - 1 + N) % N], b = c[(i + 1) % N], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
      return [p[0] - dy / l * d, p[1] + dx / l * d];
    });
  }

  function kolamOnce(m, n, seed, density, inside) {
    const r = rng(seed), W = 2 * m, H = 2 * n, mir = new Set(), key = (x, y) => x + ',' + y;
    const sq = m === n;
    // rotational symmetry (C4 square, C2 otherwise): decide one point per orbit.
    // Mirror symmetry was tried and forces an odd loop count >= m, never one line.
    const orbit = (x, y) => (sq ? [[x, y], [W - y, x], [W - x, H - y], [y, H - x]] : [[x, y], [W - x, H - y]]);
    const decided = new Set();
    for (let x = 1; x < W; x++) for (let y = 1; y < H; y++) {
      if ((x + y) % 2 === 0 || decided.has(key(x, y))) continue;
      const on = r() < density;
      for (const [a, b] of orbit(x, y)) { decided.add(key(a, b)); if (on) mir.add(key(a, b)); }
    }
    const dotIn = (x, y) => inside((x - 1) / 2, (y - 1) / 2);   // x, y odd
    // an edge is a mirror when a dot on either side is outside the shape, or it was chosen
    const isMirror = (x, y) => (x % 2 === 0 ? !(dotIn(x - 1, y) && dotIn(x + 1, y)) : !(dotIn(x, y - 1) && dotIn(x, y + 1))) || mir.has(key(x, y));
    const used = new Set(), seg = (x, y, dx, dy) => [key(x, y), key(x + dx, y + dy)].sort().join('|');
    const loops = [];
    for (let x = 0; x <= W; x++) for (let y = 0; y <= H; y++) {
      if ((x + y) % 2 === 0) continue;
      for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx > W || ny > H || used.has(seg(x, y, dx, dy))) continue;
        const dot = x % 2 ? [x, y + dy] : [x + dx, y];           // the dot this segment curls around
        if (!dotIn(dot[0], dot[1])) continue;
        const pts = [[x, y]]; let px = x, py = y, ddx = dx, ddy = dy, guard = 0;
        do {
          used.add(seg(px, py, ddx, ddy));
          px += ddx; py += ddy;
          if (isMirror(px, py)) { if (px % 2 === 0) ddx = -ddx; else ddy = -ddy; }
          pts.push([px, py]);
        } while (!(px === x && py === y && ddx === dx && ddy === dy) && ++guard < 100000);
        pts.pop();
        loops.push(pts);
      }
    }
    return { loops };
  }

  // Closed Catmull-Rom through the midpoints of each segment: rounds every mirror
  // bounce into an arc around the dot and keeps crossings straight.
  function smoothLoop(pts, per) {
    const M = pts.map((p, i) => { const q = pts[(i + 1) % pts.length]; return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]; });
    const N = M.length, o = [];
    for (let i = 0; i < N; i++) {
      const p0 = M[(i - 1 + N) % N], p1 = M[i], p2 = M[(i + 1) % N], p3 = M[(i + 2) % N];
      for (let j = 0; j < per; j++) {
        const t = j / per, t2 = t * t, t3 = t2 * t;
        o.push([0, 1].map(d => 0.5 * (2 * p1[d] + (-p0[d] + p2[d]) * t + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * t2 + (-p0[d] + 3 * p1[d] - 3 * p2[d] + p3[d]) * t3)));
      }
    }
    return o;
  }

  // ---- guilloche ------------------------------------------------------------------
  function rosette(R, { copies = 36, k1 = 7, k2 = 11, a1 = 0.12, a2 = 0.06, twist = 1, samples = 900 }) {
    const o = out();
    for (let c = 0; c < copies; c++) {
      const ph = c / copies * TAU, p = [];
      for (let i = 0; i < samples; i++) {
        const t = i / samples * TAU, r = R * (1 - a1 - a2 + a1 * Math.sin(k1 * t + ph) + a2 * Math.cos(k2 * t - ph * twist));
        p.push([r * Math.cos(t), r * Math.sin(t)]);
      }
      o.strokes.push(closed(p));
    }
    return o;
  }

  function spiro(R, r, d, copies, size, epi = false) {
    const o = out(), g = gcd(Math.round(R), Math.round(r)), turns = Math.round(r) / g, S = 2400, Rr = epi ? R + r : R - r, k = size / (Rr + d);
    for (let c = 0; c < copies; c++) {
      const rot = c / copies * TAU / (R / g), p = [];
      for (let i = 0; i < S; i++) {
        const t = i / S * TAU * turns, x = Rr * Math.cos(t) + (epi ? -d : d) * Math.cos(Rr / r * t), y = Rr * Math.sin(t) - d * Math.sin(Rr / r * t);
        p.push([k * (x * Math.cos(rot) - y * Math.sin(rot)), k * (x * Math.sin(rot) + y * Math.cos(rot))]);
      }
      o.strokes.push(closed(p));
    }
    return o;
  }
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);

  // Guilloche band along a path: strands offset by integer-cycle sines, so each closes on itself.
  function band(path, { copies = 12, amp = 3, cycles = 60, amp2 = 1, cycles2 = 7, samples = 3000 }) {
    const o = out();
    for (let c = 0; c < copies; c++) {
      const ph = c / copies * TAU, p = [];
      for (let i = 0; i < samples; i++) {
        const u = i / samples, [q, n] = path.at(u * path.L), off = amp * Math.sin(cycles * u * TAU + ph) + amp2 * Math.sin(cycles2 * u * TAU - 2 * ph);
        p.push([q[0] + n[0] * off, q[1] + n[1] * off]);
      }
      o.strokes.push(closed(p));
    }
    return o;
  }

  // Security field: enveloped wave lines across a rectangle.
  function field(w, h, lines = 60, amp = 3, freq = 6) {
    const o = out();
    for (let j = 0; j < lines; j++) {
      const y0 = j / (lines - 1) * h, p = [];
      for (let i = 0; i <= 600; i++) {
        const u = i / 600;
        p.push([u * w, y0 + amp * Math.sin(Math.PI * u) * Math.sin(freq * TAU * u + j * 0.35) * Math.cos(TAU * u * 1.5 + j * 0.05)]);
      }
      o.strokes.push(p);
    }
    return o;
  }

  // ---- guilloche compositions -------------------------------------------------------
  // one guilloche ring filling the annulus a..b (radius units), symmetry m, c strands
  const K = (sh, k) => { sh.k = k; return sh; };
  return { TAU, rng, pick, xf, merge, out, circle, tube, walk, stitch, orient, area, circlePath, rectPath, trace, dotsOn, petal, padma, kalka, matsya, matsyaPair, shankha, shish, MOTIFS, MOTIF_KEYS, KOLAM_SHAPES, lata, BANDS, CENTRES, alpona, kolam, rosette, withOpts, pakhi, surya, pecha, styled, STYLES };
})();

globalThis.G = G;
// Ochin page shapes: the maths behind every drawn vector on the pages, in one place.
// Used by build.js (draws the pages), library.js (the brand shape library) and the Affinity script
// "Ochin Shape" (ochin-shape-tool.js), which edits any of these shapes live from a dialog.
// Pure maths, mm, y down. Needs geo.js (G).
//
// A shape is { P, A }: P = settings (the dialog's controls), A = where it sits:
//   A.box = { x, y, w, h } in spread mm, A.pts = the polyline a stitch follows (optional).
//   A.poly = a closed outline a panel takes (a pen-drawn shape; optional).
// The settings travel with the shape in Affinity (tag 'ochin'), so a later edit reopens them.
// geom() returns { strokes, fills }; a piece may carry .role (its layer) and .key (the P colour it
// takes); strokes may carry .w (mm). Without them fills go to 'Solids' (P.solid) and strokes to
// 'Lines' (P.ink, P.weight).
(function (root) {
  const make = (G) => {
    // the brand signatures (brand-board.html): lal paar, matra rule, kantha, alpana, the bird; then
    // the panel under text and the Ornament Studio's generators
    const KINDS = ['lalpaar', 'matra', 'stitch', 'alpana', 'bird', 'panel', 'alpona', 'kolam', 'rosette', 'band'];
    const KIND_LABELS = ['Lal paar', 'Matra rule', 'Kantha stitch', 'Alpana', 'The bird', 'Panel', 'Alpona (generated)', 'Kolam', 'Rosette', 'Border band'];
    const PROFILES = ['plain', 'wave', 'scallop', 'zigzag', 'steps'];
    const SYMS = [0, 6, 8, 10, 12, 16];
    const SHAPE_KINDS = [['Petals & leaves', 'petal'], ['Diamonds', 'diamond'], ['Drops', 'drop'], ['Dots & beads', 'dot'], ['Sun rays', 'ray']];
    const MSTYLES = ['', 'classic', 'line', 'solid', 'tinted'];
    const BAND_TYPES = Object.keys(G.BANDS);
    // the nine brand colours (+ Paper, the board's paper2); nothing outside these is ever drawn
    const PALETTE = [['Shankha', '#F6EEDC'], ['Kajol', '#1E1A1D'], ['Sindur', '#D23A1E'], ['Holud', '#EBA417'], ['Neel', '#27357A'],
      ['Kolapata', '#2F7D46'], ['Shapla', '#E07A9A'], ['Padma', '#12807E'], ['Mati', '#A9502B'], ['Paper', '#EDE2CA']];
    // every control, with its default
    const DEF = {
      kind: 'alpona', seed: 1826,
      profile: 0, depth: 1.2, pitch: 8, pfill: -1,                         // panel edge; pfill -1 = keep the shape's own fill
      dash: 2.4, gap: 1.6, ends: 0, endcol: 1, thread: 0,                  // kantha (ends = end-dot radius, mm; thread 1 = double)
      toff: 5.5, tstyle: 0,                                                // lal paar: thread from the top; 0 single, 1 double, 2 thread and dots
      rule: 1.1, rstyle: 0,                                                // matra rule; 0 single, 1 with a hairline, 2 with end beads
      apet: 2, aform: 1, aring: 1, ainner: 1,                              // alpana (list indexes; 0 = the seed decides): the board's 8 leaves, dots, no inner ring
      body: 1, wing: 4, beak: 3, eye: 0, pupil: 1, wstitch: 0,             // the bird's colours (board defaults)
      flip: 0, perch: 0, pcol: 2,                                          // the bird: 1 = facing left; 1 = on a line (its colour)
      // the board's finish (finish.js): drawn shapes get all of it, a panel grain (and paper) only
      fin: 1, fwob: .3, fwear: .01, fgrain: .5, fwater: .125, fpaper: 0, fdpi: 300,
      fadeL: 0, fadeR: 0, fadeT: 0, fadeB: 0,                              // each edge fades to clear over this many mm (0 = hard edge)
      gcol: -1, gang: 90, gamt: 1,                                         // gradient toward this colour (-1 none) at this angle (0 = left to right, 90 = top to bottom)
      rings: 0, sym: 0,                                                    // alpona
      cols: 7, rows: 7, kshape: 0, kline: 0, kdots: 0, density: .3,        // kolam
      copies: 0, k1: 0, k2: 0,                                             // rosette (0 = seed decides)
      band: 0, width: 6.5, groups: 4,                                      // border band (0 = seed decides)
      shapeOn: 31, shapeW: 1, mstyle: 0,                                   // shape widths + motif style, as in the studio
      size: 0, weight: .5, amp: 0, lam: 6, opacity: 1, ink: 3, solid: 3,   // finish (size 0 = fit the box)
    };
    const withDefaults = (P) => Object.assign({}, DEF, P || {});

    // seeded value noise: smooth along an edge, so a ruled line becomes a drawn one
    function noise2(seed) {
      const h = (x, y) => { let n = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 982451653) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
      return (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
        const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1); return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy; };
    }
    const keep = (t, s) => { t.c = s.c; t.k = s.k; t.role = s.role; t.key = s.key; t.w = s.w; return t; };
    function wobble(o, amp, lam, seed) {
      if (!amp) return o;
      const NX = noise2(seed), NY = noise2(seed + 6), f = (p) => [p[0] + amp * (2 * NX(p[0] / lam, p[1] / lam) - 1), p[1] + amp * (2 * NY(p[0] / lam + 40, p[1] / lam) - 1)];
      const m = (s) => keep(s.map(f), s);
      return { strokes: o.strokes.map(m), fills: o.fills.map(m) };
    }
    const PROF = {
      plain: () => 0, wave: (u) => Math.sin(2 * Math.PI * u), scallop: (u) => 1 - 2 * Math.abs(Math.sin(Math.PI * u)),
      zigzag: (u) => 1 - 4 * Math.abs(u - Math.floor(u) - .5), steps: (u) => (u - Math.floor(u) < .5 ? 1 : -1),
    };
    // a rectangle's outline every 0.4 mm, each side shaped by the profile in whole repeats
    function panel(b, P) {
      const out = [], name = PROFILES[P.profile] || 'plain', f = PROF[name], half = name === 'plain' ? 0 : P.depth / 2;
      const side = (x0, y0, x1, y1, nx, ny) => {
        const L = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.round(L / .4)), reps = Math.max(1, Math.round(L / P.pitch));
        for (let i = 0; i < n; i++) { const t = i / n, o = half * f(t * reps); out.push([x0 + (x1 - x0) * t + nx * o, y0 + (y1 - y0) * t + ny * o]); }
      };
      side(b.x, b.y, b.x + b.w, b.y, 0, -1); side(b.x + b.w, b.y, b.x + b.w, b.y + b.h, 1, 0);
      side(b.x + b.w, b.y + b.h, b.x, b.y + b.h, 0, 1); side(b.x, b.y + b.h, b.x, b.y, -1, 0);
      out.c = true; return out;
    }
    // any closed outline (a pen-drawn shape) every 0.4 mm, pushed out along its normal by the same profile
    function outline(poly, P) {
      const name = PROFILES[P.profile] || 'plain', f = PROF[name], half = name === 'plain' ? 0 : P.depth / 2;
      if (!half) return Object.assign(poly.map((p) => p.slice()), { c: true });
      const d = dense([...poly, poly[0]]); d.pop();
      let L = 0; const s = d.map((p, i) => (i ? (L += Math.hypot(p[0] - d[i - 1][0], p[1] - d[i - 1][1])) : 0));
      L += Math.hypot(d[0][0] - d[d.length - 1][0], d[0][1] - d[d.length - 1][1]);
      const reps = Math.max(1, Math.round(L / P.pitch));
      const out = d.map((p, i) => { const a = d[(i - 1 + d.length) % d.length], c = d[(i + 1) % d.length], l = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1, o = half * f(s[i] / L * reps);
        return [p[0] + (c[1] - a[1]) / l * o, p[1] - (c[0] - a[0]) / l * o]; });
      out.c = true; return out;
    }
    function dense(pts) {
      const d = [];
      for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i], n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / .5)); for (let k = 0; k < n; k++) d.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]); }
      d.push(pts[pts.length - 1]); return d;
    }
    function fit(o, c, R) {
      let m = 0; for (const s of [...o.strokes, ...o.fills]) for (const q of s) m = Math.max(m, Math.hypot(q[0], q[1]));
      return G.xf(o, { x: c[0], y: c[1], s: R / (m || 1) });
    }
    const centreOf = (b) => [b.x + b.w / 2, b.y + b.h / 2];
    const radiusOf = (P, b) => P.size || Math.max(1, Math.min(b.w, b.h) / 2);
    const lineOf = (A) => A.pts && A.pts.length > 1 ? A.pts : [[A.box.x, A.box.y + A.box.h / 2], [A.box.x + A.box.w, A.box.y + A.box.h / 2]];
    const tag = (s, role, key, w) => Object.assign(s, { role, key, w });

    // ---- the board's own drawings, in their own units (SVG M C L Z), placed by xy() ----------
    // an absolute M/C/L/Z path as polylines, each cubic sampled in 16 steps
    function svgPath(d, xy) {
      const t = d.match(/[MCLZ]|-?[\d.]+/g), out = []; let i = 0, cur = null, p = null;
      const n = () => +t[i++];
      while (i < t.length) {
        const c = t[i++];
        if (c === 'M') { if (cur) out.push(cur); p = [n(), n()]; cur = [xy(p)]; }
        else if (c === 'L') { p = [n(), n()]; cur.push(xy(p)); }
        else if (c === 'C') {
          const a = p, b = [n(), n()], e = [n(), n()], f = [n(), n()];
          for (let k = 1; k <= 16; k++) { const u = k / 16, v = 1 - u; cur.push(xy([v * v * v * a[0] + 3 * v * v * u * b[0] + 3 * v * u * u * e[0] + u * u * u * f[0], v * v * v * a[1] + 3 * v * v * u * b[1] + 3 * v * u * u * e[1] + u * u * u * f[1]])); }
          p = f;
        } else if (c === 'Z') { cur.c = true; }
      }
      if (cur) out.push(cur);
      return out;
    }
    const disc = (cx, cy, r, xy) => { const o = []; for (let k = 0; k < 48; k++) { const a = k * Math.PI / 24; o.push(xy([cx + r * Math.cos(a), cy + r * Math.sin(a)])); } o.c = true; return o; };
    // the bird: brand-board.html BIRD, 120 units wide; each part takes its own colour from P
    function bird(b, P) {
      const s = b.w / 120, xy = P.flip ? (p) => [b.x + b.w - p[0] * s, b.y + p[1] * s] : (p) => [b.x + p[0] * s, b.y + p[1] * s], fills = [], strokes = [];
      const F = (list, role, key) => list.forEach((q) => fills.push(tag(q, role, key || role)));   // overlapping pieces need their own layers: one layer is filled even-odd
      F(svgPath('M16 52 C24 66 32 74 44 79 C52 84 64 86 76 84 C90 80 97 67 93 53 C91 45 86 39 81 36 C70 32 58 38 48 56 Z', xy), 'body');
      F(svgPath('M16 52 L6 42 L22 50 L10 58 Z', xy), 'tail', 'body');
      F([disc(83, 36, 13, xy)], 'head', 'body');
      F(svgPath('M95 33 L109 38 L95 42 Z', xy), 'beak');
      F([disc(87, 33, 3.6, xy)], 'eye');
      F([disc(88, 33, 1.6, xy)], 'pupil');
      F(svgPath('M44 62 C56 50 74 52 82 64 C70 74 54 74 44 62 Z', xy), 'wing');
      for (const q of G.stitch(dense(svgPath('M50 63 C60 57 70 58 76 64', xy)[0]), 3 * s, 3 * s)) strokes.push(tag(q, 'wstitch', 'wstitch', 2 * s));
      for (const q of svgPath('M62 84 L60 92 M72 83 L72 92', xy)) strokes.push(tag(q, 'legs', 'body', 3 * s));
      // the board's perch: a sindur line under its feet, wider than the bird
      if (P.perch) strokes.push(tag(svgPath('M-10 98 L130 98', xy)[0], 'perch', 'pcol', 7 * s));
      return { strokes, fills };
    }
    // the alpana: brand-board.html ALPANA, 100 units square: a centre, petals, a ring of dots.
    // The board's is 8 leaves and 8 dots; count, petal form, outer and inner rings vary it (0 = seed decides)
    const A_PET = [0, 6, 8, 10, 12, 16], A_FORM = ['', 'Leaf', 'Lotus', 'Drop', 'Spear'], A_RING = ['', 'Dots', 'None', 'Double dots'], A_INNER = ['', 'None', 'Dots', 'Small petals'];
    const PETAL = {
      Leaf: 'M50 14 C56 26 56 34 50 42 C44 34 44 26 50 14 Z',          // the board's
      Lotus: 'M50 12 C63 20 61 35 50 42 C39 35 37 20 50 12 Z',
      Drop: 'M50 42 C57 33 62 21 50 13 C38 21 43 33 50 42 Z',
      Spear: 'M50 9 C53 23 53 34 50 42 C47 34 47 23 50 9 Z',
    };
    function alpana(b, P) {
      const rnd = G.rng(P.seed + 13), pick = (v, list) => (v ? list[v] : list[1 + Math.floor(rnd() * (list.length - 1))]);
      const n = pick(P.apet, A_PET), form = pick(P.aform, A_FORM), ring = pick(P.aring, A_RING), inner = pick(P.ainner, A_INNER);
      const s = Math.min(b.w, b.h) / 100, ox = b.x + b.w / 2 - 50 * s, oy = b.y + b.h / 2 - 50 * s, fills = [], narrow = Math.min(1, 8 / n);
      const at = (k, half) => { const a = (k + (half ? .5 : 0)) * 2 * Math.PI / n, c = Math.cos(a), sn = Math.sin(a);
        return (p) => { const x = (p[0] - 50) * narrow, y = p[1] - 50; return [ox + (50 + x * c - y * sn) * s, oy + (50 + x * sn + y * c) * s]; }; };
      const dot = (k, half, y, r) => { const f = at(k, half); return disc(50, y, r, (p) => f([50 + (p[0] - 50) / narrow, p[1]])); };   // dots stay round
      for (let k = 0; k < n; k++) {
        fills.push(...svgPath(PETAL[form], at(k)));
        if (ring !== 'None') fills.push(dot(k, false, 5, 2.4));
        if (ring === 'Double dots') fills.push(dot(k, true, 9, 1.6));
        if (inner === 'Dots') fills.push(dot(k, true, 38, 1.4));
        if (inner === 'Small petals') { const f = at(k, true); fills.push(...svgPath(PETAL[form], (p) => f([50 + (p[0] - 50) * .4, 50 + (p[1] - 50) * .4 - 14]))); }
      }
      fills.push(disc(50, 50, 5, (p) => [ox + p[0] * s, oy + p[1] * s]));
      return { strokes: [], fills };
    }
    // a polyline moved sideways by d (mm), for a second thread beside the first
    function offset(pts, d) {
      return pts.map((p, i) => { const a = pts[Math.max(0, i - 1)], c = pts[Math.min(pts.length - 1, i + 1)], l = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1; return [p[0] - (c[1] - a[1]) / l * d, p[1] + (c[0] - a[0]) / l * d]; });
    }
    const rect = (x, y, w, h) => Object.assign([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], { c: true });

    // the geometry for settings P at anchor A: { strokes, fills } in spread mm
    function geom(P, A) {
      P = withDefaults(P); const b = A.box, r = G.rng(P.seed + 77);
      const on = (k) => (P.shapeOn >> SHAPE_KINDS.findIndex((q) => q[1] === k) & 1 ? P.shapeW : 1);
      const opts = { petalW: on('petal'), w: { diamond: on('diamond'), drop: on('drop'), dot: on('dot'), ray: on('ray') }, style: MSTYLES[P.mstyle] || '' };
      const o = G.withOpts(opts, () => {
        switch (P.kind) {
          // a sindur strip with a running stitch near its top, as on a Puja sari's border
          case 'lalpaar': {
            const line = (y) => dense([[b.x, y], [b.x + b.w, y]]), y = b.y + P.toff, tw = P.weight * 25.4 / 72;
            const strokes = G.stitch(line(y), P.dash, P.gap), fills = [rect(b.x, b.y, b.w, b.h)];
            if (P.tstyle === 1) strokes.push(...G.stitch(line(y + 3 * tw), P.dash, P.gap));
            if (P.tstyle === 2) for (let x = b.x + P.dash; x < b.x + b.w; x += 2 * (P.dash + P.gap)) fills.push(tag(disc(x, y + 3 * tw, tw * .8, (p) => p), 'dots', 'ink'));
            return { strokes, fills };
          }
          // the top line headlines hang from
          case 'matra': {
            const fills = [rect(b.x, b.y, b.w, P.rule)];
            if (P.rstyle === 1) fills.push(rect(b.x, b.y + P.rule * 1.9, b.w, P.rule * .25));
            if (P.rstyle === 2) for (const x of [b.x, b.x + b.w]) fills.push(tag(disc(x, b.y + P.rule / 2, P.rule * 1.4, (p) => p), 'beads', 'solid'));
            return { strokes: [], fills };
          }
          case 'panel': return { strokes: [], fills: [A.poly ? outline(A.poly, P) : panel(b, P)] };   // A.poly: a pen-drawn outline
          case 'stitch': {
            const L = lineOf(A), st = G.stitch(dense(L), P.dash, P.gap), ends = [];
            if (P.thread) st.push(...G.stitch(offset(dense(L), 3 * P.weight * 25.4 / 72), P.dash, P.gap).slice(1));   // a second thread, half a stitch along
            if (P.ends) for (const q of [L[0], L[L.length - 1]]) ends.push(tag(disc(q[0], q[1], P.ends, (p) => p), 'ends', 'endcol'));
            return { strokes: st, fills: ends };
          }
          case 'alpana': return alpana(b, P);
          case 'bird': return bird(b, P);
          case 'alpona': return fit(G.alpona(P.seed, { rings: P.rings, sym: SYMS[P.sym] }), centreOf(b), radiusOf(P, b));
          case 'kolam': {
            const ch = (v, list) => (v ? list[v - 1] : G.pick(r, list));
            const opt = { shape: ch(P.kshape, G.KOLAM_SHAPES), line: ch(P.kline, ['single', 'double']), dots: ch(P.kdots, ['dot', 'ring', 'lotus', 'none']) };
            const k = G.kolam(P.cols, P.rows, P.seed, P.density, 10, 120, opt), cx = (P.cols - 1) * 5, cy = (P.rows - 1) * 5;
            return fit(G.xf(k, { x: -cx, y: -cy }), centreOf(b), radiusOf(P, b));
          }
          case 'rosette': return fit(G.rosette(1, { copies: P.copies || 18 + Math.floor(r() * 30), k1: P.k1 || 3 + Math.floor(r() * 9), k2: P.k2 || 5 + Math.floor(r() * 9) }), centreOf(b), radiusOf(P, b));
          case 'band': {
            const L = lineOf(A), x0 = Math.min(L[0][0], L[L.length - 1][0]), x1 = Math.max(L[0][0], L[L.length - 1][0]), y = L[0][1];
            const t = P.band ? BAND_TYPES[P.band - 1] : G.pick(r, BAND_TYPES);
            return G.BANDS[t]({ L: x1 - x0, c: false, at: (s) => [[x0 + s, y], [0, -1]] }, P.width, G.rng(P.seed), P.groups);
          }
        }
        return { strokes: [], fills: [] };
      });
      return wobble(o, P.amp, P.lam, P.seed + 7);
    }
    const hex = (i) => PALETTE[i] ? PALETTE[i][1] : i;

    // ---- the brand library: each signature in the board's colourways ---------------------------
    // [family, [[variant, settings, ground colour behind it or null]], size in mm]
    const ci = (name) => PALETTE.findIndex((p) => p[0] === name);
    const PANEL = { kind: 'panel', fdpi: 200 };   // a big fill: grain only (the board's panel()), finish below print res is invisible
    const GROUND = Object.assign({}, PANEL, { fgrain: 0, fpaper: .6 });   // the paper behind a signature, as on the board's covers
    const LP = { kind: 'lalpaar', solid: ci('Sindur'), ink: ci('Shankha'), weight: 3.1, dash: 3, gap: 2.4, toff: 5.5 };
    const KA = { kind: 'stitch', ink: ci('Sindur'), weight: 2, dash: 2.4, gap: 1.6 };
    const BIRD_NIGHT = { body: ci('Shankha'), wing: ci('Holud'), wstitch: ci('Neel'), eye: ci('Neel'), pupil: ci('Shankha') };
    const BRAND = [
      ['Lal paar', [['Single thread', LP, null], ['Double thread', Object.assign({}, LP, { tstyle: 1 }), null],
        ['Thread and dots', Object.assign({}, LP, { tstyle: 2 }), null]], { w: 80, h: 27 }],
      ['Matra rule', [['Kajol', { kind: 'matra', solid: ci('Kajol'), rule: 1.1 }, null], ['With a hairline', { kind: 'matra', solid: ci('Kajol'), rule: 1.1, rstyle: 1 }, null],
        ['End beads', { kind: 'matra', solid: ci('Sindur'), rule: 1.1, rstyle: 2 }, null], ['Shankha', { kind: 'matra', solid: ci('Shankha'), rule: 1.1 }, ci('Kajol')]], { w: 80, h: 3 }],
      // the fourth field picks the path the library draws it along: wave, meander or zigzag
      ['Kantha stitch', [['Sindur, ends', Object.assign({}, KA, { ends: 1.3, endcol: ci('Kajol') }), null, 'wave'],
        ['Double thread', Object.assign({}, KA, { thread: 1, weight: 1.4 }), null, 'meander'],
        ['Shankha river', Object.assign({}, KA, { ink: ci('Shankha') }), ci('Padma'), 'meander'],
        ['Holud path', Object.assign({}, KA, { ink: ci('Holud'), ends: 1.3, endcol: ci('Shankha') }), ci('Neel'), 'zigzag']], { w: 80, h: 24 }],
      ['Alpana', [['Board', { kind: 'alpana', solid: ci('Shankha') }, ci('Mati')],
        ['Lotus six', { kind: 'alpana', solid: ci('Neel'), apet: 1, aform: 2, ainner: 2 }, ci('Holud')],
        ['Spear twelve', { kind: 'alpana', solid: ci('Shankha'), apet: 4, aform: 4, aring: 3 }, ci('Neel')],
        ['Drop ten', { kind: 'alpana', solid: ci('Holud'), apet: 3, aform: 3, ainner: 3 }, ci('Kajol')],
        ['Sixteen', { kind: 'alpana', solid: ci('Shankha'), apet: 5, aform: 1, aring: 3, ainner: 2 }, ci('Padma')]], { w: 40, h: 40 }],
      ['The bird', [['Kajol', { kind: 'bird' }, null],
        ['Night', Object.assign({ kind: 'bird' }, BIRD_NIGHT), ci('Neel')],
        ['Lily', { kind: 'bird', body: ci('Holud'), wing: ci('Kajol'), beak: ci('Sindur'), eye: ci('Kajol'), pupil: ci('Holud'), wstitch: ci('Holud') }, ci('Shapla')],
        ['On its line', { kind: 'bird', perch: 1 }, null],
        ['Looking back', Object.assign({ kind: 'bird', flip: 1, perch: 1, pcol: ci('Holud') }, BIRD_NIGHT), ci('Padma')]], { w: 48, h: 42 }],
      ['Panel', [['Kajol', Object.assign({ pfill: ci('Kajol') }, PANEL), null], ['Shankha text box', Object.assign({ pfill: ci('Shankha') }, PANEL, { fpaper: .6, fgrain: 0 }), null],
        ['Neel section', Object.assign({ pfill: ci('Neel') }, PANEL), null], ['Padma section', Object.assign({ pfill: ci('Padma') }, PANEL), null]], { w: 50, h: 34 }],
    ];
    const PRESETS = [];
    for (const [family, list, box] of BRAND) for (const [variant, P, ground, path] of list)
      PRESETS.push({ name: family + ' · ' + variant, family, variant, box, ground, path, P: Object.assign({ seed: 1826 }, P) });
    return { BRAND, PRESETS, GROUND, A_PET, A_FORM, A_RING, A_INNER, KINDS, KIND_LABELS, PROFILES, SYMS, SHAPE_KINDS, MSTYLES, BAND_TYPES, PALETTE, DEF, withDefaults, geom, hex, orient: G.orient };
  };
  root.OchinShapes = make;
  if (typeof module !== 'undefined' && module.exports) module.exports = make;
})(typeof globalThis !== 'undefined' ? globalThis : this);

// Ochin finish: the brand board's painted finish (brand-board.html finish(), ported from Ornament Studio),
// as pure pixel maths so Affinity, Quire or any app gets the same pixels from the same numbers.
// Wobble, wear, grain and watercolour on the ink; grain and paper on large fills.
// Page-scaled like the board: its sizes are fixed in mm against an A4 cover (REF), not the shape.
//   render(parts, box, F)  -> { x, y, mm, w, h, rgba }  the finished ink of a drawn shape
//   overlay(box, F)        -> the same, a grain/paper overlay for a panel (its fill stays vector)
//   panel(shapes, colour, box, F) -> a panel drawn whole in pixels (when it fades or carries a gradient)
// parts: [{ fill: bool, shapes: [[x, y] mm polylines], colour: '#rrggbb', w: stroke width mm }] in drawing order.
// F: { seed, wobble, wear, grain, water, paper, dpi, fade: [left, right, top, bottom] mm, gcol: '#rrggbb', gang: degrees, gamt: 0..1 }. rgba is straight (not premultiplied) RGBA8.
(function (root) {
  const REF = 297, LAM = Math.hypot(210, 297) * .012, U = REF / 1000;   // page scale, wobble wavelength, the board's unit (mm)
  function noise2(seed) {
    const h = (x, y) => { let n = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 982451653) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
    return (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
      return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    };
  }
  // fbm over the image in mm: freq = cycles across the reference page, as the board's field()
  function field(I, seed, freq, oct) {
    const n = noise2(seed), v = new Float32Array(I.w * I.h);
    let norm = 0; for (let o = 0, a = 1; o < oct; o++, a /= 2) norm += a;
    for (let y = 0; y < I.h; y++) for (let x = 0; x < I.w; x++) {
      const X = (I.x + (x + .5) / I.k) / REF, Y = (I.y + (y + .5) / I.k) / REF;
      let t = 0, a = 1, f = freq;
      for (let o = 0; o < oct; o++) { t += a * n(X * f + o * 19.1, Y * f + o * 7.3); a /= 2; f *= 2; }
      v[y * I.w + x] = t / norm;
    }
    return v;
  }
  // field -> signed shade in [-1, 1]: + paints white, - paints black, |s| is the alpha (board shade())
  const shade = (I, seed, freq, oct, contrast) => field(I, seed, freq, oct).map((v) => Math.max(-1, Math.min(1, (v - .5) * contrast * 2)));
  // grain: a random value per cell of 0.8 board units, smoothed between cells (canvas draws it scaled)
  function grain(I, seed) {
    const cell = U * .8, out = new Float32Array(I.w * I.h);
    const h = (x, y) => { let n = Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(seed ^ 0x5bd1e995, 83492791); n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296 * 2 - 1; };
    for (let y = 0; y < I.h; y++) for (let x = 0; x < I.w; x++) {
      const X = (I.x + (x + .5) / I.k) / cell - .5, Y = (I.y + (y + .5) / I.k) / cell - .5, xi = Math.floor(X), yi = Math.floor(Y), fx = X - xi, fy = Y - yi;
      const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
      out[y * I.w + x] = a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
    }
    return out;
  }
  // gaussian blur (sigma in mm) of one premultiplied channel set: three box passes each way
  function blur(I, src, sigmaMM) {
    const s = sigmaMM * I.k, r = Math.max(0, Math.round((Math.sqrt(12 * s * s / 3 + 1) - 1) / 2));
    if (!r) return src.slice();
    let a = src.slice(), b = new Float32Array(src.length);
    const pass = (from, to, horiz) => {
      const W = I.w, H = I.h, n = horiz ? W : H, m = horiz ? H : W, d = 2 * r + 1;
      for (let j = 0; j < m; j++) for (let ch = 0; ch < 4; ch++) {
        const at = (i) => 4 * (horiz ? j * W + Math.max(0, Math.min(n - 1, i)) : Math.max(0, Math.min(n - 1, i)) * W + j) + ch;
        let acc = 0; for (let i = -r; i <= r; i++) acc += from[at(i)];
        for (let i = 0; i < n; i++) { to[at(i)] = acc / d; acc += from[at(i + r + 1)] - from[at(i - r)]; }
      }
    };
    for (let k = 0; k < 3; k++) { pass(a, b, true); pass(b, a, false); }
    return a;
  }
  const rgb = (hex) => [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255];

  // ---- drawing the vector parts into premultiplied RGBA (anti-aliased) -------------------------
  function fillCoverage(I, shapes) {
    const cov = new Float32Array(I.w * I.h), E = [], SUB = 4;
    for (const s of shapes) for (let i = 0; i < s.length; i++) {
      const p = s[i], q = s[(i + 1) % s.length];
      E.push([(p[0] - I.x) * I.k, (p[1] - I.y) * I.k, (q[0] - I.x) * I.k, (q[1] - I.y) * I.k]);
    }
    const xs = [];
    for (let py = 0; py < I.h; py++) for (let sub = 0; sub < SUB; sub++) {
      const yy = py + (sub + .5) / SUB; xs.length = 0;
      for (const [x0, y0, x1, y1] of E) if ((y0 > yy) !== (y1 > yy)) xs.push(x0 + (x1 - x0) * (yy - y0) / (y1 - y0));
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) {   // even-odd spans, exact horizontal coverage
        const a = Math.max(0, xs[i]), b = Math.min(I.w, xs[i + 1]);
        for (let x = Math.floor(a); x < b; x++) cov[py * I.w + x] += (Math.min(x + 1, b) - Math.max(x, a)) / SUB;
      }
    }
    return cov;
  }
  function strokeCoverage(I, shapes, wMM) {
    const cov = new Float32Array(I.w * I.h), hw = wMM * I.k / 2;
    for (const s of shapes) for (let i = 0; i + 1 < s.length; i++) {   // round-capped segments
      const ax = (s[i][0] - I.x) * I.k, ay = (s[i][1] - I.y) * I.k, bx = (s[i + 1][0] - I.x) * I.k, by = (s[i + 1][1] - I.y) * I.k;
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1e-9;
      for (let y = Math.max(0, Math.floor(Math.min(ay, by) - hw - 1)); y < Math.min(I.h, Math.ceil(Math.max(ay, by) + hw + 1)); y++)
        for (let x = Math.max(0, Math.floor(Math.min(ax, bx) - hw - 1)); x < Math.min(I.w, Math.ceil(Math.max(ax, bx) + hw + 1)); x++) {
          const px = x + .5, py = y + .5, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2));
          const d = Math.hypot(px - ax - t * dx, py - ay - t * dy), c = Math.max(0, Math.min(1, hw - d + .5)), j = y * I.w + x;
          if (c > cov[j]) cov[j] = c;
        }
    }
    return cov;
  }
  function image(box, F, margin) {
    const k = (F.dpi || 300) / 25.4, x = box.x - margin, y = box.y - margin;
    const w = Math.max(1, Math.ceil((box.w + 2 * margin) * k)), h = Math.max(1, Math.ceil((box.h + 2 * margin) * k));
    return { x, y, k, w, h, mm: { x, y, w: w / k, h: h / k } };
  }

  // gradient: ink tinted toward F.gcol along F.gang (0 = left to right, 90 = top to bottom), F.gamt at the far side
  function tone(I, ink, box, F) {
    if (!F.gcol || !F.gamt) return;
    const g = rgb(F.gcol), a = (F.gang || 0) * Math.PI / 180, dx = Math.cos(a), dy = Math.sin(a);
    const pr = [[box.x, box.y], [box.x + box.w, box.y], [box.x, box.y + box.h], [box.x + box.w, box.y + box.h]].map((q) => q[0] * dx + q[1] * dy);
    const lo = Math.min(...pr), span = Math.max(...pr) - lo || 1;
    for (let y = 0; y < I.h; y++) for (let x = 0; x < I.w; x++) {
      const j = 4 * (y * I.w + x), al = ink[j + 3]; if (!al) continue;
      const m = Math.max(0, Math.min(1, ((I.x + (x + .5) / I.k) * dx + (I.y + (y + .5) / I.k) * dy - lo) / span)) * F.gamt;
      for (let c = 0; c < 3; c++) ink[j + c] = ink[j + c] * (1 - m) + g[c] * al * m;
    }
  }
  // edge fades: each side of the box goes clear over its own width (mm), smoothstepped
  function fade(I, ink, box, F) {
    const [l, r, t, b] = F.fade || []; if (!(l || r || t || b)) return;
    const ss = (v) => (v <= 0 ? 0 : v >= 1 ? 1 : v * v * (3 - 2 * v)), ramp = (d, w) => (w ? ss(d / w) : 1);
    for (let y = 0; y < I.h; y++) for (let x = 0; x < I.w; x++) {
      const X = I.x + (x + .5) / I.k, Y = I.y + (y + .5) / I.k, j = 4 * (y * I.w + x);
      const m = ramp(X - box.x, l) * ramp(box.x + box.w - X, r) * ramp(Y - box.y, t) * ramp(box.y + box.h - Y, b);
      if (m < 1) for (let c = 0; c < 4; c++) ink[j + c] *= m;
    }
  }

  // ---- the board's finish() on one piece of art ------------------------------------------------
  function render(parts, box, F) {
    const water = F.water || 0, I = image(box, F, 1.5 + 3 * U * (3 + 10 * water) + LAM * .45 * (F.wobble || 0));
    let ink = new Float32Array(I.w * I.h * 4);
    for (const p of parts) {   // source-over, in drawing order
      const cov = p.fill ? fillCoverage(I, p.shapes) : strokeCoverage(I, p.shapes, p.w), c = rgb(p.colour);
      for (let i = 0; i < cov.length; i++) { const a = Math.min(1, cov[i]); if (!a) continue; const j = 4 * i, keep = 1 - a; ink[j] = c[0] * a + ink[j] * keep; ink[j + 1] = c[1] * a + ink[j + 1] * keep; ink[j + 2] = c[2] * a + ink[j + 2] * keep; ink[j + 3] = a + ink[j + 3] * keep; }
    }
    tone(I, ink, box, F);
    const N = I.w * I.h, seed = F.seed | 0;
    if (F.wobble) {   // each pixel taken from a point moved by two noise fields one wavelength long
      const A = F.wobble * LAM * .45 * I.k, f = REF / LAM, n1 = field(I, seed + 11, f, 1), n2 = field(I, seed + 12, f, 1), out = new Float32Array(ink.length);
      for (let y = 0; y < I.h; y++) for (let x = 0; x < I.w; x++) {
        const i = y * I.w + x, sx = Math.min(I.w - 1, Math.max(0, Math.round(x + A * (2 * n1[i] - 1)))), sy = Math.min(I.h - 1, Math.max(0, Math.round(y + A * (2 * n2[i] - 1)))), j = 4 * (sy * I.w + sx);
        out[4 * i] = ink[j]; out[4 * i + 1] = ink[j + 1]; out[4 * i + 2] = ink[j + 2]; out[4 * i + 3] = ink[j + 3];
      }
      ink = out;
    }
    if (F.wear) {   // fine specks lifted, gathered in broad patches; wear = share of ink lifted
      const A = field(I, seed + 3, 5, 3), B = field(I, seed + 5, 160, 2), v = A.map((a, i) => .35 * a + .65 * B[i]), q = [];
      for (let i = 0; i < N; i += 97) q.push(v[i]); q.sort((a, b) => a - b);
      const t = q[Math.min(q.length - 1, Math.floor(F.wear * .4 * q.length))], soft = (q[q.length - 1] - q[0]) * .03 || 1e-6;
      for (let i = 0; i < N; i++) { const m = 1 - Math.max(0, Math.min(1, (t - v[i]) / soft + .5)); for (let c = 0; c < 4; c++) ink[4 * i + c] *= m; }
    }
    const sil = new Float32Array(N); for (let i = 0; i < N; i++) sil[i] = ink[4 * i + 3];
    const atop = (i, white, a) => { const j = 4 * i, g = white ? 1 : 0, da = ink[j + 3]; ink[j] = g * a * da + ink[j] * (1 - a); ink[j + 1] = g * a * da + ink[j + 1] * (1 - a); ink[j + 2] = g * a * da + ink[j + 2] * (1 - a); };
    if (F.grain) { const g = grain(I, seed); for (let i = 0; i < N; i++) atop(i, g[i] > 0, Math.abs(g[i]) * 200 / 255 * F.grain * .45); }
    if (water) {
      const pool = shade(I, seed + 41, 7, 4, 1.6);                                      // pigment pooling
      for (let i = 0; i < N; i++) atop(i, pool[i] > 0, Math.abs(pool[i]) * water * .5);
      const s4 = new Float32Array(N * 4); for (let i = 0; i < N; i++) s4[4 * i + 3] = sil[i];
      const bs = blur(I, s4, U * (1 + 2.5 * water));                                    // darker rim where it dried
      for (let i = 0; i < N; i++) atop(i, false, sil[i] * (1 - bs[4 * i + 3]) * water * .55);
      const halo = blur(I, ink, U * (3 + 10 * water)), holes = shade(I, seed + 43, 6, 3, 2.6);   // bleed, broken up
      for (let i = 0; i < N; i++) { const j = 4 * i, m = (1 - Math.abs(holes[i])) * water * .6, keep = 1 - ink[j + 3]; for (let c = 0; c < 4; c++) ink[j + c] += halo[j + c] * m * keep; }
    }
    fade(I, ink, box, F);
    return out(I, ink);
  }
  // a panel's finish: grain (and the paper's mottle) laid inside a big fill, which stays vector
  // base = { shapes, colour }: the panel's own fill drawn in too (opaque, clipped to its outline at the end)
  function overlay(box, F, base) {
    const I = image(box, F, 0), N = I.w * I.h, ink = new Float32Array(N * 4), seed = F.seed | 0;
    if (base) { const c = rgb(base.colour); for (let i = 0; i < N; i++) { ink[4 * i] = c[0]; ink[4 * i + 1] = c[1]; ink[4 * i + 2] = c[2]; ink[4 * i + 3] = 1; } tone(I, ink, box, F); }
    const lay = (i, white, a) => { const j = 4 * i, g = white ? 1 : 0, keep = 1 - a; ink[j] = g * a + ink[j] * keep; ink[j + 1] = g * a + ink[j + 1] * keep; ink[j + 2] = g * a + ink[j + 2] * keep; ink[j + 3] = a + ink[j + 3] * keep; };
    if (F.paper) {
      const m = shade(I, seed + 7, 4, 5, 1.4), g = grain(I, seed + 9);
      for (let i = 0; i < N; i++) { lay(i, m[i] > 0, Math.abs(m[i]) * F.paper * .2); lay(i, g[i] > 0, Math.abs(g[i]) * 200 / 255 * F.paper * .2); }
    }
    if (F.grain) { const g = grain(I, seed); for (let i = 0; i < N; i++) lay(i, g[i] > 0, Math.abs(g[i]) * 200 / 255 * F.grain * .45); }
    if (base) { const cov = fillCoverage(I, base.shapes); for (let i = 0; i < N; i++) { const m = Math.min(1, cov[i]); for (let c = 0; c < 4; c++) ink[4 * i + c] *= m; } }
    fade(I, ink, box, F);
    return out(I, ink);
  }
  const panel = (shapes, colour, box, F) => overlay(box, F, { shapes, colour });
  function out(I, ink) {
    const rgba = new Uint8Array(I.w * I.h * 4);
    for (let i = 0; i < I.w * I.h; i++) {
      const j = 4 * i, a = Math.min(1, ink[j + 3]);
      if (a <= 0) continue;
      rgba[j] = Math.round(Math.min(1, ink[j] / a) * 255); rgba[j + 1] = Math.round(Math.min(1, ink[j + 1] / a) * 255); rgba[j + 2] = Math.round(Math.min(1, ink[j + 2] / a) * 255); rgba[j + 3] = Math.round(a * 255);
    }
    return { x: I.mm.x, y: I.mm.y, mm: I.mm, w: I.w, h: I.h, rgba };
  }
  // the board's settings: drawn shapes get the full finish; big fills and thin strips grain only
  const BOARD = { wobble: .3, wear: .01, grain: .5, water: .125, paper: .6 };
  root.OchinFinish = { render, overlay, panel, BOARD };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.OchinFinish;
})(typeof globalThis !== 'undefined' ? globalThis : this);

// Ochin Shape: select a shape on the page, run this, and edit it live. It draws the brand board's
// signatures (lal paar, matra rule, kantha stitch, alpana, the bird) and the panel, all from shapes.js,
// and nothing else (the festival generators live in the Ornament Pack), plus line weight,
// wobble, colours, opacity, shadow, relief and Affinity's live effects. The page updates as you
// change a value; OK keeps it, Cancel puts the shape back. The settings are stored on the shape
// (tag 'ochin'), so running it again reopens them; a group keeps one layer per part.
//   - a shape made by the page build or the library opens with its own settings;
//   - any other shape (the glow, a rectangle you drew) becomes an ornament in its box, and is
//     replaced by it on OK. A pen-drawn shape keeps its outline: closed, it becomes a panel of
//     that shape; open, a kantha stitch or border band runs along it.
// make-tool.sh joins geo.js + shapes.js + this file + a call into one library script.
// build.js and library.js call it too (opt = { doc, target | parent + anchor, params }), so the pages,
// the brand library and the dialog draw every shape through the same code.
function ochinShape(opt) {
  opt = opt || {};
  const { app } = require('/application');
  const { Document } = require('/document');
  const { Dialog, DialogResult, UnitType } = require('/dialog');
  const { DocumentCommand, AddChildNodesCommandBuilder, NodeMoveType } = require('/commands');
  const { CurveBuilder, PolyCurve } = require('/geometry');
  const { PolyCurveNodeDefinition, ContainerNodeDefinition, NodeChildType } = require('/nodes');
  const { Selection } = require('/selections');
  const { FillDescriptor, GradientFill, GradientFillType } = require('/fills');
  const { Colour, RGBAuf, Gradient } = require('/colours');
  const { OuterShadowLayerEffect, BevelEmbossLayerEffect, GaussianBlurLayerEffect, InnerGlowLayerEffect, GradientOverlayLayerEffect } = require('/layereffects');
  const { BlendMode } = require('/blendmodeinterface');
  const { LineStyle, LineStyleDescriptor, LineCap, LineStyleMask } = require('/linestyle');
  const { Bitmap, RasterFormat } = require('/rasterobject');
  const { ImageNodeDefinition } = require('/nodes');
  const { PixelReaderWriterRGBA8 } = require('/pixelaccessor');
  const { Transform } = require('/geometry');
  const Fin = globalThis.OchinFinish;
  const S = globalThis.OchinShapes(opt.G || globalThis.G), KEY = 'ochin';

  const doc = opt.doc || Document.current;
  if (!doc) { app.alert('Open a document first.'); return; }
  const MM = (v) => v * doc.dpi / 25.4, toMM = (v) => v * 25.4 / doc.dpi;
  const run = (cmd) => doc.executeCommand(cmd);
  const sel = (n) => Selection.create(doc, n);
  function col(hex, a) { const c = new RGBAuf(); c.r = parseInt(hex.slice(1, 3), 16) / 255; c.g = parseInt(hex.slice(3, 5), 16) / 255; c.b = parseInt(hex.slice(5, 7), 16) / 255; c.alpha = a === undefined ? 1 : a; return Colour.createRGBAuf(c); }

  // ---- what is being edited -------------------------------------------------------------
  let picked = opt.anchor ? opt.target || null : opt.target || doc.selection.firstNode;
  if (!picked && !opt.anchor) { app.alert('Select a shape on the page first, then run Ochin Shape.'); return; }
  let target = picked; while (target && !(target.hasKey && target.hasKey(KEY))) target = target.parent;
  const tagged = !!target; if (!tagged) target = picked;
  const parent = opt.parent || picked.parent;
  // commands on a shape outside the current spread fail (COMMAND_FAILED): work on its spread
  const home = (target || parent).spread || parent;
  if (home && doc.currentSpread && !doc.currentSpread.isSameNode(home)) run(DocumentCommand.createSetCurrentSpread(home));
  const saved = tagged ? JSON.parse(target.getValueForKey(KEY)) : null;
  const box = () => { const b = picked.spreadBaseBox; return { x: toMM(b.x), y: toMM(b.y), w: toMM(b.width), h: toMM(b.height) }; };
  // a pen-drawn curve, in spread mm: its outline (closed) or its path (open); a plain rectangle stays a box
  function pen() {
    try {
      if (!picked.curvesInterface) return null;
      const pc = picked.polyCurve.clone(); pc.transform(picked.curvesInterface.domainTransform);
      const c = pc.at(0); if (c.isRectangle) return null;
      const pts = [];
      for (const bz of c.beziers) for (let k = pts.length ? 1 : 0; k <= 12; k++) { const p = bz.evaluate(k / 12); pts.push([toMM(p.x), toMM(p.y)]); }
      return pts.length > 2 ? { closed: c.isClosed, pts } : null;
    } catch (e) { return null; }
  }
  const drawn = saved || opt.anchor ? null : pen();
  const A = saved ? saved.A : opt.anchor || Object.assign({ box: box() }, drawn && (drawn.closed ? { poly: drawn.pts } : { pts: drawn.pts }));
  // a panel is one filled outline (its own fill is kept unless pfill sets one); everything else is a group of parts
  const isPanel = tagged ? saved.P.kind === 'panel' : false;
  const canPanel = !tagged && !!target && !!target.curvesInterface;
  const origPC = canPanel ? target.polyCurve : null, origFill = canPanel ? target.brushFillDescriptor : null;
  const hex2 = (v) => v.toString(16).padStart(2, '0');
  // a grained field (Quire, Ochin 01) is a bitmap fill: its colour is named in its layer name instead
  function ownFill(n) {
    try { const c = n.brushFillDescriptor.fill.colour.rgba8; if (c.alpha) return '#' + hex2(c.r) + hex2(c.g) + hex2(c.b); } catch (e) { /* not a solid fill */ }
    const m = /#[0-9a-f]{6}/i.exec(String(n && n.userDescription || ''));
    return m ? m[0].toUpperCase() : null;
  }
  // Ochin's own shapes only. The festival generators (alpona, kolam, rosette, band) are the Ornament
  // Pack's: shapes.js still draws them for the pages that ask, but this tool does not offer them.
  const BRAND = ['lalpaar', 'matra', 'stitch', 'alpana', 'bird', 'panel'];
  const kinds = tagged ? (isPanel ? ['panel'] : BRAND.filter((k) => k !== 'panel')) : BRAND.filter((k) => k !== 'panel' || canPanel);
  // a filled shape you already have (a field, a ground, a circle, a rectangle) opens as a panel and keeps its
  // place and colour; only a line or an open path guesses a stitch, and only an empty box an ornament
  const thin = A.box.h < 3 || A.box.w / Math.max(A.box.h, .01) > 6;
  const filled = canPanel && !A.pts && !!ownFill(target);
  const guess = A.poly || (filled && !thin) ? 'panel' : A.pts || thin ? 'stitch' : 'alpana';
  const orig = S.withDefaults(saved ? saved.P : { kind: guess, size: 0 });
  // a panel's own colour, remembered on the shape (pown): a panel drawn in pixels has no vector fill left to read
  if ((isPanel || canPanel) && !orig.pown) orig.pown = ownFill(target) || S.hex(1);

  // ---- drawing ------------------------------------------------------------------------------
  function curves(shapes, close) {
    const pc = PolyCurve.create();
    for (const s of shapes) {
      if (s.length < 2) continue;
      const cb = CurveBuilder.create(); cb.beginXY(MM(s[0][0]), MM(s[0][1]));
      for (let i = 1; i < s.length; i++) cb.lineToXY(MM(s[i][0]), MM(s[i][1]));
      if (close || s.c) cb.close();
      pc.addCurve(cb.createCurve());
    }
    return pc;
  }
  function add(def, parent) {
    const b = AddChildNodesCommandBuilder.create(); b.setInsertionTarget(parent); b.addNode(def); run(b.createCommand());
    let n = parent.getFirstChild(NodeChildType.Main), last = n; while (n) { last = n; n = n.nextSibling; } return last;
  }
  let group = tagged && !isPanel ? target : null, made = null;
  const child = (name) => { for (let n = group.getFirstChild(NodeChildType.Main); n; n = n.nextSibling) if (n.userDescription === name) return n; return null; };
  function ensureGroup() {
    if (group) return;
    group = made = add(ContainerNodeDefinition.createDefault(), parent);
  }
  function dropGroup() { if (made) { made.delete(); made = group = null; } }

  function effects(n, P) {
    const fx = OuterShadowLayerEffect.create();
    fx.radius = MM(.2 + 4 * P.soft); fx.offset = MM(.2 + 5 * P.dist); fx.angle = (P.light + 180) * Math.PI / 180; fx.intensity = 0; fx.colour = col('#000000');
    run(DocumentCommand.createSetOuterShadowLayerEffect(sel(n), fx, 0));
    run(DocumentCommand.createSetOuterShadowLayerEffectOpacity(sel(n), 0, P.shadow));
    run(DocumentCommand.createSetOuterShadowLayerEffectEnabled(sel(n), 0, P.shadow > 0));
    const bv = BevelEmbossLayerEffect.create();
    bv.radius = MM(.3 + .6 * Math.abs(P.relief)); bv.depth = Math.abs(P.relief) * 3; bv.azimuth = P.light * Math.PI / 180; bv.invert = P.relief < 0;
    run(DocumentCommand.createSetBevelEmbossLayerEffect(sel(n), bv));
    run(DocumentCommand.createSetBevelEmbossLayerEffectEnabled(sel(n), P.relief !== 0));
  }
  // ---- pixel finishes: live effects and filters, so each stays editable ---------------------
  const BLENDS = [['Normal', 'Normal'], ['Multiply (paper shows through)', 'Multiply'], ['Overlay', 'Overlay'], ['Soft light', 'SoftLight'],
    ['Screen', 'Screen'], ['Colour burn', 'ColourBurn'], ['Darken', 'Darken']];
  const SURFACES = ['None', 'Sheen', 'Gold foil', 'Silver foil', 'Two-tone'];
  function surfaceStops(P) {
    const st = (list) => list.map(([h, pos, a]) => ({ colour: col(h, a), position: pos }));
    switch (P.surface) {
      case 1: return st([['#FFFFFF', 0, 0], ['#FFFFFF', .48, .85], ['#FFFFFF', 1, 0]]);
      case 2: return st([['#8A6A1E', 0], ['#F7E08A', .42], ['#B8902F', .6], ['#FFF4C2', .8], ['#9C7A26', 1]]);
      case 3: return st([['#6E7378', 0], ['#F2F4F5', .42], ['#9AA0A6', .6], ['#FFFFFF', .8], ['#80868C', 1]]);
      case 4: return st([[S.hex(P.ink), 0], [S.hex(P.tone2), 1]]);
    }
    return null;
  }
  // a group's layers, one per part (Solids, Lines, or the bird's body, wing, beak...), in drawing order;
  // each takes its colour from the setting its pieces name (.key) and strokes their own weight (.w, mm)
  function parts(o, P) {
    const L = new Map(), get = (name, v) => L.get(name) || L.set(name, Object.assign({ name, shapes: [] }, v)).get(name);
    for (const s of o.fills) get(s.role || 'Solids', { fill: true, key: s.key || 'solid' }).shapes.push(s);
    for (const s of o.strokes) get(s.role || 'Lines', { fill: false, key: s.key || 'ink', pt: s.w ? s.w * 72 / 25.4 : P.weight }).shapes.push(s);
    return [...L.values()];
  }
  function roundCaps(n) {
    const ls = LineStyle.createDefault(); ls.cap = LineCap.Round;
    run(DocumentCommand.createSetLineStyleDescriptor(sel(n), LineStyleDescriptor.create(ls), { lineStyleMask: LineStyleMask.Cap }));
  }
  function draw(group, P, o) {
    const want = parts(o, P), names = new Set(want.map((w) => w.name).concat('Finish'));
    for (let c = group.getFirstChild(NodeChildType.Main), next; c; c = next) { next = c.nextSibling; if (!names.has(c.userDescription)) c.delete(); }
    for (const w of want) {
      const pc = curves(w.fill ? w.shapes.map(S.orient) : w.shapes, w.fill);
      let c = child(w.name);
      if (!c) { const d = PolyCurveNodeDefinition.createDefault(); d.setCurves(pc); c = add(d, group); c.userDescription = w.name; }
      else run(DocumentCommand.createSetCurves(c.curvesInterface, pc));
      const paint = FillDescriptor.createSolid(col(S.hex(P[w.key])));
      doc.setBrushFillDescriptor(w.fill ? paint : FillDescriptor.createNone(), sel(c));
      doc.setPenFillDescriptor(w.fill ? FillDescriptor.createNone() : paint, sel(c));
      if (!w.fill) { doc.setLineWeightPts(w.pt, sel(c)); roundCaps(c); }
    }
  }
  function pixel(n, P) {
    const blur = GaussianBlurLayerEffect.create(); blur.radius = MM(.1 + 1.1 * P.wash);
    run(DocumentCommand.createSetGaussianBlurLayerEffect(sel(n), blur));
    run(DocumentCommand.createSetGaussianBlurLayerEffectEnabled(sel(n), P.wash > 0));
    const pool = InnerGlowLayerEffect.create(); pool.radius = MM(1 + 4 * P.wash); pool.colour = col('#3A1410'); pool.intensity = 0; pool.blendMode = BlendMode.Multiply;
    run(DocumentCommand.createSetInnerGlowLayerEffect(sel(n), pool));
    run(DocumentCommand.createSetInnerGlowLayerEffectOpacity(sel(n), .65 * P.wash));
    run(DocumentCommand.createSetInnerGlowLayerEffectEnabled(sel(n), P.wash > 0));
    const stops = surfaceStops(P), ov = GradientOverlayLayerEffect.create();
    // opacity goes on the effect itself: the Opacity command leaves a panel's overlay at 0
    if (stops) { ov.fillDescriptor = FillDescriptor.create(GradientFill.create(Gradient.create(stops), GradientFillType.Linear), true, undefined, BlendMode.Normal, false); ov.blendMode = P.surface === 1 ? BlendMode.Screen : BlendMode.Normal; }
    ov.opacity = P.sstr; ov.enabled = !!stops;
    run(DocumentCommand.createSetGradientOverlayLayerEffect(sel(n), ov, 0));
    run(DocumentCommand.createSetGradientOverlayLayerEffectEnabled(sel(n), 0, !!stops));
    run(DocumentCommand.createSetBlendMode(sel(n), BlendMode[(BLENDS[P.blend] || BLENDS[0])[1]]));
  }
  // ---- the finish: an image from finish.js inside the shape, placed on its mm rectangle -------------
  function image(parent, r) {
    const bmp = Bitmap.create(r.w, r.h, RasterFormat.RGBA8), wr = PixelReaderWriterRGBA8.create(bmp), px = r.rgba;
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) { const j = 4 * (y * r.w + x); if (px[j + 3]) wr.writePixel(x, y, { r: px[j], g: px[j + 1], b: px[j + 2], alpha: px[j + 3] }); }
    const d = ImageNodeDefinition.create(RasterFormat.RGBA8); d.bitmap = bmp;   // assigned, not passed to create(): that gives a blank layer
    const n = add(d, parent), bb = n.getSpreadBaseBox(false);
    doc.applyTransform(Transform.createTranslate(MM(r.mm.x), MM(r.mm.y)).multiply(Transform.createScale(MM(r.mm.w) / bb.width, MM(r.mm.h) / bb.height)).multiply(Transform.createTranslate(-bb.x, -bb.y)), n);
    n.userDescription = 'Finish'; return n;
  }
  const FINISH = (P) => ({ seed: P.seed, wobble: P.fwob, wear: P.fwear, grain: P.fgrain, water: P.fwater, paper: P.fpaper, dpi: P.fdpi,
    fade: [P.fadeL, P.fadeR, P.fadeT, P.fadeB], gcol: P.gcol >= 0 ? S.hex(P.gcol) : null, gang: P.gang, gamt: P.gamt });
  // a panel that fades or carries a gradient is drawn whole in pixels; its vector fill turns clear
  const pixelPanel = (P) => P.fin && (P.fadeL || P.fadeR || P.fadeT || P.fadeB || P.gcol >= 0);
  const panelHex = (P) => (P.pfill >= 0 ? S.hex(P.pfill) : P.pown);
  // finished = draw the finish now (OK, the build); otherwise drop it and show the vectors (live editing)
  function finish(n, P, o, finished) {
    const old = childOf(n, 'Finish'); if (old) old.delete();
    const on = finished && P.fin;
    if (P.kind === 'panel') {
      const b = bboxOf(o.fills);
      if (on && pixelPanel(P)) image(n, Fin.panel(o.fills, panelHex(P), b, FINISH(P)));
      else if (on && (P.fgrain || P.fpaper)) image(n, Fin.overlay(b, FINISH(P)));
      return;
    }
    for (let c = n.getFirstChild(NodeChildType.Main); c; c = c.nextSibling) run(DocumentCommand.createSetVisibility(sel(c), !on));
    if (on) image(n, Fin.render(parts(o, P).map((w) => ({ fill: w.fill, shapes: w.shapes, colour: S.hex(P[w.key]), w: (w.pt || 0) * 25.4 / 72 })), bboxOf([...o.fills, ...o.strokes]), FINISH(P)));
  }
  const childOf = (n, name) => { for (let c = n.getFirstChild(NodeChildType.Main); c; c = c.nextSibling) if (c.userDescription === name) return c; return null; };
  const bboxOf = (list) => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const s of list) for (const q of s) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); } return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; };

  function apply(P, finished) {
    const o = S.geom(P, A);
    if (P.kind === 'panel') {
      dropGroup();
      asCurve();
      if (!(A.poly && !P.profile)) run(DocumentCommand.createSetCurves(target.curvesInterface, curves(o.fills, true)));   // a pen shape keeps its own beziers
      const px = finished && pixelPanel(P);
      if (P.pfill >= 0 || px || ownFill(target) !== P.pown) doc.setBrushFillDescriptor(FillDescriptor.createSolid(col(panelHex(P), px ? 0 : 1)), sel(target));
      run(DocumentCommand.createSetOpacity(sel(target), P.opacity)); effects(target, P); pixel(target, P); finish(target, P, o, finished);
      target.userDescription = 'Ochin · Panel edge';
      return target;
    }
    ensureGroup(); draw(group, P, o); finish(group, P, o, finished);
    run(DocumentCommand.createSetOpacity(sel(group), P.opacity));
    effects(group, P); pixel(group, P);
    group.userDescription = 'Ochin · ' + S.KIND_LABELS[S.KINDS.indexOf(P.kind)] + ' #' + P.seed;
    return group;
  }
  // A native rectangle or ellipse cannot take new curves (the node is disposed): it is swapped once for a
  // curve of the same outline, fill and name, in the same place in the stack.
  function asCurve() {
    if (!target || !target.isShapeNode) return;
    const pc = target.polyCurve.clone(), fill = target.brushFillDescriptor, name = target.userDescription;
    const d = PolyCurveNodeDefinition.createDefault(); d.setCurves(pc);
    const n = add(d, target.parent);
    run(DocumentCommand.createMoveNodes(sel(n), target, NodeMoveType.After, NodeChildType.Main));
    doc.setBrushFillDescriptor(fill, sel(n));
    n.userDescription = name;
    const old = target; target = picked = n; old.delete();
  }
  function keep(n, P) {
    run(DocumentCommand.createSetTagValueForKey(sel(n), KEY, JSON.stringify({ P, A })));
    if (!tagged && picked && n !== picked) picked.delete();   // the ornament replaces what was selected
  }

  // ---- the dialog: the Ornament Studio's controls, grouped by kind ----------------------------
  // spec rows: [key, label, kind of control, min, max, int]
  const N = 'num', MMU = 'mm', LIST = 'list', CHECKS = 'checks', PAL = S.PALETTE.map((p) => p[0]);
  const OFF1 = new Set(['pfill', 'gcol']);   // lists whose first entry means -1 (keep its own / none)
  const presets = S.PRESETS.filter((q) => kinds.includes(q.P.kind));   // only what this shape can become
  const PANES = [
    ['Shape', null, [['kind', 'Shape', LIST, kinds.map((k) => S.KIND_LABELS[S.KINDS.indexOf(k)])], ['seed', 'Design number (seed)', N, 0, 99999, 1]]],
    ['Alpona', ['alpona'], [['rings', 'Rings (0 = let the seed decide)', N, 0, 7, 1], ['sym', 'Symmetry', LIST, ['Let the seed decide', '6-fold', '8-fold', '10-fold', '12-fold', '16-fold']]]],
    ['Kolam', ['kolam'], [['cols', 'Dots across', N, 3, 21, 1], ['rows', 'Dots down', N, 3, 21, 1],
      ['kshape', 'Kolam shape', LIST, ['Let the seed decide', 'Square', 'Diamond', 'Cross', 'Circle', 'Octagon']],
      ['kline', 'Line', LIST, ['Let the seed decide', 'Single', 'Double (kambi)']], ['kdots', 'Dots', LIST, ['Let the seed decide', 'Dots', 'Rings', 'Tiny lotus', 'No dots']],
      ['density', 'Twistiness', N, .05, .7]]],
    ['Rosette', ['rosette'], [['copies', 'Copies (0 = seed)', N, 0, 72, 1], ['k1', 'Lobes, first wave (0 = seed)', N, 0, 24, 1], ['k2', 'Lobes, second wave (0 = seed)', N, 0, 24, 1]]],
    ['Border band', ['band'], [['band', 'Band', LIST, ['Let the seed decide', ...S.BAND_TYPES]], ['width', 'Band width', MMU, 1, 40], ['groups', 'Repeat in groups of', N, 1, 12, 1]]],
    ['Edge', ['panel'], [['profile', 'Edge shape', LIST, S.PROFILES], ['depth', 'Shape depth', MMU, 0, 8], ['pitch', 'Repeat every', MMU, 1, 60],
      ['pfill', 'Panel colour', LIST, ['Keep its own', ...S.PALETTE.map((p) => p[0])]]]],
    ['Kantha stitch', ['stitch', 'lalpaar'], [['dash', 'Stitch length', MMU, .3, 12], ['gap', 'Gap', MMU, .2, 10]]],
    ['Kantha ends', ['stitch'], [['thread', 'Thread', LIST, ['Single', 'Double']], ['ends', 'End dots (0 = none)', MMU, 0, 6], ['endcol', 'End dot colour', LIST, PAL]]],
    ['Lal paar', ['lalpaar'], [['toff', 'Thread from the top', MMU, 0, 40], ['tstyle', 'Thread', LIST, ['Single', 'Double', 'Thread and dots']]]],
    ['Matra rule', ['matra'], [['rule', 'Rule thickness', MMU, .1, 6], ['rstyle', 'Style', LIST, ['Single', 'With a hairline', 'End beads']]]],
    ['Alpana', ['alpana'], [['apet', 'Petals', LIST, ['Let the seed decide', ...S.A_PET.slice(1).map(String)]], ['aform', 'Petal form', LIST, ['Let the seed decide', ...S.A_FORM.slice(1)]],
      ['aring', 'Outer ring', LIST, ['Let the seed decide', ...S.A_RING.slice(1)]], ['ainner', 'Inner ring', LIST, ['Let the seed decide', ...S.A_INNER.slice(1)]]]],
    ['The bird', ['bird'], [['body', 'Body', LIST, PAL], ['wing', 'Wing', LIST, PAL], ['wstitch', 'Wing stitch', LIST, PAL],
      ['beak', 'Beak', LIST, PAL], ['eye', 'Eye', LIST, PAL], ['pupil', 'Pupil', LIST, PAL],
      ['flip', 'Facing', LIST, ['Right', 'Left']], ['perch', 'On a line', LIST, ['No', 'Yes']], ['pcol', 'Line colour', LIST, PAL]]],
    ['Shapes', ['alpona', 'kolam', 'band'], [['shapeOn', 'Shapes to widen', CHECKS, S.SHAPE_KINDS.map((k) => k[0])], ['shapeW', 'Width of the selected shapes', N, .5, 1.8],
      ['mstyle', 'Motif style', LIST, ['Let the seed decide', 'Classic', 'Line only', 'Solid, details cut out', 'Tinted body']]]],
    ['Size and line', ['stitch', 'lalpaar', 'matra', 'alpana', 'alpona', 'kolam', 'rosette', 'band'], [['size', 'Radius (0 = fit the selection)', MMU, 0, 300], ['weight', 'Line weight (pt)', N, .1, 12],
      ['ink', 'Lines colour', LIST, S.PALETTE.map((p) => p[0])], ['solid', 'Solids colour', LIST, S.PALETTE.map((p) => p[0])]]],
    ['Finish', null, [['amp', 'Hand-drawn wobble', MMU, 0, 4], ['lam', 'Wobble length', MMU, 1, 60], ['opacity', 'Opacity', N, 0, 1],
      ['shadow', 'Shadow', N, 0, 1], ['dist', 'Shadow distance', N, 0, 1], ['soft', 'Shadow softness', N, 0, 1],
      ['light', 'Light direction (degrees)', N, 0, 360, 1], ['relief', 'Relief (left pressed in, right raised)', N, -1, 1]]],
    ['Board finish', null, [['fin', 'Finish', LIST, ['Off', 'On']], ['fwob', 'Wobble', N, 0, 1], ['fwear', 'Wear', N, 0, .5], ['fgrain', 'Grain', N, 0, 1],
      ['fwater', 'Watercolour', N, 0, .6], ['fpaper', 'Paper (panels)', N, 0, 1], ['fdpi', 'Resolution (dpi)', N, 72, 600, 1]]],
    ['Fade and gradient', null, [['fadeL', 'Fade left edge', MMU, 0, 300], ['fadeR', 'Fade right edge', MMU, 0, 300], ['fadeT', 'Fade top edge', MMU, 0, 300],
      ['fadeB', 'Fade bottom edge', MMU, 0, 300], ['gcol', 'Gradient to colour', LIST, ['None', ...PAL]], ['gang', 'Gradient angle (degrees)', N, 0, 360, 1], ['gamt', 'Gradient strength', N, 0, 1]]],
    ['Effects', null, [['wash', 'Watercolour (Affinity effects)', N, 0, 1],
      ['surface', 'Surface', LIST, SURFACES], ['sstr', 'Surface strength', N, 0, 1], ['tone2', 'Two-tone second colour', LIST, S.PALETTE.map((p) => p[0])],
      ['blend', 'Blend with the page', LIST, BLENDS.map((b) => b[0])]]],
  ];
  const EXTRA = { shadow: 0, dist: .3, soft: .4, light: 135, relief: 0, wash: 0, surface: 0, sstr: .7, tone2: 6, blend: 0 };
  Object.assign(S.DEF, EXTRA);
  const start = Object.assign({}, EXTRA, orig);

  function read(ctl) {
    const P = Object.assign({}, start);
    for (const [, , rows] of PANES) for (const [key, , type] of rows) {
      const c = ctl[key];
      if (key === 'kind') P.kind = kinds[c.selectedIndex];
      else if (OFF1.has(key)) P[key] = c.selectedIndex - 1;
      else if (type === LIST) P[key] = c.selectedIndex;
      else if (type === CHECKS) P[key] = c.reduce((m, b, i) => m | (b.value ? 1 << i : 0), 0);
      else P[key] = c.value;
    }
    return P;
  }

  // Cancel: an ornament made here goes; a panel or saved shape goes back to how it was
  function cancel() {
    dropGroup();
    if (tagged) apply(start, true);
    else if (origPC) { run(DocumentCommand.createSetCurves(target.curvesInterface, origPC)); doc.setBrushFillDescriptor(origFill, sel(target)); const P0 = Object.assign({}, S.DEF, EXTRA); effects(target, P0); pixel(target, P0); }
  }
  // the build, the library and the dev test skip the dialog: opt.params = settings, opt.cancel to test Cancel
  if (opt.params) {
    const P = Object.assign({}, start, opt.params);
    const n = apply(P, true);
    if (opt.cancel) { cancel(); return null; }
    keep(n, P); return n;
  }

  const dlg = Dialog.create('Ochin Shape'), ctl = {}, panes = [];
  const colA = dlg.addColumn(), colB = dlg.addColumn();
  PANES.forEach(([title, only, rows], i) => {
    const g = (i < 10 ? colA : colB).addGroup(title); panes.push([g, only]);
    for (const [key, label, type, min, max, int] of rows) {
      const v = start[key];
      if (key === 'kind') ctl.kind = g.addComboBox(label, min, Math.max(0, kinds.indexOf(start.kind)));
      else if (OFF1.has(key)) ctl[key] = g.addComboBox(label, min, v + 1);
      else if (type === LIST) ctl[key] = g.addComboBox(label, min, v);
      else if (type === CHECKS) ctl[key] = min.map((name, j) => g.addCheckBox(name, !!(v >> j & 1)));
      else {
        const u = type === MMU ? UnitType.Millimetre : UnitType.Number;
        const c = ctl[key] = g.addUnitValueEditor(label, u, u, v, min, max);
        c.precision = int ? 0 : 2; c.showPopupSlider = true;
      }
    }
    if (title === 'Shape') ctl.preset = g.addComboBox('Start from a brand preset', ['—', ...presets.map((q) => q.name)], 0);
    if (title === 'Board finish') g.addButton('Preview finish').setOnClickHandler(() => { try { apply(readMM(), true); } catch (e) { console.log('Ochin Shape: ' + e); } });
    if (title === 'Shape') g.addButton('Random design').setOnClickHandler(() => { ctl.seed.value = Math.floor(Math.random() * 99999); update(); });
  });
  // a preset sets every control it names; the rest stay as they are
  function write(P) {
    for (const [, , rows] of PANES) for (const [key, , type] of rows) {
      if (!(key in P)) continue;
      const c = ctl[key], v = P[key];
      if (key === 'kind') c.selectedIndex = Math.max(0, kinds.indexOf(v));
      else if (OFF1.has(key)) c.selectedIndex = v + 1;
      else if (type === LIST) c.selectedIndex = v;
      else if (type === CHECKS) c.forEach((b, j) => { b.value = !!(v >> j & 1); });
      else c.value = v;
    }
  }
  let lastPreset = 0;
  const readMM = () => read(ctl);   // mm editors report millimetres (as in the Ornament Pack)
  const show = (P) => { for (const [g, only] of panes) g.isVisible = !only || only.includes(P.kind); };
  let busy = false;
  function update() {
    if (busy) return; busy = true;
    try {
      const pi = ctl.preset.selectedIndex;
      if (pi !== lastPreset) { lastPreset = pi; if (pi) write(Object.assign({}, S.DEF, EXTRA, presets[pi - 1].P)); }
      const P = readMM(); show(P); apply(P, false);
    } catch (e) { console.log('Ochin Shape: ' + e); } finally { busy = false; }
  }
  dlg.onControlValueChangedHandler = update;
  dlg.initialWidth = 760;
  show(start); apply(start, false);
  if (opt.dry) { const n = dlg.controls.length; cancel(); return n; }   // dev check: dialog builds, no modal
  const res = dlg.runModal();
  if (res === DialogResult.Ok || res === 1 || (res && res.value === 1)) { const P = readMM(); const n = apply(P, true); keep(n, P); return n; }
  cancel(); return null;
}
if (typeof module !== 'undefined' && module.exports) module.exports = ochinShape;

globalThis.ochinShape = ochinShape;
