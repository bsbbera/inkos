// p4-5 · the dark room. One gesture across the gutter: the fold is the wall, the pinhole sits in it,
// a tree on the verso, its light crossing the hole and landing upside down on the recto.
const K = globalThis.OchinLib(globalThis.OCHIN), { T, C } = K;
K.clear(4);
K.ground(4, C.kajol); K.ground(5, C.kajol);

// geometry, spread mm: the tree, the hole, the wall it lands on (similar triangles, ratio 160/150)
const HOLE = [210, 175], TREE = { x: 60, top: 110, base: 225 }, WALLX = 370, k = (WALLX - HOLE[0]) / (HOLE[0] - TREE.x);
const img = (p) => [HOLE[0] + (HOLE[0] - p[0]) * k, HOLE[1] + (HOLE[1] - p[1]) * k];   // where a point of the tree lands
const A = img([TREE.x, TREE.top]), B = img([TREE.x, TREE.base]);

// the light: two cones of faint holud, then the rays as kantha
T.polyline(4, [[TREE.x, TREE.top], HOLE, [TREE.x, TREE.base]], { fill: C.holud, alpha: .1 });
T.polyline(4, [HOLE, A, B], { fill: C.holud, alpha: .13 });
K.kantha(4, [[TREE.x, TREE.top], HOLE, A], 'holud', 1.1, { dash: 2.6, gap: 1.6 });
K.kantha(4, [[TREE.x, TREE.base], HOLE, B], 'holud', 1.1, { dash: 2.6, gap: 1.6 });
// the wall: a mati band down the fold, broken by the hole
K.field(4, 207.5, -3, 5, HOLE[1] - 1.6 + 3, C.mati);
K.field(4, 207.5, HOLE[1] + 1.6, 5, 303 - HOLE[1], C.mati);
[[22, .08], [12, .16], [6, .9]].forEach(([d, a]) => T.circle(4, HOLE[0], HOLE[1], d, { fill: a > .5 ? C.shankha : C.holud, alpha: a }));

// the tree outside, in daylight colours; a small sun over it
// a canopy: a circle whose radius breathes with the angle (three and five lobes), the way a tree's crown is lumpy
const canopy = (cx, cy, r) => { const o = []; for (let i = 0; i < 72; i++) { const t = i / 72 * 2 * Math.PI, q = r * (1 + .09 * Math.sin(3 * t + .5) + .06 * Math.sin(5 * t + 2) + .03 * Math.sin(9 * t)); o.push([cx + q * Math.cos(t), cy + q * .92 * Math.sin(t)]); } return o; };
T.circle(4, 26, 100, 13, { fill: C.holud });
K.panel(4, K.rectPts(TREE.x - 3.5, 160, 7, TREE.base - 160), 'mati', { fgrain: .5 });
K.panel(4, canopy(TREE.x, 140, 29), 'kolapata', { fgrain: .6 });
K.bn(4, 'world', TREE.x, TREE.base + 4, C.holud, { align: 'centre' });

// the image on the wall: a glow with soft edges, the tree in it upside down, paler, bigger
const gx = WALLX - 44 - 210, gw = 88;
K.panel(5, K.rectPts(gx, B[1] - 12, gw, A[1] - B[1] + 24), 'holud', { fgrain: .3, fadeL: 14, fadeR: 14, fadeT: 14, fadeB: 14, opacity: .35 });
const flip = (pts) => pts.map((p) => { const q = img([p[0], p[1]]); return [q[0] - 210, q[1]]; });
K.panel(5, flip(K.rectPts(TREE.x - 3.5, 160, 7, TREE.base - 160)), 'shankha', { fgrain: .4, opacity: .75 });
K.panel(5, flip(canopy(TREE.x, 140, 29)), 'shankha', { fgrain: .5, opacity: .75, gcol: 'holud', gang: 90, gamt: .7 });
K.bn(5, 'image', WALLX - 210, A[1] + 6, C.holud, { align: 'centre' });
K.bn(4, 'hole', 186, HOLE[1] + 4, C.shankha);

// p4 head: a holud matra, the headline hanging from it
K.brand(4, 'matra', { x: 16, y: 20, w: 96, h: 3 }, { rule: 1.2, solid: 'holud', seed: 4 });
K.bn(4, 'eye', 16, 13.5, C.holud);
K.bn(4, 'head', 16, 22.6, C.shankha);
K.bn(4, 'deck', 16, 24 + K.size('head').h + 4, C.holud);
// the old engraving and the shoebox, top right of the verso, clear of the light
K.photo(4, 'camera-obscura.jpg', { x: 122, y: 18, w: 72, h: 46 }, { crop: [0, .06, 1, .94] });
K.bn(4, 'engCap', 122, 66.5, C.shankha, { alpha: .8 });
K.panel(4, [[122, 78], [194, 78], [194, 124], [128, 128]], 'neel', { fgrain: .4 });
K.bn(4, 'tryH', 127, 82, C.holud);
K.bn(4, 'try', 127, 90, C.shankha);
// three who saw it, down a thread
K.kantha(4, [[16, 247], [194, 247]], 'mati', .8, { dash: 1.6, gap: 1.6 });
[['p1h', 'p1d', 16], ['p2h', 'p2d', 78], ['p3h', 'p3d', 140]].forEach(([h, d, x]) => {
  T.circle(4, x + 2.5, 247, 5, { fill: C.sindur });
  K.bn(4, h, x, 252, C.shankha); K.bn(4, d, x, 260, C.shankha, { alpha: .8 });
});

// p5: the explanation above the light, the number below it
const L0 = 24;
K.bn(5, 'body1', L0, 22, C.shankha);
K.bn(5, 'body2', L0 + 86, 22, C.shankha);
K.bn(5, 'num', 20, 222, C.sindur);
K.bn(5, 'numCap', 20, 262, C.shankha);
K.folio(4, C.shankha); K.folio(5, C.shankha);
console.log('s02 ok', JSON.stringify({ A, B, b1: K.size('body1'), b2: K.size('body2') }));
