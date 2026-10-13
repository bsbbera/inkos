// p6-7 · the first photographs. Paper, two pictures bleeding off the head, a magnifier on the first
// person ever photographed, and the race told as one log-scale ruler across the recto's foot.
const K = globalThis.OchinLib(globalThis.OCHIN), { T, C } = K;
K.clear(6);
K.ground(6, C.shankha); K.ground(7, C.paper);

// ---- p6 ---------------------------------------------------------------------------------
K.photo(6, 'niepce-le-gras.jpg', { x: -3, y: -3, w: 216, h: 118 }, { crop: [0, .1, 1, .787] });
K.bn(6, 'cap1', 16, 118, C.mati);
K.brand(6, 'matra', { x: 16, y: 130, w: 178, h: 3 }, { rule: 1.4, rstyle: 1, solid: 'kajol', seed: 6 });
K.bn(6, 'head', 16, 132.5, C.kajol);
K.bn(6, 'deck', 16, 154, C.mati);
K.bn(6, 'y1', 16, 180, C.sindur);
K.bn(6, 'n1', 16, 198, C.kajol);
K.bn(6, 'b1', 16, 212, C.kajol);
// the fact, drawn: the sun crossing over the house, lighting both its sides
const fx = 112, fy = 186;
K.panel(6, [[fx, fy], [194, fy], [194, 268], [fx + 6, 268]], 'holud', { fgrain: .5 });
K.bn(6, 'f1h', fx + 8, fy + 5, C.sindur);
T.polyline(6, [[fx + 30, fy + 44], [fx + 30, fy + 34], [fx + 40, fy + 26], [fx + 50, fy + 34], [fx + 50, fy + 44]], { fill: C.kajol });
K.kantha(6, (() => { const a = []; for (let i = 0; i <= 20; i++) { const t = Math.PI * (1 - i / 20); a.push([fx + 40 + 30 * Math.cos(t), fy + 40 - 26 * Math.sin(t)]); } return a; })(), 'sindur', .8, { dash: 1.4, gap: 1.2 });
[[fx + 10, fy + 40], [fx + 40, fy + 14], [fx + 70, fy + 40]].forEach((p, i) => T.circle(6, p[0], p[1], i === 1 ? 7 : 5.5, { fill: C.sindur, alpha: i === 1 ? 1 : .7 }));
K.bn(6, 'f1', fx + 8, fy + 50, C.kajol);
K.folio(6, C.kajol);

// ---- p7 ---------------------------------------------------------------------------------
const D = { x: 70, y: -3, w: 143, h: 103 };
K.photo(7, 'daguerre-boulevard.jpg', D, { crop: [0, 0, 1, 1] });
K.bn(7, 'cap2', 70, 102, C.mati, { alpha: .9 });
// the magnifier on the bootblack (lower left of the plate)
const spot = [D.x + .203 * D.w, D.y + .776 * D.h], M = { cx: 40, cy: 50, d: 48 };
K.kantha(7, [[M.cx + M.d / 2 - 2, M.cy + 6], spot], 'sindur', .9, { dash: 1.4, gap: 1.2, ends: 1.2, endcol: 'sindur' });
T.circle(7, M.cx, M.cy, M.d + 5, { fill: C.sindur });
K.photo(7, 'daguerre-boulevard.jpg', { x: M.cx - M.d / 2, y: M.cy - M.d / 2, w: M.d, h: M.d }, { clip: 'circle', crop: [.168, .735, .07, .097] });
T.ring(7, spot[0], spot[1], 9, { stroke: C.sindur, weight: 1.6 });
K.bn(7, 'zoom', M.cx, M.cy + M.d / 2 + 5, C.sindur, { align: 'centre' });
K.bn(7, 'y2', 20, 108, C.sindur);
K.bn(7, 'n2', 20 + K.size('y2').w + 4, 112, C.kajol);
K.bn(7, 'b2', 20, 128, C.kajol);
// Talbot: the negative, small, with its own label
K.photo(7, 'talbot-oriel.jpg', { x: 112, y: 108, w: 50, h: 42.7 }, {});
K.bn(7, 'cap3', 112, 152, C.mati);
K.bn(7, 'y3', 112, 163, C.neel);
K.bn(7, 'n3', 112 + K.size('y3').w + 3, 167, C.kajol);
K.bn(7, 'b3', 112, 180, C.kajol);

// the race as a ruler: log10(seconds), 3 days on the left to 1/4000 s on the right
const X0 = 20, X1 = 194, L0 = Math.log10(3 * 86400), L1 = Math.log10(1 / 4000);
const X = (sec) => X0 + (X1 - X0) * (L0 - Math.log10(sec)) / (L0 - L1), ry = 252;
K.panel(7, K.rectPts(-3, 227, 216, 73), 'kajol', { fgrain: .4 });
K.bn(7, 'chH', 20, 230, C.holud);
K.bn(7, 'chS', 20, 237.5, C.shankha, { alpha: .7 });
T.rect(7, X0, ry, X1 - X0, .5, { fill: C.shankha });
[['aD', 86400], ['aH', 3600], ['aM', 60], ['aS', 1], ['aMs', .001]].forEach(([id, sec]) => {
  T.rect(7, X(sec) - .25, ry - 2.5, .5, 5, { fill: C.shankha });
  K.bn(7, id, X(sec), ry - 7.5, C.shankha, { align: sec < .01 ? 'right' : 'centre', alpha: .85 });
});
// each range a thick stitched bar of its own colour, with its line beneath
[['r1', 8 * 3600, 3 * 86400, 'sindur', 258.5], ['r2', 180, 900, 'holud', 266], ['r3', 1 / 4000, 1 / 1000, 'padma', 273.5]].forEach(([id, a, b, col, y]) => {
  T.rect(7, X(b), y, Math.max(2, X(a) - X(b)), 3.2, { fill: C[col] });
  T.rect(7, X(b), ry - 1.6, Math.max(2, X(a) - X(b)), 3.2, { fill: C[col], alpha: .9 });
  const left = X(b) < 120;
  K.bn(7, id, left ? X(a) + 3 : X(b) - 3, y - 1.4, C.shankha, left ? {} : { align: 'right' });
});
K.folio(7, C.shankha);
console.log('s03 ok');
