// p10-11 · when pictures moved. One strip of film runs across both pages carrying Muybridge's horse;
// paper below it on the verso (the bet, the Kodak), a sindur cinema on the recto (the Lumières).
const K = globalThis.OchinLib(globalThis.OCHIN), { T, C } = K;
K.clear(10);
K.ground(10, C.shankha); K.ground(11, C.sindur);

// ---- the strip, across the fold ------------------------------------------------------------
const SY = 38, SH = 70;
K.panel(10, K.rectPts(-3, SY, 426, SH), 'kajol', { fgrain: .45 });
for (let x = -1; x < 423; x += 6.5) { T.rect(10, x, SY + 3, 3.4, 2.6, { fill: C.shankha, corners: { tl: .6, tr: .6, bl: .6, br: .6 } }); T.rect(10, x, SY + SH - 5.6, 3.4, 2.6, { fill: C.shankha, corners: { tl: .6, tr: .6, bl: .6, br: .6 } }); }
// frames sit either side of a gap at the fold, never across it
const FW = 62, FH = 41, FY = SY + (SH - FH) / 2, XS = [14, 80, 146, 212, 278, 344, 410];
const cropOf = (i) => { const r = Math.floor(i / 4), c = i % 4; return [.012 + c * .2465, .035 + r * .274, .228, .245]; };
XS.forEach((x, i) => K.photo(10, 'muybridge-horse.jpg', { x, y: FY, w: FW, h: FH }, { crop: cropOf(i + 1) }));
// the frame with all four feet off the ground
T.ring(10, 80 + FW / 2, FY + FH / 2, 52, { stroke: C.holud, weight: 1.8 });

// ---- p10 ----------------------------------------------------------------------------------
K.bn(10, 'eye', 16, 13, C.sindur);
K.bn(10, 'head', 16, 19, C.kajol);
K.bn(10, 'y1', 16, 114, C.sindur);
K.bn(10, 'n1', 16 + K.size('y1').w + 4, 121, C.kajol);
K.bn(10, 'b1', 16, 134, C.kajol);
K.kantha(10, [[111, 108], [118, 122], [124, 128]], 'holud', 1, { dash: 1.4, gap: 1.2 });
K.bn(10, 'q', 124, 124, C.sindur);
// the Kodak: the advert on a mat, the hundred pictures as a hundred dots, the slogan
K.panel(10, [[106, 186], [196, 182], [196, 280], [104, 280]], 'holud', { fgrain: .5 });
K.bn(10, 'y2', 112, 190, C.kajol);
K.bn(10, 'n2', 112 + K.size('y2').w + 4, 197, C.kajol);
K.bn(10, 'slogan', 112, 210, C.sindur);
K.bn(10, 'b2', 112, 224, C.kajol);
K.photo(10, 'kodak-button.jpg', { x: 16, y: 190, w: 80, h: 52 }, {});
for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) T.circle(10, 18 + c * 2.6, 252 + r * 2.6, 1.7, { fill: r * 10 + c < 99 ? C.kajol : C.sindur });
K.bn(10, 'hundred', 46, 262, C.kajol);
K.folio(10, C.kajol);

// ---- p11 ----------------------------------------------------------------------------------
const arch = (x, y, w, h) => { const a = []; for (let k = 0; k <= 24; k++) { const t = Math.PI * (1 - k / 24); a.push([x + w / 2 + w / 2 * Math.cos(t), y + w / 2 - w / 2 * Math.sin(t)]); } return [...a, [x + w, y + h], [x, y + h]]; };
const LB = { x: 118, y: 116, w: 76, h: 98 };
K.panel(11, arch(LB.x - 3, LB.y - 3, LB.w + 6, LB.h + 6), 'shankha', { fgrain: .3 });
K.photo(11, 'lumiere-brothers.jpg', LB, { clip: arch(LB.x, LB.y, LB.w, LB.h), crop: [0, .02, 1, .96] });
K.bn(11, 'capL', 118, 217, C.shankha, { alpha: .85 });
K.bn(11, 'y3', 20, 114, C.holud);
K.bn(11, 'n3', 20, 128, C.shankha);
K.bn(11, 'b3', 20, 140, C.shankha);
// the myth, on a kajol card
K.panel(11, [[20, 186], [104, 186], [104, 214], [26, 218]], 'kajol', { fgrain: .4 });
K.bn(11, 'mythH', 26, 189, C.holud);
K.bn(11, 'myth', 26, 196, C.shankha);
// twenty-four frames make one second
K.photo(11, 'cinematographe.jpg', { x: 20, y: 226, w: 86, h: 52 }, { crop: [0, .1, 1, .8] });
K.bn(11, 'fpsH', 118, 228, C.holud);
K.bn(11, 'fps', 136, 230, C.shankha);
for (let i = 0; i < 24; i++) T.rect(11, 118 + i * 3.1, 266, 2.4, 9, { fill: C.shankha, alpha: .35 + .65 * (i % 6 === 0) });
K.folio(11, C.shankha);
console.log('s05 ok', JSON.stringify({ b1: K.size('b1'), b3: K.size('b3'), b2: K.size('b2') }));
