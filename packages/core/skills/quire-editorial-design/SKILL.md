---
name: quire-editorial-design
description: Portable, math-first rules for designing printed and paged work — page geometry, grids, baseline rhythm, typographic scales, spacing, colour selection and distribution, coloured text boxes, vectors and rules, image and cutout placement — with a controlled catalogue for breaking those rules, and a mapping from each production type (book, short, storybook, storyboard, script, magazine, cover) onto them. Illustration is a sibling skill; this one owns composition and measurement.
version: 2.1.0
---

# Editorial Design Architect

A design engine must never guess. Every value on a page — a margin, a size, a
colour, a gap, an image frame — is **derived** from a handful of declared inputs
by the formulas in this skill. Creativity enters in two places only: choosing the
inputs (§1) and spending the break budget (§9). Everything else is arithmetic.

This skill is tool-agnostic (Affinity, InDesign, Typst, CSS, Canva). It does not
decide what an illustration depicts or how it is rendered — that is the
**Illustration** skill (`quire-illustration`). The two meet through the
placement contract in §11.

---

## 1. Inputs (declare once; everything derives from these)

```yaml
format:    { trim_mm: [210, 297], binding: perfect | saddle | case | none, bleed_mm: 3, safe_mm: 5 }
audience:  child-5 | child-9 | teen | general | expert
type:      book | short | storybook | storyboard | script | magazine | cover
body:      { face: "Source Serif", size_pt: 11.5 }      # S0 — the one number the type scale hangs on
display:   { face: "Fraunces" }                          # one per world/section
palette:   { paper: "#F7F2E8", ink: "#1E1B18", hue: "#E4572E" }   # 60-30-10 roles (§6)
energy:    0.0–1.0                                        # composition energy; drives column rhythm, void, break appetite
```

Audience sets the readability floor and overrides any value below it:

| audience | body pt | leading × | measure (chars) | min caption | words/page cap | contrast body |
|---|---|---|---|---|---|---|
| child-5 | 12–14 | 1.45–1.55 | 40–55 | 10 | 60 / 120 / 180 | ≥ 7:1 |
| child-9 | 11–12.5 | 1.4–1.5 | 45–60 | 9.5 | 120 / 220 / 300 | ≥ 7:1 |
| teen / general | 10–11.5 | 1.35–1.45 | 50–65 | 8.5 | 180 / 350 / 450 | ≥ 7:1 |
| expert | 9.5–10.5 | 1.3–1.4 | 55–75 | 7.5 | 350 / 500 / 650 | ≥ 4.5:1 |

(words/page = plate / feature / dense archetypes, §8.)

---

## 2. Page geometry

### 2.1 Proportion
Prefer root rectangles (1 : √2, ISO A) or the golden rectangle (1 : φ). If the trim
is fixed by the printer, derive the **text block** as a root/golden rectangle
inside it instead.

### 2.2 Margins — Van de Graaf / Tschichold progression
Inner : Top : Outer : Bottom = **2 : 3 : 4 : 6**. Let `m` be the module:

```
m      = trim_width / 9 × k      (k = 0.9 dense … 1.2 airy; k = 1 default)
inner  = 2m   top = 3m   outer = 4m   bottom = 6m
```
Floors: inner ≥ 15 mm (perfect), ≥ 12 mm (saddle), ≥ 18 mm (case); bottom ≥ 2 ×
top. A4, k = 1 → m ≈ 7.8 mm → 16 / 23 / 31 / 47 mm (snap each to the baseline §2.4).

### 2.3 Compound 12-column grid
```
live_width = trim_width − inner − outer
G          = 1.0–1.5 × u                    (gutter equals body leading, §2.4)
W          = (live_width − 11G) / 12         (column width)
span(n)    = nW + (n−1)G
```
Legal spans: 1 (margin notes), 2 (captions/sidebars), 3, 4, 6, 8, 12. A page uses
**at most two rhythms** (e.g. 3-col text + 4-col images). For reflow books use a
single text column of `span(8)` or `span(9)` centred on the text block; the grid
still exists for images and notes.

### 2.4 Baseline unit `u`
```
u = round(body.size_pt × leading_×)          e.g. 11.5 × 1.45 ≈ 16.7 → 17 pt
```
Every vertical measure is `k·u`, k ∈ {0.5, 1, 1.5, 2, 3, 4, 6}: heading leadings,
space before/after, box heights, rule offsets, image frame heights, folio position.
Page height − top − bottom must itself be an integer number of `u`; adjust `bottom`
to make it so (never `top`).

### 2.5 Print safety
Bleed 3 mm outside trim on every bleeding edge; safe area 5 mm inside trim for all
text and small detail; **spine no-go 15 mm** either side of the fold for faces,
type < 14 pt, and any image detail the reader must see. Saddle: page count ÷ 4.

---

## 3. Typography

### 3.1 Family boundary
One **display** family (personality, may change per section/world) and one **text**
family (workhorse, ≥ 6 weights, fixed for the whole work). A third face only as a
mono/caption face for data. Never fake bold or italic.

### 3.2 Modular scale
`S_n = S_0 × r^n`, two ratios:

| layer | r | steps |
|---|---|---|
| micro (content) | 1.250 | folio n=−2 · caption n=−1 · body n=0 · subhead n=1 · title n=2 · deck n=3 |
| macro (display) | 1.618 | headline ≈ S₀φ³ · cover title ≈ S₀φ⁴ · architectural numeral ≈ S₀φ⁶ |

Leading for each step = smallest `k·u ≥ 1.15 × size` (display ≥ 1.0 × size). With
S₀ = 11.5, u = 17: caption 9.2, subhead 14.4/17, title 18/25.5, deck 22.5/34,
headline 48.7/51, cover 78.8/85, numeral 206.

### 3.3 Spacing rules (all in `u`)
- After a heading: 0.5u; before a heading: 1.5u (proximity — the gap above must
  exceed the gap below, ratio ≥ 2 : 1).
- Paragraph: indent 1 em **or** space 0.5u, never both.
- Headline → deck gap < deck → body gap.
- Caption sits 0.5u below its image; byline 0.25u below caption.

### 3.4 Micro-typography
Tracking: display > 40 pt −1 to −3 %; body 0; small caps + 5 %. Measure per §1.
Hyphenation ≤ 2 consecutive; no widows, no orphans; rag depth ≤ 1/5 of measure.
Numerals: oldstyle in text, lining in tables and big numbers.

### 3.5 Type on images
Only on a region whose local contrast to the type colour ≥ 4.5 : 1 (sampled
10 × 10 grid under the text box), or on a field panel (§7). Never a drop shadow
to rescue legibility; pick a different region or add the panel.

---

## 4. Vertical rhythm and image frames

Rectangular image frames snap on all four sides: horizontally to column edges,
vertically to `k·u`. Frame heights are chosen from the aspect ratio then rounded
**down** to the nearest `k·u`, and the image is cropped (never squashed) to fit.
Frame edge offsets from adjacent text: 1u above/below, 1G beside.

---

## 5. Hierarchy and composition

- **One dominant per spread**: the largest element holds 40–60 % of visual weight
  (area × contrast); every subordinate < 50 % of the dominant's area.
- **Reading path**: dominant → headline → deck → entry point of body; the four must
  form a Z or a descending diagonal, never a closed loop.
- **Void**: whitespace ≥ 25 % on editorial pages, ≥ 50 % on breathers, ≥ 35 % on
  storybook text pages. Macro void = leave ≥ 4 empty columns somewhere on the
  spread; micro void = the proximity rules in §3.3.
- **Balance**: sum of visual weight left vs right of the spine within 40/60 unless
  a declared break (§9) says otherwise.

---

## 6. Colour: selection and distribution

### 6.1 Selecting a palette (deterministic from one seed hue)
Work in OKLCH (or HSL if unavailable). Given `hue` (the accent, chosen for the
subject/mood):

```
paper  = L 0.94–0.98, C ≤ 0.02, H = hue ± 20°  (warm subjects) or 180° opposite (cool)
ink    = L 0.15–0.22, C ≤ 0.03, H = hue ± 30°   (a tinted near-black, never pure #000 for text on paper)
field  = L 0.88–0.92, C 0.04–0.08, H = hue        (panel/background tint)
hue tints: 100 % · 60 % · 20 %  → mix hue with paper at those ratios (charts, boxes, rules)
```
Harmony choice for a second accent when needed: analogous (±30°) for calm,
complementary (180°) for energy, split-complementary (150°/210°) for kids' work.
**Never** more than 2 accent hues per world/section; ≤ 5 across a whole magazine.

### 6.2 Distribution — 60 / 30 / 10 (measured on the rendered page)
60 % paper (unprinted ground and near-paper tints) · 30 % ink (text, frames,
rules, dark fields) · 10 % hue (accent spikes: drop caps, kickers, big numbers,
rules, one panel). Tolerance ± 8 points; a page over 18 % accent is "loud" and
must be a declared break.

### 6.3 Contrast arithmetic
WCAG relative luminance `L = 0.2126R + 0.7152G + 0.0722B` (linearised); ratio
`(L1 + 0.05) / (L2 + 0.05)`. Floors: body per §1 table; captions ≥ 4.5; display
≥ 3; hue-on-paper for text ≥ 4.5 (if the accent fails, use the 100 % tint for
rules and the ink for text — never lighten ink).

### 6.4 Print
Rich black `C60 M40 Y40 K100` for fields ≥ 20 mm; `K100` for text; no 4-colour
text < 9 pt; total area coverage ≤ 300 %; store palette as sRGB + CMYK intent and
convert once at export. Fore-edge banding: the folio/section colour changes per
section so the closed book shows sections as colour bands.

---

## 7. Coloured text boxes, panels and rules

```
padding       = 1u all sides (0.75u for captions boxes; 1.5u for pull quotes)
box height    = k·u (text lines + 2 × padding, rounded up)
box width     = span(n), n ∈ {2,3,4,6}; never a fractional column
fill          = field, or hue 20 % tint; ink fill only for one "dark panel" per spread
text on fill  = ink (on light) or paper (on dark); contrast per §6.3
corner radius = 0 (editorial) or 0.5u (children); one radius per work
border        = none, or 0.5 pt ink; never both fill and border unless the fill = paper
inset rule    = 0.75 pt hue, 0.5u inside the box's left edge (pull quotes only)
```
Rule (line) weights ladder: 0.25 / 0.5 / 0.75 / 1 / 2 pt — pick ≤ 3 per work;
section-divider rules span full live width; column rules 0.25 pt ink at 40 %.

---

## 8. Archetypes and pacing (page-shaped work)

Archetypes: `opener` · `plate` (dominant image + ≤ plate-word-cap) · `feature`
(hero + 2–3 columns) · `dense` (4 columns, ≥ 2 boxes) · `specimen` (one labelled
object) · `vs` · `timeline` · `process` · `gallery` (3–6 frames, one caption
stream) · `breather` (≥ 50 % void, one line) · `back-matter`.

Pacing law: no two `dense` adjacent; ≥ 1 `breather` per 6 pages; every section
opens with `opener` on a recto or spread; no three consecutive full-bleeds;
adjacent pages never share image treatment; a colour shift (§6.4) at every
section start. Storybook rhythm: alternate full-bleed spread ↔ white-ground spread.

---

## 9. Breaking the rules (budget: one per section, declared)

A break is legal only if it is **named**, **single**, and **the rest of the page
obeys**. Catalogue:

| # | break | mechanics | must still hold |
|---|---|---|---|
| 1 | Scale disruption | one glyph/numeral at S₀φ⁶ (180–260 pt) behind or beside text, ink at 8–15 % or hue 100 % | body measure, baseline, contrast of text over it |
| 2 | Z-index transgression | three planes: bleed image (back), display type crossing its edge (mid), cutout overlapping both (front) | dominant rule, spine no-go |
| 3 | Void shock | dense verso vs recto holding one 14–16 pt line, ≥ 85 % void | the line sits on the baseline grid |
| 4 | Axis shift | display type rotated 90° down the gutter or off the fore-edge | reading path still resolves to body |
| 5 | Grid slip | one frame offset by exactly 0.5W or 0.5G from the grid | everything else snaps |
| 6 | Palette inversion | one spread with ink as ground, paper as type | 60/30/10 measured on the inverted roles |
| 7 | Bleed violation (storybook only) | image runs through the gutter with the subject on it | no face or eye within 15 mm of fold |

An undeclared break is an error; a declared one is a badge. Two breaks on a page,
or the same break twice in a section, is an error.

---

## 10. How each type maps onto this skill

| type | shape | grid use | dominant | colour scope | typical archetypes | breaks |
|---|---|---|---|---|---|---|
| **book / short / translation** | reflow | one text column span(8–9); images on the grid as opener / tailpiece / plate | the text block; images ≤ 1 per chapter | one palette for the work; hue only in chapter numerals, drop caps, rules | chapter opener (numeral at φ⁴, sink of 6u), running text, tailpiece | ≤ 1 per book (opener numeral) |
| **storybook** | page-shaped spreads | 6-col per page; text in span(3–4) on the quiet side | the illustration on every spread | one palette; text panel = paper or field | full-bleed spread ↔ white-ground spread, alternating | #7 once; #1 on the title |
| **storyboard** | page-shaped | 2 × 3 or 3 × 3 panel grid, panel aspect fixed (16:9 / 4:3), gutters 1G | none (equal panels) | ink only, hue for shot numbers | panel sheet | none |
| **script** | reflow, fixed | screenplay measures (Courier 12, 1.5" left) — the format *is* the grid | — | mono | title page, pages | none |
| **magazine** | page-shaped | full 12-col compound; two rhythms per page | one per spread, varies | palette **per section** inside issue constants (paper, ink, body face fixed) | all of §8 | 1 per section |
| **cover** | single page + wrap | 12-col; type-safe area = trim − 2·safe − 10 mm | image or title | the work's palette at highest contrast | title lockup at S₀φ⁴, author at n=2, spine text ≥ 0.25" | #1 or #2 |

Issue/work constants that never vary inside a work: trim, margins, `u`, body face
and size, folio, caption style, print profile. Everything else may vary per
section (magazine) or is fixed per work (all other types).

---

## 11. Handshake with the Illustration skill

Design owns *where*; Illustration owns *what and how*. The exchange is two files.

**Design → Illustration: `slot`** (one per image the layout wants)
```yaml
slot:      { id: p14-1, page: 14, role: dominant | support | spot | texture }
frame:     { cols: "1-8", top_u: 3, height_u: 22, bleed: [top, left] }   # → aspect ratio, px at 300 dpi
treatment: full-bleed | half-bleed | vignette | cutout | plate | spot | ornament | wash | duotone
colour:    { paper, ink, hue, field }           # so the artwork lands on the palette
text_zone: { cols: "9-12", contrast_min: 4.5 }  # region the image must keep quiet, if any
edge:      hard | soft | alpha                  # what the frame expects back
```

**Illustration → Design: `asset`**
```yaml
asset:     { slot: p14-1, file: art/p14-1.png, alpha: true, px: [2480, 1654] }
subject_box: [x, y, w, h]        # where the subject is, in % — for cropping and wrap
gaze:      left | right | none   # design mirrors the frame so the gaze points inward
palette_check: pass | warn       # dominant colours within the hue/field/paper family
```

Design then: crops to the frame (never squashes), places cutouts with wrap standoff
∈ {0.5G, 1G}, anchored to a flowline or bleeding off trim, overlapping text ≤ 12 mm,
≤ 2 cutouts per spread; runs the checklist (§12). If `palette_check: warn` on a
dominant, the page fails pre-screen and Illustration re-renders.

---

## 12. Zero-tolerance checklist (validator)

1. Spine collision · 2. Baseline drift between adjacent columns · 3. Widow/orphan ·
4. Hyphen ladder > 2 · 5. Frame ending off-grid or mid-`u` · 6. Two dominants or
none · 7. Whitespace under §5 floor · 8. Contrast under §6.3 · 9. Accent share
> 18 % without a declared break · 10. Undeclared or doubled break · 11. Cutout
floating, facing off-page, or > 2 per spread · 12. Text over an image region
failing §3.5 · 13. Words over the audience cap (§1) · 14. Box width fractional or
padding ≠ §7 · 15. More than two rhythms on a page.

---

## 13. Output — spread specification

```yaml
spread:
  geometry:  { trim_mm: [210,297], margins_mm: {inner:16, top:23, outer:31, bottom:47}, columns: 12, gutter_pt: 17, u_pt: 17 }
  type:      { display: "Fraunces", body: "Source Serif 11.5/17", scale: {caption: 9.2, subhead: 14.4, title: 18, deck: 22.5, headline: 48.7} }
  colour:    { paper: "#F7F2E8", ink: "#1E1B18", hue: "#E4572E", field: "#FFE8D6", share: [0.62, 0.29, 0.09] }
  verso:     { archetype: dense, rhythm: [4], blocks: [...], slots: [...] }
  recto:     { archetype: plate, rhythm: [12], blocks: [...], slots: [{ id: p15-1, role: dominant, frame: {...}, treatment: full-bleed }] }
  break:     null | { id: 1, detail: "260 pt '8' behind cols 5-8, ink 12 %" }
```

---

## Quire binding (the only engine-specific part)

Ships as `packages/core/skills/quire-editorial-design/SKILL.md`, bound to
`design.system` / `design.review` for page-shaped types and to `build.layout` for
reflow types. `spread` maps to `pages/<nn>/spec.json`; `slot` is what the ArtDirector
hands to `quire-illustration` (see `quire-illustration`); §12 is `checkDesign`.
Kit assets (07 §1b) are the concrete gradients/patterns/vectors this skill's roles
resolve to; the Section board approves palette + type + kit before any spread is built.
