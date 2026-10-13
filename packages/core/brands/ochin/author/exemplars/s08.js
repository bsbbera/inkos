// p16-17 · machines learn to see. Verso: four numbers down a thread (M7), the first scanned baby, and
// a neel floor for why film can't be copied. Recto: Earthrise, full bleed, the type in the space.
const K = globalThis.OchinLib(globalThis.OCHIN), { T, C } = K;
K.clear(16);
K.ground(16, C.shankha); K.ground(17, C.kajol);

// ---- p16 ---------------------------------------------------------------------------------
K.bn(16, 'eye', 16, 14, C.padma);
K.bn(16, 'head', 16, 20, C.kajol);
const ROW = (i) => 48 + i * 37;
K.kantha(16, [[11, ROW(0) + 4], [11, ROW(3) + 12]], 'padma', .8, { dash: 1.6, gap: 1.6 });
for (let i = 0; i < 4; i++) {
  const y = ROW(i), col = [C.padma, C.neel, C.sindur, C.holud][i];
  T.circle(16, 11, y + 6, 4, { fill: col });
  K.bn(16, 'n' + (i + 1), 16, y, col);
  K.bn(16, 'k' + (i + 1), 66, y + 1, C.kajol);
  K.bn(16, 'd' + (i + 1), 66, y + 9, C.kajol, { alpha: .9 });
}
// the first scan, its pixels left as they are
T.rect(16, 141, 45, 56, 68, { fill: C.kajol });
K.photo(16, 'kirsch-scan.jpg', { x: 143, y: 47, w: 52, h: 64 }, { crop: [.04, .03, .92, .94] });
K.bn(16, 'kirsch', 141, 116, C.kajol, { alpha: .8 });
// why film can't be copied: a neel floor with three reasons, each with its small drawing
K.panel(16, [[-3, 200], [213, 192], [213, 300], [-3, 300]], 'neel', { fgrain: .45 });
K.bn(16, 'wH', 16, 202, C.holud);
const RX = [16, 76, 136];
// drawings: scattered grains / three stacked layers / one frame
for (let k = 0; k < 14; k++) T.circle(16, RX[0] + 4 + (k * 37 % 40), 222 + (k * 53 % 9), 1 + (k * 7 % 4) * .5, { fill: C.shankha });
[[C.neel, 0], [C.holud, 1], [C.kolapata, 2], [C.sindur, 3]].forEach(([c, j]) => T.rect(16, RX[1], 220 + j * 2.6, 36, 2, { fill: j === 0 ? C.shankha : c, alpha: j === 0 ? .5 : 1 }));
T.rect(16, RX[2], 219, 24, 12, { fill: C.mati }); T.rect(16, RX[2] + 2, 221, 20, 8, { fill: C.kajol });
[0, 1, 2].forEach((i) => { K.bn(16, 'r' + (i + 1) + 'h', RX[i], 234, C.holud); K.bn(16, 'r' + (i + 1), RX[i], 242, C.shankha); });
K.bn(16, 'fair', 16, 270, C.shankha, { alpha: .85 });
K.folio(16, C.shankha);

// ---- p17: Earthrise ------------------------------------------------------------------------
K.photo(17, 'earthrise.jpg', { x: -3, y: -3, w: 216, h: 303 }, { crop: [.25, 0, .713, 1] });
K.bn(17, 'eY', 20, 26, C.holud);
K.bn(17, 'eH', 20, 32, C.shankha);
K.bn(17, 'e', 20, 56, C.shankha, { alpha: .92 });
K.bn(17, 'eC', 20, 56 + K.size('e').h + 4, C.shankha, { alpha: .6 });
K.folio(17, C.shankha);
console.log('s08 ok', JSON.stringify({ e: K.size('e'), r1: K.size('r1'), d3: K.size('d3') }));
