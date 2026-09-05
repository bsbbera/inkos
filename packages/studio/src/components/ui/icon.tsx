/*
 * The icon set, as one sprite.
 *
 * Extracted verbatim from analysis/mock/mock.js so the app and the mockups
 * draw the same glyphs: one 24px grid, 1.6 stroke, round caps and joins, no
 * fills. Emoji and Unicode glyphs are not an icon system, and a set assembled
 * from three sources reads as three sets - which is what lucide-mixed-with-
 * inline-SVG looked like here before.
 */

export const ICONS = {
  /* The mark: three nested arcs, the gathering of folded sheets that makes
     one signature of a book. It is the product name, drawn. */
  quire: '<path d="M12 3.2a8.8 8.8 0 1 0 6.2 15"/><path d="M12 6.9a5.1 5.1 0 1 0 3.6 8.7"/><path d="M12 10.6a1.4 1.4 0 1 0 1 2.4"/><path d="m16.4 16.4 4 4"/>',

  home:     '<path d="M3 10.4 12 3l9 7.4"/><path d="M5.4 9.2V21h13.2V9.2"/>',
  book:     '<path d="M4 4.6A1.6 1.6 0 0 1 5.6 3H20v18H5.6A1.6 1.6 0 0 1 4 19.4z"/><path d="M8.2 3v18"/>',
  magazine: '<path d="M4 4h16v16H4z"/><path d="M4 9.2h16"/><path d="M9.4 9.2V20"/>',
  layers:   '<path d="M12 3 3 7.8l9 4.8 9-4.8z"/><path d="M3 12.6 12 17.4l9-4.8"/><path d="M3 16.8 12 21.6l9-4.8"/>',
  sliders:  '<path d="M4 7.5h8"/><path d="M17 7.5h3"/><path d="M4 16.5h3"/><path d="M12 16.5h8"/><circle cx="14.5" cy="7.5" r="2.4"/><circle cx="9.5" cy="16.5" r="2.4"/>',
  image:    '<path d="M3.5 4.5h17v15h-17z"/><path d="m3.5 15.5 4.6-4.6 3.4 3.4 3-3 6 6"/><circle cx="8.6" cy="8.8" r="1.5"/>',
  globe:    '<circle cx="12" cy="12" r="8.8"/><path d="M3.2 12h17.6"/><path d="M12 3.2a13.5 13.5 0 0 1 0 17.6"/><path d="M12 3.2a13.5 13.5 0 0 0 0 17.6"/>',
  pulse:    '<path d="M3 12.5h4.2L10 4.6l4 15 2.6-7.1H21"/>',
  plug:     '<path d="M9 3v5.4"/><path d="M15 3v5.4"/><path d="M6.2 8.4h11.6v3.2a5.8 5.8 0 0 1-11.6 0z"/><path d="M12 17.4V21"/>',
  chat:     '<path d="M3.6 5.4h16.8v10.6H9.4l-4.2 3.6v-3.6H3.6z"/>',
  skill:    '<path d="M12 3.2 14.4 9l6.2.5-4.7 4 1.4 6-5.3-3.2L6.7 19.5l1.4-6-4.7-4L9.6 9z"/>',
  clip:     '<path d="M17.6 10.4 11 17a3.6 3.6 0 0 1-5.1-5.1l7.2-7.2a2.4 2.4 0 0 1 3.4 3.4l-7.2 7.2a1.2 1.2 0 0 1-1.7-1.7l6.6-6.6"/>',
  send:     '<path d="M12 19.4V5"/><path d="m6.4 10.6 5.6-5.6 5.6 5.6"/>',
  folder:   '<path d="M3.2 6.4h6.1l2.1 2.6h9.4V19.4H3.2z"/>',
  file:     '<path d="M6.2 3h8L19 7.8V21H6.2z"/><path d="M14.2 3v4.8H19"/>',

  chevR: '<path d="m9.5 5.2 6.8 6.8-6.8 6.8"/>',
  chevD: '<path d="m5.2 9.5 6.8 6.8 6.8-6.8"/>',
  chevL: '<path d="m14.5 5.2-6.8 6.8 6.8 6.8"/>',
  arrR:  '<path d="M3.8 12h15.4"/><path d="m13.4 6.2 5.8 5.8-5.8 5.8"/>',
  arrL:  '<path d="M20.2 12H4.8"/><path d="m10.6 6.2-5.8 5.8 5.8 5.8"/>',

  copy:  '<path d="M9 9h11.2v11.2H9z"/><path d="M15.4 9V3.8H3.8V15.4H9"/>',
  // Four corner brackets opening outwards: the glyph every player and viewer
  // uses for "give this the whole screen", so it needs no label to be read.
  expand:'<path d="M4.2 9.4V4.2h5.2"/><path d="M14.6 4.2h5.2v5.2"/><path d="M19.8 14.6v5.2h-5.2"/><path d="M9.4 19.8H4.2v-5.2"/>',
  check: '<path d="m4.4 12.4 5.4 5.4L19.6 6.6"/>',
  x:     '<path d="M6 6 18 18"/><path d="M18 6 6 18"/>',
  plus:  '<path d="M12 4.8v14.4"/><path d="M4.8 12h14.4"/>',
  minus: '<path d="M4.8 12h14.4"/>',
  search:'<circle cx="10.8" cy="10.8" r="6.9"/><path d="m20.2 20.2-4.5-4.5"/>',

  play:  '<path d="M7.6 4.6v14.8L19.4 12z"/>',
  pause: '<path d="M9 5v14"/><path d="M15 5v14"/>',
  redo:  '<path d="M20.2 12a8.2 8.2 0 1 1-2.4-5.8"/><path d="M20.2 4.6v5.2H15"/>',
  stop:  '<path d="M6.5 6.5h11v11h-11z"/>',
  down:  '<path d="M12 4.2v11.2"/><path d="m7.4 11 4.6 4.6L16.6 11"/><path d="M4.8 20h14.4"/>',
  up:    '<path d="M12 19.8V8.6"/><path d="m7.4 13 4.6-4.6L16.6 13"/><path d="M4.8 4h14.4"/>',

  eye:    '<path d="M2.4 12S6.2 5.6 12 5.6 21.6 12 21.6 12 17.8 18.4 12 18.4 2.4 12 2.4 12z"/><circle cx="12" cy="12" r="2.9"/>',
  pencil: '<path d="m4 20 .9-4.3L15.6 5l3.4 3.4L8.3 19.1z"/><path d="m14.2 6.4 3.4 3.4"/>',
  trash:  '<path d="M5 6.6h14"/><path d="M9.4 6.6V4.4h5.2v2.2"/><path d="M6.8 6.6 7.8 20h8.4l1-13.4"/>',
  lock:   '<path d="M5.6 10.8h12.8V20H5.6z"/><path d="M8.6 10.8V8.2a3.4 3.4 0 0 1 6.8 0v2.6"/>',
  clock:  '<circle cx="12" cy="12" r="8.8"/><path d="M12 6.8V12l3.4 2.1"/>',
  alert:  '<path d="M12 3.6 21.4 20H2.6z"/><path d="M12 10v4.4"/><path d="M12 17.1v.1"/>',
  info:   '<circle cx="12" cy="12" r="8.8"/><path d="M12 11v5.4"/><path d="M12 7.9v.1"/>',
  dots:   '<circle cx="5.6" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18.4" cy="12" r="1.3"/>',
  grid:   '<path d="M4 4h6.4v6.4H4z"/><path d="M13.6 4H20v6.4h-6.4z"/><path d="M4 13.6h6.4V20H4z"/><path d="M13.6 13.6H20V20h-6.4z"/>',
  list:   '<path d="M4 6.8h16"/><path d="M4 12h16"/><path d="M4 17.2h16"/>',
  heart:  '<path d="M12 20.2S3.8 15.2 3.8 9.8A4.7 4.7 0 0 1 12 6.6a4.7 4.7 0 0 1 8.2 3.2c0 5.4-8.2 10.4-8.2 10.4z"/>',
  drop:   '<path d="M12 3.4c3.4 4 5.6 6.6 5.6 9.4a5.6 5.6 0 0 1-11.2 0c0-2.8 2.2-5.4 5.6-9.4z"/>',
  type:   '<path d="M5 6.4h14"/><path d="M12 6.4V19"/>',
  cpu:    '<path d="M7.4 7.4h9.2v9.2H7.4z"/><path d="M4.6 4.6h14.8v14.8H4.6z"/><path d="M9.6 4.6V2.4"/><path d="M14.4 4.6V2.4"/><path d="M9.6 21.6v-2.2"/><path d="M14.4 21.6v-2.2"/>',

  /* Reading aloud, and stopping it. A cone and two arcs, on the same grid as
     the rest - not the filled speaker every icon set draws. */
  speak:   '<path d="M4 9.4h3.4L12 5.2v13.6L7.4 14.6H4z"/><path d="M15.6 9.6a3.4 3.4 0 0 1 0 4.8"/><path d="M18.2 7a7 7 0 0 1 0 10"/>',
  mute:    '<path d="M4 9.4h3.4L12 5.2v13.6L7.4 14.6H4z"/><path d="m16 9.8 4.4 4.4"/><path d="m20.4 9.8-4.4 4.4"/>',

  winMin:  '<path d="M5 12h14"/>',
  winMax:  '<path d="M6 6h12v12H6z"/>',
  winClose:'<path d="M6.5 6.5 17.5 17.5"/><path d="M17.5 6.5 6.5 17.5"/>',
} as const;

export type IconName = keyof typeof ICONS;

/*
 * The stroke attributes live on each symbol, not on the sprite root. A <use>
 * instance inherits from the svg that references it, so attributes parked on
 * the sprite wrapper reach nothing and every icon renders as a solid black
 * fill.
 */
export function IconSprite() {
  return (
    <svg
      aria-hidden="true"
      style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}
    >
      {Object.entries(ICONS).map(([name, d]) => (
        <symbol
          key={name}
          id={`i-${name}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
          dangerouslySetInnerHTML={{ __html: d }}
        />
      ))}
    </svg>
  );
}

export function Icon({
  name,
  size = 17,
  className,
}: {
  readonly name: IconName;
  readonly size?: number;
  readonly className?: string;
}) {
  return (
    <svg width={size} height={size} className={className} aria-hidden="true">
      <use href={`#i-${name}`} />
    </svg>
  );
}
