// Ochin · the kit every spread script draws with (Quire builds). Ported from the Ochin 01 build
// (Output/Brand/ochin-01/build/lib.js): same calls, same numbers, so Ochin 01's spread scripts are
// the examples a designer learns from. Loaded after tk.js and the brand shape kit (G, ochinShape,
// OchinShapes), with globalThis.TK_DOC already found.
//   R = globalThis.OCHIN = { texts, img, tiles, title }
//   texts[id] = shaped text block: { pt, lead, w, h, face, lines: [{ d?, w, y }], latin?, runs? }
// Usage (a spread script): const K = globalThis.OchinLib(globalThis.OCHIN), { T, C } = K;
globalThis.OchinLib = function (R) {
  const { CurveBuilder, PolyCurve, Transform } = require('/geometry');
  const { PolyCurveNodeDefinition, ImageNodeDefinition, NodeChildType } = require('/nodes');
  const { DocumentCommand, NodeMoveType } = require('/commands');
  const { Selection } = require('/selections');
  const { Bitmap } = require('/rasterobject');
  const { BlendMode } = require('/fills');

  const doc = globalThis.TK_DOC;
  if (!doc) throw new Error('build document not found');
  const T = globalThis.TK, { MM, PT } = T;
  const G = globalThis.G, shape = globalThis.ochinShape, BN = R.texts || {};
  const S = globalThis.OchinShapes ? globalThis.OchinShapes(G) : null;

  // what the script placed, for the checks after it runs (page mm)
  const placed = globalThis.OCHIN_PLACED = { text: [], photo: [], cleared: [] };

  // ---- brand -------------------------------------------------------------------------------
  const C = { shankha: '#F6EEDC', kajol: '#1E1A1D', sindur: '#D23A1E', holud: '#EBA417', neel: '#27357A',
    kolapata: '#2F7D46', shapla: '#E07A9A', padma: '#12807E', mati: '#A9502B', paper: '#EDE2CA' };
  const IX = { shankha: 0, kajol: 1, sindur: 2, holud: 3, neel: 4, kolapata: 5, shapla: 6, padma: 7, mati: 8, paper: 9 };
  const TILES = { tiles: Object.fromEntries(Object.values(C).map((h) => [h.toLowerCase(), R.tiles + h.slice(1).toLowerCase() + '.png'])), mm: 43 };
  const FAM = { head: 'Tiro Bangla', text: 'Anek Bangla', mark: 'Galada', greek: 'Georgia' };
  const hex = (c) => (C[c] || c);

  function clear(P) {
    const s = T.useSpread(P);
    for (const n of s.layers.toArray()) n.delete();
    placed.cleared.push(P);
  }

  // ---- grounds ------------------------------------------------------------------------------
  function field(P, x, y, w, h, colour, o) { const c = hex(colour), n = T.rect(P, x, y, w, h, Object.assign({ fill: c }, o || {})); T.texture(n, c, TILES); return n; }
  const ground = (P, colour) => field(P, -3, -3, 216, 303, colour);
  function cut(P, pts, colour, o) { const c = hex(colour), n = T.polyline(P, pts, Object.assign({ fill: c }, o || {})); T.texture(n, c, TILES); return n; }

  // ---- text blocks (shaped before the script runs; see texts) -------------------------------
  const blk = (id) => { const b = BN[id]; if (!b) throw new Error('no text block named "' + id + '"'); return b; };
  const BASE = (id) => blk(id).pt * 25.4 / 72 * .78;
  // w = the block's width (the widest line for a one-liner), h = its height, lead = line pitch, all mm
  const size = (id) => { const b = blk(id); return { w: b.w, h: b.h || b.pt * 25.4 / 72 * 1.25, lead: b.lead || b.pt * 25.4 / 72 * 1.25, lines: b.lines.length }; };
  // draw a block: x = left edge (align right: right edge; centre: centre), top = top of its first line.
  // English is live text set exactly where it was measured; Bengali is drawn as outlines.
  function bn(P, id, x, top, colour, o) {
    o = o || {}; const b = blk(id), sz = size(id);
    const x0 = o.align === 'right' ? x - b.w : o.align === 'centre' ? x - b.w / 2 : x;
    const entry = { id, P, x: x0, y: top, w: b.w, h: sz.h };
    placed.text.push(entry);
    if (b.latin) {
      const al = o.align === 'right' ? 'Right' : o.align === 'centre' ? 'Centre' : (b.align || 'Left');
      const runs = [];
      b.runs.forEach((r, i) => {
        if (i) runs.push({ br: true }, { pa: { space: r.para || 0 } });
        runs.push({ t: r.t, fam: b.fam, size: b.pt, color: hex(colour), alpha: o.alpha, ital: b.ital, caps: b.caps, track: b.track || 0, face: b.trait });
      });
      // a hair wider than measured so Affinity breaks the lines where they were measured, a line taller for descenders
      // a one-line block never wraps: its frame gets room (Affinity tracks caps wider than measured, and an accented
      // capital like the É of NIÉPCE stands above the measured line), kept on its alignment
      const one = b.lines.length === 1, extra = one ? b.w * .5 + 8 : 1.2;
      const fx = al === 'Right' ? x0 - extra + 1 : al === 'Centre' ? x0 - extra / 2 : x0 - .2;
      const n = T.text(P, fx, top - b.pt * 25.4 / 72 * .12, b.w + extra, sz.h + sz.lead * (one ? 2 : 1), runs, { align: al, lead: b.leadPt, tag: 'tx-' + id });
      try { entry.over = T.overflows(n); } catch (e) { /* measured after the run instead */ }
      return n;
    }
    const g = T.pg(P), y0 = top + BASE(id);
    const pc = PolyCurve.create();
    for (const l of b.lines) {
      const t = l.d.match(/[MCLZ]|-?[\d.]+/g) || []; let i = 0, cb = null; const n = () => +t[i++];
      const X = (v) => MM(g.ox + x0 + v), Y = (v) => MM(y0 + l.y + v);   // a line's own alignment is in its outline
      while (i < t.length) {
        const c = t[i++];
        if (c === 'M') { if (cb) pc.addCurve(cb.createCurve()); cb = CurveBuilder.create(); cb.beginXY(X(n()), Y(n())); }
        else if (c === 'L') cb.lineToXY(X(n()), Y(n()));
        else if (c === 'C') cb.addBezierXY(X(n()), Y(n()), X(n()), Y(n()), X(n()), Y(n()));
        else if (c === 'Z') cb.close();
      }
      if (cb) pc.addCurve(cb.createCurve());
    }
    const d = PolyCurveNodeDefinition.createDefault(); d.setCurves(pc);
    const node = T.add(P, d, 'bn-' + id);
    T.paint(node, T.col(colour, o.alpha), null);
    return node;
  }
  const tx = bn;

  // a short Latin line that is not in the copy (a running head, a credit): live text, measured by Affinity
  function en(P, x, y, w, h, t, o) {
    o = o || {};
    return T.text(P, x, y, w, h, [{ t, fam: o.fam || FAM.head, size: o.size || 10, color: o.colour || C.kajol, ital: o.ital, caps: o.caps, track: o.track || 0, face: o.face }],
      { align: o.align || 'Left', lead: o.lead || (o.size || 10) * 1.25 });
  }

  // ---- photographs --------------------------------------------------------------------------
  // a picture cut to a shape: clip = 'rect' (default), 'circle', or a point list (page mm).
  // crop = [sx, sy, sw, sh], the part of the picture (fractions) that must fill the box.
  function photo(P, file, box, o) {
    o = o || {}; const g = T.pg(P);
    const bmp = Bitmap.loadFromFile(R.img + file), d = ImageNodeDefinition.create(bmp); d.setBitmap(bmp);
    const n = T.add(P, d, 'pic-' + file), b = n.getSpreadBaseBox(false);
    const [sx, sy, sw, sh] = o.crop || [0, 0, 1, 1], cw = b.width * sw, ch = b.height * sh;
    const s = Math.max(MM(box.w) / cw, MM(box.h) / ch);
    const wx = b.x + b.width * sx + cw / 2, wy = b.y + b.height * sy + ch / 2;
    doc.applyTransform(Transform.createTranslate(MM(g.ox + box.x + box.w / 2), MM(box.y + box.h / 2)).multiply(Transform.createScale(s, o.flipY ? -s : s)).multiply(Transform.createTranslate(-wx, -wy)), n);
    let frame;
    if (o.clip === 'circle') frame = T.circle(P, box.x + box.w / 2, box.y + box.h / 2, Math.min(box.w, box.h), { fill: null });
    else if (Array.isArray(o.clip)) frame = T.polyline(P, o.clip, { fill: null });
    else frame = T.rect(P, box.x, box.y, box.w, box.h, { fill: null });
    frame.userDescription = 'photo-' + file;
    doc.executeCommand(DocumentCommand.createMoveNodes(Selection.create(doc, n), frame, NodeMoveType.Inside, NodeChildType.Main));
    if (o.opacity !== undefined) doc.executeCommand(DocumentCommand.createSetOpacity(Selection.create(doc, frame), o.opacity));
    if (o.tone) {
      const k = T.rect(P, box.x - 2, box.y - 2, box.w + 4, box.h + 4, { fill: hex(o.tone), blend: BlendMode.Colour });
      doc.executeCommand(DocumentCommand.createMoveNodes(Selection.create(doc, k), frame, NodeMoveType.Inside, NodeChildType.Main));
    }
    placed.photo.push({ file, P, x: box.x, y: box.y, w: box.w, h: box.h });
    return frame;
  }

  // ---- brand shapes (Ochin Shape), page mm in, spread mm to the tool -------------------------
  const ox = (P) => T.pg(P).ox;
  const sbox = (P, b) => ({ x: b.x + ox(P), y: b.y, w: b.w, h: b.h });
  const ix = (v) => (typeof v === 'string' ? IX[v] : v);
  const colours = (p) => { const q = Object.assign({}, p); for (const k of ['ink', 'solid', 'pfill', 'endcol', 'body', 'wing', 'beak', 'eye', 'pupil', 'wstitch', 'pcol', 'gcol', 'tone2']) if (k in q) q[k] = ix(q[k]); return q; };
  const ochin = (P, anchor, params) => shape({ doc, G, parent: T.useSpread(P), anchor, params: colours(params) });
  const brand = (P, kind, b, params) => ochin(P, { box: sbox(P, b) }, Object.assign({ kind }, params || {}));
  function kantha(P, pts, colour, wPt, params) {
    const q = pts.map((p) => [p[0] + ox(P), p[1]]), xs = q.map((p) => p[0]), ys = q.map((p) => p[1]);
    const box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs) || .1, h: Math.max(...ys) - Math.min(...ys) || .1 };
    return ochin(P, { box, pts: q }, Object.assign({ kind: 'stitch', ink: colour, weight: wPt || .9, dash: 2.4, gap: 1.6, seed: 31 }, params || {}));
  }
  function panel(P, pts, colour, params) {
    const n = T.polyline(P, pts, { fill: hex(colour) });
    return shape({ doc, G, target: n, params: colours(Object.assign({ kind: 'panel', pfill: colour, fdpi: 200, fgrain: .5 }, params || {})) });
  }
  const rectPts = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  function blobPts(pts, n) {
    const out = [], N = pts.length;
    for (let i = 0; i < N; i++) for (let k = 0; k < (n || 8); k++) {
      const p0 = pts[(i - 1 + N) % N], p1 = pts[i], p2 = pts[(i + 1) % N], p3 = pts[(i + 2) % N], t = k / (n || 8), t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map((j) => .5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3)));
    }
    return out;
  }

  // ---- navigation: the folio and the running head, same corner every page --------------------
  function folio(P, colour, o) {
    o = o || {}; const g = T.pg(P), right = g.recto;
    const digits = String(P).replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[d]);
    const head = 'Ochin · ' + (R.title || '');
    const t = right ? head + '     ' + digits : digits + '     ' + head;
    placed.text.push({ id: 'folio', P, x: right ? 116 : 14, y: 284.5, w: 80, h: 4 });
    en(P, right ? 116 : 14, 284.5, 80, 6, t, { fam: FAM.text, size: 7.5, colour: hex(colour || C.kajol), align: right ? 'Right' : 'Left', face: 'Regular' });
  }

  return { doc, T, MM, PT, G, S, BN, C, IX, FAM, clear, field, ground, cut, bn, tx, size, en, photo, brand, kantha, panel, rectPts, blobPts, folio, ochin, ox };
};
