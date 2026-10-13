# Drawing an Ochin spread: the kit

You design a spread by writing the script that draws it in Affinity, the way every spread of
Ochin 01 was made. The examples you are shown are Ochin 01's own scripts; use the same calls.

## Pages and units

- A4 pages, millimetres, y down. Page 1 is the cover, alone on the right. After it pages pair up:
  even page = verso (left), odd page = recto (right). The last page (the back cover) is a verso alone.
- Every call takes the page number `P` and **page** coordinates: x 0-210, y 0-297 on that page,
  whichever side it is on. Bleed: draw grounds from -3 to 213 / 300 (`K.ground` does).
- Margins: 14-16 mm from the trim for text; the folio sits at y 284.5. Nothing readable within 6 mm
  of the trim. The fold is page x 210 on a verso and x 0 on a recto: never put words across it.
- Start with `const K = globalThis.OchinLib(globalThis.OCHIN), { T, C } = K;` then `K.clear(P)` for
  every page you draw (it empties the spread), then the grounds, then everything else, back to front.

## Colours

`C.shankha C.kajol C.sindur C.holud C.neel C.kolapata C.shapla C.padma C.mati C.paper` (hex).
Kit calls also take the names as strings ('holud'). No other colour exists.

## Text: blocks you name, shaped before the script runs

All copy is set through **text blocks** you declare in `texts`, keyed by an id you choose:

    "texts": { "head": { "role": "D2", "text": "The dark room", "width": 100 }, ... }

- `role` is a rung of the ladder: `N1` 96 Galada number · `N2` 44 · `Y` 30 Galada year ·
  `D1` 66/70 · `D2` 42/46 · `D3` 28/32 · `D4` 16/21 · `pull` 21/28 (Tiro Bangla) · `deck` 14/20.5
  light · `body` 11/16.6 · `chip` 10/14.6 · `cap` 9.2/13.4 · `label` 8.4/11 caps tracked (Anek Bangla).
  `pt` and `lead` override a size only for the masthead.
- `width` mm wraps the block; leave it out for a one-line block. `"\n"` starts a new paragraph
  (body paragraphs get 6 pt between them). `align`: left (default) | right | centre. `ital`: true
  (Tiro Bangla italic, for the other language's line).
- English is set as live text; a block with any Bengali letter becomes outlines (Affinity cannot
  shape Bengali). Never mix a Bengali paragraph and an English one in one block.
- `K.bn(P, id, x, top, colour, { align, alpha })` draws block `id` with its top-left at x, top
  (align 'right': x is the right edge; 'centre': x is the centre). `K.tx` is the same call.
- `K.size(id)` gives `{ w, h, lead, lines }` in mm, measured: place by it (`top + K.size('head').h + 4`).
- `K.en(P, x, y, w, h, text, { size, colour, align, ital, fam })` is only for a few words that
  are not copy (a credit, a running label). Copy goes through blocks, all of it.

## Grounds, panels, photographs

- `K.ground(P, colour)` the page's field, with the brand grain. `K.field(P, x, y, w, h, colour)` a
  grained rectangle. `K.cut(P, pts, colour)` a grained field cut to any outline.
- `K.panel(P, pts, colour, params)` a pat panel: any outline (`K.rectPts(x, y, w, h)`, `K.blobPts(pts)`).
  params: `fgrain` 0-1, `fadeL fadeR fadeT fadeB` mm soft edges, `opacity`, `gcol` + `gang` + `gamt`
  a grade into a second brand colour; for a rectangle an edge: `profile` 0 plain, 1 wave (water), 2 scallop (petals), 3 zigzag (mountains, stitch), 4 steps (ghats, buildings), `depth` mm,
  `pitch` mm between repeats. Finish: `fwob` wobble, `fwear` wear, `fwater` watercolour (0-0.6).
- `K.photo(P, file, { x, y, w, h }, { clip: 'circle' | pts, crop: [sx, sy, sw, sh], tone, opacity })`
  places a picture covering the box; `crop` (fractions of the picture) says which part must fill it.
  Only files you are given exist. A photograph is never recoloured except a deliberate `tone` duotone.
- `T.rect(P, x, y, w, h, { fill, alpha })`, `T.circle(P, cx, cy, diameter, { fill, alpha })`,
  `T.polyline(P, pts, { fill, alpha })`, `T.line(P, x1, y1, x2, y2, { fill, t })` (t = mm thickness),
  `T.beam(P, x0, y0, deg, len, w0, w1, colour, { alpha, alphaEnd })` a light beam. Use them for
  diagrams: Ochin draws its explanations in code (the camera obscura, film layers, a sensor grid).

## Brand shapes (Ochin Shape, all in a box in page mm)

- `K.brand(P, 'lalpaar', box, { solid: 'sindur', ink: 'shankha', toff, tstyle, weight, seed })`
  covers, section openers, the back cover only.
- `K.brand(P, 'matra', { x, y, w, h: 3 }, { rule: 1.1, solid })` the headstroke every headline hangs
  from: the head's top sits on it (top = rule y + 2.6).
- `K.kantha(P, pts, colour, weightPt, { dash, gap, ends, endcol })` a running stitch along points:
  only where something connects (a timeline, a ray, a leader to a label).
- `K.brand(P, 'alpana', box, { apet, aform, aring, ainner, solid, ink, seed })` one per spread at most;
  opens a section or ends a story.
- `K.brand(P, 'bird', box, { body, wing, beak, wstitch, flip, perch, pcol, seed })` cover, the end
  of a story, the back cover; never in a cage, at most one per spread.
- `K.folio(P, colour)` on every page but the covers.

## What the script must not do

No `require` of anything, no file access, no other document. No `Math.random` (use fixed numbers
or a seed: a rebuild must draw the same page). Do not draw on pages that are not yours.
End with `console.log('ok')`.

## How a spread is judged

It runs; every word of the copy you were given is placed; no block overruns its frame; no two
blocks collide; nothing readable crosses the fold or the margins; it reads in the order the copy
is meant; then the eye compares it with Ochin 01 and the design system. Then you are shown the
render and what failed, and you revise.
