// The issue's type ladder for Bengali (shape.mjs items). Every size on every page comes from here.
//   mark  Galada        masthead, big numbers, years
//   head  Tiro Bangla   headlines, small heads, pull quotes
//   text  Anek Bangla   body, deck, captions, labels
export const LADDER = {
  D1: [66, 70], D2: [42, 46], D3: [28, 32], D4: [16, 21], deck: [14, 20.5], pull: [21, 28],
  body: [11, 16.6], cap: [9.2, 13.4], chip: [10, 14.6], label: [8.4, 11],
  N1: [96, 96], N2: [44, 44], Y: [30, 30],
};
const L = (k) => ({ pt: LADDER[k][0], lead: LADDER[k][1] });
export const head = (k, text, width, more) => Object.assign({ face: 'head', text }, L(k), width ? { width } : {}, more || {});
export const mark = (k, text, more) => Object.assign({ face: 'mark', text }, L(k), more || {});
export const body = (width, text, more) => Object.assign({ face: 'text', wght: 400, text, width, para: 6 }, L('body'), more || {});
export const deck = (width, text, more) => Object.assign({ face: 'text', wght: 300, text, width }, L('deck'), more || {});
export const cap = (width, text, more) => Object.assign({ face: 'text', wght: 400, text, width }, L('cap'), more || {});
export const chip = (width, text, more) => Object.assign({ face: 'text', wght: 400, text, width }, L('chip'), more || {});
export const label = (text, more) => Object.assign({ face: 'text', wght: 600, text }, L('label'), more || {});
export const small = (k, text, width, more) => Object.assign({ face: 'head', text }, L(k), width ? { width } : {}, more || {});
