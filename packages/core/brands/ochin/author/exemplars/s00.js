// p1 · cover: a lens on a neel night. The first photograph inside it, the alpana opening around it
// like an aperture, the bird on its rim, the lal paar across the head.
const K = globalThis.OchinLib(globalThis.OCHIN), { T, C } = K, P = 1;
K.clear(P);
K.ground(P, C.neel);
// the light entering: a holud beam from the outer edge into the lens, fading as it goes
T.beam(P, -4, 70, 31, 165, 5, 74, C.shankha, { alpha: .3, alphaEnd: 0, blend: T.BlendMode.Normal });
// the head: lal paar, then the masthead
K.brand(P, 'lalpaar', { x: -3, y: -3, w: 216, h: 24 }, { solid: 'sindur', ink: 'shankha', toff: 7, tstyle: 2, weight: 1, seed: 1826 });
K.bn(P, 'mast', 13, 24, C.shankha);
K.bn(P, 'issue', 196, 33, C.holud, { align: 'right' });
K.en(P, 120, 39, 76, 6, 'Writing with light · Issue 01', { size: 8.5, colour: C.shankha, align: 'Right', ital: true });
// the lens: an alpana opening behind it, the first photograph inside, a sindur rim
const L = { cx: 128, cy: 150, d: 104 }, H = 110;   // the alpana's petals run 0.18-0.72 of H: they open beyond the rim
K.brand(P, 'alpana', { x: L.cx - H, y: L.cy - H, w: 2 * H, h: 2 * H }, { apet: 2, aform: 1, aring: 2, ainner: 1, solid: 'holud', ink: 'shankha', seed: 21 });
T.circle(P, L.cx, L.cy, L.d + 7, { fill: C.sindur });
T.circle(P, L.cx, L.cy, L.d + 2, { fill: C.kajol });
K.photo(P, 'niepce-le-gras.jpg', { x: L.cx - L.d / 2, y: L.cy - L.d / 2, w: L.d, h: L.d }, { clip: 'circle', crop: [.2, .02, .62, .9] });
// the bird on the rim, looking in
// feet (board units 62-72 across, 92 down) on the rim, between two petals
const a = -67.5 * Math.PI / 180, fx = L.cx + (L.d / 2 + 3.5) * Math.cos(a), fy = L.cy + (L.d / 2 + 3.5) * Math.sin(a);
K.brand(P, 'bird', { x: fx - 22, y: fy - 92 * 40 / 120, w: 40, h: 34 }, { flip: 1, body: 'kajol', wing: 'holud', beak: 'holud', wstitch: 'shankha', seed: 5 });
// the title and the deck
K.bn(P, 'title', 14, 232, C.shankha);
K.bn(P, 'deck', 14, 258, C.shankha, { alpha: .88 });
// three teasers on a kajol band, a holud thread along its top
K.panel(P, K.rectPts(-3, 276, 216, 24), 'kajol', { fgrain: .4 });
K.kantha(P, [[0, 279], [210, 279]], 'holud', .8, { dash: 2, gap: 1.4 });
[['t1n', 't1', 14], ['t2n', 't2', 80], ['t3n', 't3', 146]].forEach(([n, t, x]) => {
  K.bn(P, n, x, 281, C.holud);
  K.bn(P, t, x + K.size(n).w + 3, 284.5, C.shankha);
});
console.log('s00 ok');
