// p2 contents (paper, ten stops down a kantha thread, four round windows on the outer edge)
// p3 the editor's letter (a holud flood, a rosette of light in the corner, the word box)
const K = globalThis.OchinLib(globalThis.OCHIN), { T, C } = K;
K.clear(2);

// ---- p2 ---------------------------------------------------------------------------------
K.ground(2, C.shankha);
K.bn(2, 'cHead', 16, 18, C.kajol);
K.bn(2, 'cDeck', 16, 36, C.mati);
// ten stops on one thread: the thread runs down the number column
const top = 58, step = 20.5;
K.kantha(2, [[27, top - 4], [27, top + 9 * step + 12]], 'sindur', .8, { dash: 1.6, gap: 1.4 });
for (let i = 0; i < 10; i++) {
  const y = top + i * step;
  T.circle(2, 27, y + 4.5, 15, { fill: i % 3 === 1 ? C.neel : i % 3 === 2 ? C.padma : C.sindur });
  K.bn(2, 'n' + i, 27, y - 1.6, C.shankha, { align: 'centre' });
  K.bn(2, 't' + i, 40, y - 1.2, C.kajol);
  K.bn(2, 'd' + i, 40, y + 6.6, C.mati);
}
// four windows down the outer edge, each a different decade of light
const W = [['earthrise.jpg', [.3, .14, .62, .64]], ['gorskii-emir.jpg', [.3, .02, .42, .5]], ['muybridge-horse.jpg', [.272, .075, .2, .25]], ['cameron-herschel.jpg', [.12, .08, .76, .6]]];
W.forEach(([f, crop], i) => {
  const cy = 72 + i * 50;
  T.circle(2, 160, cy, 47, { fill: [C.holud, C.shapla, C.sindur, C.padma][i] });
  K.photo(2, f, { x: 160 - 21.5, y: cy - 21.5, w: 43, h: 43 }, { clip: 'circle', crop });
});
K.bn(2, 'imprint', 16, 268, C.kajol, { alpha: .75 });
K.folio(2, C.kajol);

// ---- p3 ---------------------------------------------------------------------------------
K.ground(3, C.holud);
// light breaking into the corner: a rosette, half off the trim
K.brand(3, 'alpona', { x: 136, y: -64, w: 128, h: 128 }, { sym: 2, rings: 3, ink: 'shankha', solid: 'shankha', weight: .7, seed: 14, opacity: .9 });
K.bn(3, 'eEye', 20, 22, C.sindur);
K.bn(3, 'eHead', 20, 30, C.kajol);
K.brand(3, 'matra', { x: 20, y: 64, w: 84, h: 4 }, { rule: 1.1, rstyle: 2, solid: 'sindur', seed: 3 });
K.bn(3, 'eBody', 20, 74, C.kajol);
const eb = K.size('eBody');
K.bn(3, 'eSign', 20, 80 + eb.h, C.kajol);
// the bird, landing: its flight a kantha thread out of the word box's arch
K.kantha(3, [[118, 90], [109, 128], [107, 176], [97, 214], [78, 236]], 'sindur', .9, { dash: 1.8, gap: 2.2 });
K.brand(3, 'bird', { x: 18, y: 214, w: 58, h: 48 }, { body: 'kajol', wing: 'neel', beak: 'sindur', wstitch: 'shankha', perch: 1, pcol: 'sindur', seed: 9 });
// the word box: an arch-topped neel panel, the Greek set large in it
const bx = 116, by = 120, bw = 78, bh = 130;
const arch = []; for (let k = 0; k <= 24; k++) { const t = Math.PI * (1 - k / 24); arch.push([bx + bw / 2 + bw / 2 * Math.cos(t), by + 30 - 34 * Math.sin(t)]); }
K.panel(3, [...arch, [bx + bw, by + bh], [bx, by + bh]], 'neel', { fgrain: .4 });
K.en(3, bx + 6, by + 22, 34, 14, 'φῶς', { fam: K.FAM.greek, size: 30, colour: C.holud });
K.bn(3, 'wPhos', bx + 7, by + 38, C.shankha);
K.en(3, bx + 38, by + 22, 40, 14, 'γραφή', { fam: K.FAM.greek, size: 30, colour: C.shapla });
K.bn(3, 'wGraphe', bx + 39, by + 38, C.shankha);
K.bn(3, 'wHead', bx + 6, by + 50, C.holud);
K.bn(3, 'wBody', bx + 6, by + 64, C.shankha);
K.folio(3, C.kajol);
console.log('s01 ok');
