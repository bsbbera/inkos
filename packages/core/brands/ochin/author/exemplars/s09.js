// p18 our eyes: a lal paar head, album pictures held by photo corners, a woven border band, and a mati
// floor for Pather Panchali. p19 what a photograph remembers: quiet paper, one magnified detail.
const K = globalThis.OchinLib(globalThis.OCHIN), { T, C } = K;
K.clear(18);
K.ground(18, C.shankha); K.ground(19, C.paper);

// a picture on an album mount, four kajol photo corners holding it (the board's own device)
function album(P, file, b, o) {
  o = o || {}; const m = 2.2, k = 6, cc = o.corner || C.kajol;
  K.field(P, b.x - m, b.y - m, b.w + 2 * m, b.h + 2 * m, o.mat || C.paper);
  K.photo(P, file, b, o);
  const X0 = b.x - m, Y0 = b.y - m, X1 = b.x + b.w + m, Y1 = b.y + b.h + m;
  [[[X0, Y0], [X0 + k, Y0], [X0, Y0 + k]], [[X1, Y0], [X1 - k, Y0], [X1, Y0 + k]], [[X0, Y1], [X0 + k, Y1], [X0, Y1 - k]], [[X1, Y1], [X1 - k, Y1], [X1, Y1 - k]]].forEach((p) => T.polyline(P, p, { fill: cc }));
}

// ---- p18 --------------------------------------------------------------------------------
K.brand(18, 'lalpaar', { x: -3, y: -3, w: 216, h: 42 }, { solid: 'sindur', ink: 'shankha', toff: 6, tstyle: 1, weight: .9, seed: 18 });
K.bn(18, 'head', 16, 13, C.shankha);
K.bn(18, 'eye', 196, 30, C.holud, { align: 'right' });
album(18, 'bourne-hooghly.jpg', { x: 18, y: 52, w: 92, h: 68.5 });
K.bn(18, 'cap1', 18, 124, C.mati);
K.bn(18, 'y1', 118, 52, C.sindur);
K.bn(18, 'n1', 118, 64, C.kajol);
K.bn(18, 'b1', 118, 74, C.kajol);
album(18, 'deen-dayal.jpg', { x: 18, y: 138, w: 46, h: 64 }, { crop: [.02, .02, .96, .9], corner: C.sindur });
K.bn(18, 'y2', 70, 138, C.sindur);
K.bn(18, 'n2', 70, 150, C.kajol);
K.bn(18, 'b2', 70, 160, C.kajol);
T.circle(18, 150, 152, 30, { fill: C.holud });
K.photo(18, 'hiralal-sen.jpg', { x: 137, y: 139, w: 26, h: 26 }, { clip: 'circle', crop: [.05, .02, .9, .66] });
K.bn(18, 'y3', 168, 140, C.sindur);
K.bn(18, 'n3', 136, 170, C.kajol);
K.bn(18, 'b3', 136, 180, C.kajol);
// a woven border, then the mati floor
K.brand(18, 'band', { x: 0, y: 220, w: 210, h: 10 }, { band: 0, width: 7, groups: 4, ink: 'sindur', solid: 'holud', weight: .6, seed: 55 });
K.panel(18, K.rectPts(-3, 234, 216, 69), 'mati', { fgrain: .5 });
K.bn(18, 'y4', 16, 240, C.holud);
K.bn(18, 'n4', 16 + K.size('y4').w + 4, 244, C.shankha);
K.bn(18, 'b4', 16, 254, C.shankha);
K.brand(18, 'alpana', { x: 150, y: 238, w: 44, h: 44 }, { apet: 3, aform: 2, aring: 1, ainner: 3, solid: 'holud', ink: 'shankha', seed: 19 });
K.folio(18, C.shankha);

// ---- p19 --------------------------------------------------------------------------------
K.bn(19, 'pEye', 20, 16, C.shapla);
K.bn(19, 'pHead', 20, 22, C.kajol);
// the punctum: the bootblack, large, in a shapla ring
const Z = { cx: 148, cy: 92, d: 86 };
T.circle(19, Z.cx, Z.cy, Z.d + 7, { fill: C.shapla });
K.photo(19, 'daguerre-boulevard.jpg', { x: Z.cx - Z.d / 2, y: Z.cy - Z.d / 2, w: Z.d, h: Z.d }, { clip: 'circle', crop: [.165, .725, .08, .112] });
K.bn(19, 'zoomC', 104, 141, C.mati);
K.bn(19, 'word', 20, 62, C.sindur);
K.kantha(19, [[20 + K.size('word').w + 3, 72], [Z.cx - Z.d / 2 - 4, 82]], 'shapla', 1, { ends: 1.4, endcol: 'shapla' });
K.bn(19, 'wB', 20, 82, C.kajol);
K.brand(19, 'matra', { x: 20, y: 160, w: 174, h: 3 }, { rule: .6, rstyle: 2, solid: 'shapla', seed: 19 });
K.bn(19, 'p1', 20, 170, C.kajol);
K.bn(19, 'p2', 112, 170, C.kajol);
K.brand(19, 'alpana', { x: 18, y: 240, w: 30, h: 30 }, { apet: 2, aform: 1, aring: 1, ainner: 1, solid: 'shapla', ink: 'sindur', seed: 3 });
K.bn(19, 'ask', 54, 249, C.sindur);
K.folio(19, C.kajol);
console.log('s09 ok', JSON.stringify({ p1: K.size('p1'), p2: K.size('p2'), b4: K.size('b4'), b3: K.size('b3') }));
