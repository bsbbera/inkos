// p12-13 · inside a piece of film. Verso: the colour negative's layers pulled apart on a padma field,
// three coloured rays each stopping at the layer that catches it. Recto: one grain's life in five
// states down a kantha thread, then Talbot's negative and the same picture turned back.
const K = globalThis.OchinLib(globalThis.OCHIN), { T, C } = K;
K.clear(12);
K.ground(12, C.padma); K.ground(13, C.shankha);

// ---- p12: the stack ------------------------------------------------------------------------
K.bn(12, 'eye', 16, 14, C.holud);
K.bn(12, 'head', 16, 20, C.shankha);
K.bn(12, 'deck', 16, 40, C.shankha, { alpha: .85 });
const X0 = 18, W = 84, DX = 30, DY = -16, TH = 5.5, Y0 = 92, STEP = 21;
const LAY = [['l1', C.shankha, .45], ['l2', C.neel, 1], ['l3', C.holud, 1], ['l4', C.kolapata, 1], ['l5', C.sindur, 1], ['l6', C.paper, .55], ['l7', C.kajol, 1]];
const shade = (hex, k) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * k).toString(16).padStart(2, '0')).join('');
// slabs from the bottom up, so each sits over the gap below it
for (let i = LAY.length - 1; i >= 0; i--) {
  const [id, col, a] = LAY[i], y = Y0 + i * STEP;
  T.polyline(12, [[X0, y], [X0 + W, y], [X0 + W, y + TH], [X0, y + TH]], { fill: shade(col, .82), alpha: a });
  T.polyline(12, [[X0 + W, y], [X0 + W + DX, y + DY], [X0 + W + DX, y + DY + TH], [X0 + W, y + TH]], { fill: shade(col, .65), alpha: a });
  T.polyline(12, [[X0, y], [X0 + W, y], [X0 + W + DX, y + DY], [X0 + DX, y + DY]], { fill: col, alpha: a });
  // its label, out to the right on a hairline
  T.rect(12, X0 + W + DX + 2, y + DY / 2 + 1.5, 136 - (X0 + W + DX), .3, { fill: C.shankha, alpha: .6 });
  K.bn(12, id, 140, y + DY / 2 - 1.6, C.shankha);
}
// light, in front: three rays falling through the stack, each ending on the top face of the layer that catches it
[[C.neel, 36, 1], [C.kolapata, 56, 3], [C.sindur, 76, 4]].forEach(([c, x, li]) => {
  const yEnd = Y0 + li * STEP + DY * .5;
  T.rect(12, x + DX * .5 - .9, 62, 1.8, yEnd - 62, { fill: c });
  T.circle(12, x + DX * .5, yEnd, 3.6, { fill: c });
});
K.bn(12, 'stackCap', 18, 246, C.shankha, { alpha: .8 });
K.panel(12, [[110, 240], [196, 236], [196, 278], [110, 278]], 'holud', { fgrain: .5 });
K.bn(12, 'colour', 116, 242, C.kajol);
K.folio(12, C.shankha);

// ---- p13: one grain's life ------------------------------------------------------------------
K.bn(13, 'pH', 20, 16, C.kajol);
const hex = (cx, cy, r) => { const p = []; for (let k = 0; k < 6; k++) { const t = Math.PI / 6 + k * Math.PI / 3; p.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]); } return p; };
const SX = (i) => 20 + i * 35.5, CY = 56;
K.kantha(13, [[SX(0) + 16, CY], [SX(4) + 16, CY]], 'mati', .8, { dash: 1.6, gap: 1.6 });
for (let i = 0; i < 5; i++) {
  const cx = SX(i) + 16;
  if (i === 3) {   // fixer: the exposed grain stays, the unexposed one washes out
    T.polyline(13, hex(cx - 5, CY + 3, 9), { fill: C.kajol });
    T.polyline(13, hex(cx + 7, CY - 6, 7), { fill: null, stroke: C.mati, weight: .6, strokeAlpha: .6 });
  } else if (i === 4) {
    K.photo(13, 'talbot-oriel.jpg', { x: cx - 13, y: CY - 11, w: 26, h: 22 }, {});
  } else {
    T.polyline(13, hex(cx, CY, 12), { fill: i === 2 ? C.kajol : C.paper, stroke: C.kajol, weight: .5 });
    if (i === 0) [[-12, -16], [-4, -19], [5, -18]].forEach(([dx, dy]) => { T.rect(13, cx + dx, CY + dy, .9, 9, { fill: C.holud, rot: -20 }); T.circle(13, cx + dx + 2, CY + dy + 9, 1.6, { fill: C.holud }); });
    if (i === 1) [[-1, -1], [1.4, -.4], [0, 1.4], [1.6, 1.8]].forEach(([dx, dy]) => T.circle(13, cx + dx, CY + dy, 1.5, { fill: C.kajol }));
  }
  K.bn(13, 's' + (i + 1) + 'h', SX(i), CY + 18, C.sindur);
  K.bn(13, 's' + (i + 1), SX(i), CY + 26, C.kajol);
}
// the word, the gelatin
K.panel(13, [[20, 128], [102, 128], [98, 172], [20, 172]], 'neel', { fgrain: .4 });
K.bn(13, 'wH', 26, 131, C.holud);
K.bn(13, 'wB', 26, 140, C.shankha);
K.panel(13, K.rectPts(112, 128, 82, 44), 'paper', { fgrain: .6, profile: 1, depth: 1.2, pitch: 7 });
K.bn(13, 'gH', 118, 132, C.sindur);
K.bn(13, 'g', 118, 140, C.kajol);
// negative and positive: the same window, turned back
const D = 66, PY = 186;
T.circle(13, 54, PY + D / 2, D + 5, { fill: C.kajol });
K.photo(13, 'talbot-oriel.jpg', { x: 54 - D / 2, y: PY, w: D, h: D }, { clip: 'circle', crop: [.08, 0, .84, 1] });
T.circle(13, 158, PY + D / 2, D + 5, { fill: C.holud });
K.photo(13, 'talbot-positive.jpg', { x: 158 - D / 2, y: PY, w: D, h: D }, { clip: 'circle', crop: [.08, 0, .84, 1] });
K.kantha(13, [[92, PY + D / 2], [120, PY + D / 2]], 'sindur', 1.2, { ends: 1.6, endcol: 'sindur' });
K.bn(13, 'negL', 54, PY + D + 6, C.kajol, { align: 'centre' });
K.bn(13, 'posL', 158, PY + D + 6, C.kajol, { align: 'centre' });
K.folio(13, C.kajol);
console.log('s06 ok');
