// p20 · back cover. A neel night, a holud moon in watercolour, the bird on its line in front of it,
// Lalon's two lines, and the lal paar closing the issue the way it opened.
const K = globalThis.OchinLib(globalThis.OCHIN), { T, C } = K, P = 20;
K.clear(P);
K.ground(P, C.neel);
const moon = []; for (let i = 0; i < 90; i++) { const t = i / 90 * 2 * Math.PI; moon.push([138 + 54 * Math.cos(t), 96 + 54 * Math.sin(t)]); }
K.panel(P, moon, 'holud', { fgrain: .5, fwater: .35, fwob: .3, fwear: .02 });
// stars: a few, kantha-small
[[30, 30], [52, 64], [22, 102], [190, 22], [200, 150], [88, 24], [64, 140]].forEach(([x, y], i) => T.circle(P, x, y, 1.2 + (i % 3) * .5, { fill: C.shankha, alpha: .8 }));
K.brand(P, 'bird', { x: 74, y: 64, w: 108, h: 92 }, { flip: 1, perch: 1, pcol: 'sindur', body: 'kajol', wing: 'neel', beak: 'sindur', eye: 'shankha', pupil: 'kajol', wstitch: 'shankha', seed: 20 });
K.bn(P, 'lalon', 16, 172, C.shankha);
K.bn(P, 'who', 16, 172 + K.size('lalon').h + 3, C.holud);
K.bn(P, 'close', 16, 218, C.shankha, { alpha: .9 });
K.brand(P, 'lalpaar', { x: -3, y: 256, w: 216, h: 47 }, { solid: 'sindur', ink: 'shankha', toff: 5, tstyle: 2, weight: .9, seed: 2026 });
K.bn(P, 'nextE', 16, 266, C.holud);
K.bn(P, 'next', 16, 272, C.shankha);
K.bn(P, 'mast', 194, 266, C.shankha, { align: 'right' });
console.log('s10 ok', JSON.stringify({ lalon: K.size('lalon'), close: K.size('close') }));
