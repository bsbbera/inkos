// p14-15 · grain and pixel, facing each other. The top of the spread is one picture of light seen two
// ways, meeting at the fold: random silver grains on the verso, the sensor's ordered red-green-blue
// squares on the recto. Below: warm paper for film, neel for the sensor.
const K = globalThis.OchinLib(globalThis.OCHIN), { T, C } = K;
K.clear(14);
K.ground(14, C.paper); K.ground(15, C.neel);
const HY = 128;   // the hero's foot

// ---- the hero ---------------------------------------------------------------------------------
K.photo(14, 'grain-field.png', { x: -3, y: -3, w: 213, h: HY + 3 }, {});
T.rect(15, -0.2, -3, 213.2, HY + 3, { fill: C.kajol });
const S = 8.6, G = .8;
for (let r = 0; r * (S + G) < HY + 3; r++) for (let c = 0; c * (S + G) < 213; c++) {
  const x = .4 + c * (S + G), y = -3 + r * (S + G), u = c / 23, v = r / 14;
  const light = Math.max(.25, Math.min(1, .3 + .75 * u * (.6 + .4 * Math.sin(v * 3.1))));   // the same light as the grain field, mirrored
  const col = r % 2 === 0 ? (c % 2 === 0 ? C.kolapata : C.sindur) : (c % 2 === 0 ? C.neel : C.kolapata);
  T.rect(15, x, y, S, Math.min(S, HY - y), { fill: col, alpha: light });
}
// the two words, each on its own clear card
K.panel(14, [[12, 84], [82, 84], [90, 122], [12, 122]], 'shankha', { fgrain: .3 });
K.bn(14, 'big1', 18, 82, C.sindur);
K.bn(14, 'sub1', 18, 116, C.mati);
K.panel(15, [[118, 84], [198, 84], [198, 122], [112, 122]], 'kajol', { fgrain: .3 });
K.bn(15, 'big2', 192, 82, C.holud, { align: 'right' });
K.bn(15, 'sub2', 192, 116, C.shankha, { align: 'right', alpha: .8 });

// a curve in a box: how bright the picture gets as the light rises (shape, not measured)
function curve(P, x, y, w, h, pts, ink, axis) {
  T.rect(P, x, y + h, w, .4, { fill: axis }); T.rect(P, x, y, .4, h, { fill: axis });
  T.smooth(P, pts.map(([u, v]) => [x + u * w, y + h - v * h]), { stroke: ink, weight: 2.4 });
  K.bn(P, 'ax', x + w, y + h + 2, axis, { align: 'right' });
}

// ---- p14 · film -------------------------------------------------------------------------------
K.bn(14, 'eye', 16, 136, C.sindur);
K.bn(14, 'head', 16, 142, C.kajol);
K.bn(14, 'b1', 16, 166, C.kajol);
curve(14, 116, 168, 74, 44, [[0, 0], [.15, .03], [.3, .15], [.5, .45], [.7, .76], [.85, .91], [1, .96]], C.sindur, C.kajol);
K.bn(14, 'ay', 116, 162, C.kajol, { alpha: .7 });
K.bn(14, 'cH1', 112, 222, C.sindur);
K.bn(14, 'c1', 112, 230, C.kajol);
K.bn(14, 'shape', 112, 252, C.mati);
// halation: a street lamp with its red ring
K.panel(14, [[16, 230], [104, 228], [104, 279], [16, 279]], 'kajol', { fgrain: .4 });
[[24, .18], [16, .32], [9, .55]].forEach(([d, a]) => T.circle(14, 90, 242, d, { fill: C.sindur, alpha: a }));
T.circle(14, 90, 242, 5, { fill: C.shankha });
K.bn(14, 'hH', 22, 233, C.holud);
K.bn(14, 'h', 22, 242, C.shankha);
K.folio(14, C.kajol);

// ---- p15 · sensor -----------------------------------------------------------------------------
K.bn(15, 'b2', 24, 140, C.shankha);
curve(15, 116, 142, 74, 44, [[0, 0], [.31, .5], [.6, .97], [.62, 1], [.8, 1], [1, 1]], C.holud, C.shankha);
K.bn(15, 'ay', 116, 136, C.shankha, { alpha: .7 });
K.bn(15, 'cH2', 112, 196, C.holud);
K.bn(15, 'c2', 112, 204, C.shankha);
// the summary, two columns down a kantha rule
K.bn(15, 'fH', 24, 224, C.holud); K.bn(15, 'dH', 112, 224, C.holud);
[['t1a', 't1b'], ['t2a', 't2b'], ['t3a', 't3b']].forEach(([a, b], i) => {
  const y = 232 + i * 14;
  K.kantha(15, [[24, y - 2], [194, y - 2]], 'shankha', .5, { dash: 1, gap: 1.4, opacity: .5 });
  K.bn(15, a, 24, y, C.shankha); K.bn(15, b, 112, y, C.shankha);
});
K.folio(15, C.shankha);
console.log('s07 ok', JSON.stringify({ b1: K.size('b1'), b2: K.size('b2'), h: K.size('h') }));
