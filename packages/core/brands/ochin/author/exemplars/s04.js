// p8-9 · people of light. The verso is cyanotype blue (Atkins' own colour); the recto is paper with
// Cameron's Herschel running off the head and a colour corner below: three lights making every colour.
const K = globalThis.OchinLib(globalThis.OCHIN), { T, C } = K;
K.clear(8);
K.ground(8, C.neel); K.ground(9, C.shankha);

// ---- p8 ---------------------------------------------------------------------------------
K.bn(8, 'eye', 16, 15, C.holud);
K.bn(8, 'head', 16, 21, C.shankha);
K.bn(8, 'deck', 16, 43, C.holud);
// Cornelius in an arch, as a daguerreotype case would hold him
const arch = (x, y, w, h) => { const a = []; for (let k = 0; k <= 24; k++) { const t = Math.PI * (1 - k / 24); a.push([x + w / 2 + w / 2 * Math.cos(t), y + w / 2 - w / 2 * Math.sin(t)]); } return [...a, [x + w, y + h], [x, y + h]]; };
const A1 = { x: 16, y: 62, w: 82, h: 110 };
K.panel(8, arch(A1.x - 3, A1.y - 3, A1.w + 6, A1.h + 6), 'holud', { fgrain: .4 });
K.photo(8, 'cornelius.jpg', A1, { clip: arch(A1.x, A1.y, A1.w, A1.h), crop: [.06, .04, .88, .86] });
K.bn(8, 'y1', 108, 62, C.holud);
K.bn(8, 'n1', 108, 76, C.shankha);
K.bn(8, 'b1', 108, 86, C.shankha, { alpha: .92 });
// Atkins: her algae on a lean, the word box under her
const A2 = { x: 118, y: 150, w: 74, h: 101 };
K.panel(8, [[A2.x - 4, A2.y - 4], [A2.x + A2.w + 6, A2.y - 8], [A2.x + A2.w + 4, A2.y + A2.h + 4], [A2.x - 6, A2.y + A2.h + 6]], 'shankha', { fgrain: .3 });
K.photo(8, 'atkins-algae.jpg', A2, { crop: [.02, .02, .96, .96] });
K.bn(8, 'y2', 16, 182, C.holud);
K.bn(8, 'n2', 16, 196, C.shankha);
K.bn(8, 'b2', 16, 206, C.shankha, { alpha: .92 });
K.panel(8, [[-3, 246], [104, 246], [110, 278], [-3, 278]], 'shankha', { fgrain: .4 });
K.bn(8, 'wH', 16, 249, C.neel);
K.bn(8, 'wB', 16, 257, C.kajol);
K.folio(8, C.shankha);

// ---- p9 ---------------------------------------------------------------------------------
K.photo(9, 'cameron-herschel.jpg', { x: 94, y: -3, w: 119, h: 152 }, { crop: [0, 0, 1, .92] });
K.bn(9, 'y3', 20, 20, C.sindur);
K.bn(9, 'n3', 20, 34, C.kajol);
K.bn(9, 'b3', 20, 46, C.kajol);
// a kantha thread from her text into the photograph: Calcutta to the Isle of Wight
K.kantha(9, [[20, 112], [60, 118], [92, 112]], 'sindur', .8, { ends: 1.3, endcol: 'sindur' });
// the colour corner: three lights over each other, then the two pictures that did it first
K.brand(9, 'matra', { x: 20, y: 160, w: 120, h: 3 }, { rule: .9, solid: 'kajol', seed: 2 });
K.bn(9, 'cH', 20, 164, C.kajol);
const rgb = [['sindur', 158, 172], ['kolapata', 170, 172], ['neel', 164, 162]];
// additive light only shows on black: a kajol disc, the three lights screened over it
T.circle(9, 167, 168, 44, { fill: C.kajol });
rgb.forEach(([c, x, y]) => T.circle(9, x + 3, y, 18, { fill: C[c], blend: K.T.BlendMode.Screen }));
K.bn(9, 'rgb', 140, 178, C.kajol, { align: 'right' });
K.photo(9, 'maxwell-tartan.jpg', { x: 20, y: 192, w: 84, h: 44 }, { crop: [0, .12, 1, .64] });
K.photo(9, 'gorskii-emir.jpg', { x: 110, y: 192, w: 84, h: 44 }, { crop: [.18, .18, .64, .41] });
K.bn(9, 'y4', 20, 239, C.sindur); K.bn(9, 'b4', 20, 251, C.kajol);
K.bn(9, 'y5', 110, 239, C.neel); K.bn(9, 'b5', 110, 251, C.kajol);
K.folio(9, C.kajol);
console.log('s04 ok', JSON.stringify({ b4: K.size('b4'), b5: K.size('b5'), b2: K.size('b2') }));
