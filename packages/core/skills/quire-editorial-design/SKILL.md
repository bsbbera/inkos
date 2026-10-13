---
name: quire-editorial-design
description: How Quire designs printed and paged work - brand first. A work held to a brand (core/brands/<id>) is designed inside that brand's system, choosing only what the brand leaves open; a work without one gets the measurement rules below and invents its own language. Owns geometry, type, colour, composition, devices, pacing and the proof check. Illustration is the sibling skill quire-illustration; they meet at the slot/asset handshake.
version: 3.0.0
---

# Editorial design, brand first

Two kinds of work reach this skill.

- **A branded work** (`issue.brand`, e.g. `ochin`). The brand's design system is given to you in the
  prompt, with its spreads attached as images. It is law. You do not choose colours, faces, sizes,
  picture style or ornament; you choose *inside* it. The rest of this skill is how to do that well.
- **An unbranded work.** Nothing is preset. Decide a language from the content (§10) and hold it with
  the same arithmetic.

Whenever a rule below and the brand disagree, the brand wins. Whenever the brand is silent, this
skill applies.

## 1. Who decides what

Variety and identity stop fighting once every layer may only choose from the one above it.

| layer | owns | may never |
|---|---|---|
| **Brand** | colours, faces, size ladder, shapes and their meanings, finish, picture style, bilingual rule, voice | - |
| **Series / house** | masthead, trim, margins, grid systems, folio | add a colour or a face |
| **Section** | two of the brand's section colours (its `pair`), the signature that leads it (`lead`), its idiom in the brand's vocabulary | invent a palette, a register outside the brand, a guest face |
| **Spread** | the device, the composition, the crop, the scale | repeat the previous spread's device |

Sections look different by *choosing*: neighbouring sections take different pairs and different
leads. The surprise of a magazine lives at the spread, never in a new colour.

## 2. Page geometry

- Design spreads, not pages. Facing pages are one composition across the fold.
- Under a brand: its trim, bleed, margins, columns and gutter (Ochin: A4, 3 mm bleed, 16 mm margins,
  6 columns, 4 mm gutter). Without one: margins in the 2:3:4:6 progression from `m = trim_w / 9`.
- Baseline unit `u` = body size x leading; every vertical measure is a multiple of `u` or half of it.
- Spine no-go: no type, face or detail the reader must see within 14 mm of the fold. Check it in
  numbers, not by eye (a spread runs 196-224 mm).
- Text never leaves the live area. Pictures and fields may bleed.

## 3. Type

- **Never invent a size.** Every size comes from the ladder (brand: its ladder; else a modular scale
  `S_n = S_0 x r^n`, r 1.25 micro / 1.618 display). Steps are clearly apart (>= 1.25x) or equal.
- Faces only from the brand's list, each in its role (Ochin: Galada mark and numbers, Tiro Bangla
  heads and pulls, Anek Bangla body / deck 300 / labels 600 caps tracked).
- Every headline hangs from its rule (Ochin: the matra). The kicker is label caps, tracked.
- Measure 50-70 characters for body; 35-45 for narrow notes. No widow, orphan, hyphen ladder > 2.
- Display type needs a clear zone, not just a big size: nothing within one line-height of it.
- Body floor in print: 9.5 pt (brand: 11 pt). If copy does not fit, cut copy, never the size.

## 4. Colour

- **Branded:** only the brand's colours exist. Return its issue palette unchanged; give each section
  its `pair` from the brand's section colours, main colour first, chosen from what the section is
  about (the brand gives starting pairs by topic). Code rebuilds every colour role from the pair, so
  a hex you write that is not the brand's is thrown away.
- **Distribution:** inside pages about half paper, a fifth ink, a sixth the pair, a sliver of signal
  (Ochin: sindur). Openers may fill one section colour. Quiet pages: paper, ink, one mark.
- **Text on ground:** only the pairs the brand's contrast table allows (body >= 4.5:1, heads >= 3:1).
  Never rescue type with a shadow; move it or give it a panel.
- **Unbranded:** derive paper, ink, field and tints from one seed hue in OKLCH; at most two accents per
  section, five per issue; ink on paper >= 7:1.

## 5. Composition

- **One dominant per spread**: 40-60 % of the visual weight; everything else under half its area.
- **Reading path**: dominant -> headline -> deck -> first line of body, as a Z or a descending diagonal.
- **Space is shape**: active white in one or two zones, never holes. A half-empty column is a fault.
- **Alignment**: every edge on a column edge or a baseline; a few strong flowlines carry the page.
- **Pictures and drawn colour together**: a picture stands on a shape that echoes its frame, in the
  section's colour; type sits on paper or on a solid field it reads on.

## 6. The device - one per spread, fresh

Every spread has one device that belongs to its subject and is not the previous spread's. Find it
from the subject's own material: what does this thing physically do, and what paperwork surrounds it?
Brand devices first (Ochin's catalogue):

across the fold - magnifier (an alpana ring on a detail) - exploded stack - film strip - number
stack in the mark face - kantha timeline - album mount with photo corners - opposing pages -
measured chart (real data only, log scale when the range demands it).

A device needs no permission to be new. It needs a reason in the copy.

## 7. Brand shapes: meaning before ornament

A brand's shapes are vocabulary, not decoration. Use one only when the page means what the shape
means, and inside its ration (the brand lists where and how often). Ochin:

- **lal paar** (sari border) = a threshold: cover foot, section openers, back cover only.
- **matra** = the line headlines hang from: every headline.
- **kantha** (running stitch) = connection: a path, a timeline, a river, a word to what it names.
  Never a border for its own sake.
- **alpana** = welcome and order: opens sections, ends stories, rings a magnified detail. One per spread.
- **the bird** = the open question: cover, the end of each story (small, on its line), back cover.
  One per spread. Never inside a cage.
- **panel (pat)** = cloth: plain edge by default; wave = water, scallop = petals, zigzag = mountains
  or stitch, steps = ghats and buildings. May fade an edge or grade between two brand colours.
- **festival ornaments** (alpona, kolam, rosette, band) only when ritual, craft or pattern is the subject.

On the page-art call these are kinds of their own (`lalpaar`, `matra`, `kantha`, `alpana`, `bird`,
`bpanel`, `ornament`) with parameters `p`, colours by brand name; the build draws them with the
brand's shape kit and its finish. Prefer them to primitives; code drops any over its ration.

## 8. Two scripts on one page

When the brand is bilingual, the second language is a gift, not a translation. Ochin: English carries
the reading; Bengali carries the heart (about 85/15). Always Bengali: the mark, folio digits, each
section's name beside its English eyebrow (return it as the section's `bn`). Once per story: one
Bengali line with its English beneath. One word box per feature. Never paragraphs side by side. The
build shapes Bengali as outlines and finds room for the line and the word box; leave some.

## 9. Pacing

Archetypes: opener, plate, feature, dense, specimen, vs, timeline, process, gallery, breather,
back-matter. No archetype twice running; no two dense pages adjacent; at least one breather per six
pages; every loud spread followed by a quiet or dense one; every section opens on an opener.

## 10. Without a brand: a design language

Pick one language per section from the subject (Swiss, classical, field notes, data, pop, minimal, or
one invented for the subject, like "weather station"), name it, and derive every element from it.
Neighbouring sections do not share one. Folio, trim, ladder and body face stay issue-wide.

## 11. Breaking a rule

One declared break per section at most (a 200 pt numeral, a palette inversion, a frame crossing the
fold, a void spread). Under a brand a break never leaves the brand: an inversion swaps paper and ink,
it does not bring a new colour.

## 12. Handshake with illustration

Design owns where; illustration owns what. Each picture slot carries its frame, role (dominant,
support, spot), treatment (full-bleed, cutout, plate, spot), the tone where type will sit on it, and
the text zone it must keep quiet. Illustration returns the asset with alpha, subject box and gaze;
crop, never squash; a cutout's gaze points into the page.

## 13. The proof - read it as printed

Judge the rendered page, never the spec, in this order: the first thing the eye lands on (one
dominant), the one idea, the reading path, **collisions (zero tolerance)**, completeness (no cut text,
no empty frame), space, alignment, type colour, colour use, the picture, and then **brand fidelity**:
is this unmistakably the brand's page - its palette, faces, shapes and their meanings, finish,
bilingual touches - and at the level of the brand's own spreads? A colour, face or ornament the brand
does not have fails the page however good it looks. Score from 100: collision or cut text -25, no
dominant -20, off-brand element -20, dead space or broken path -10, a detail -3. Under 85: redesign,
told each fault in the page's own terms (which frame, which way, how far).

## 14. Zero-tolerance checklist

Spine collision - overlapping text - cut or overset text - type outside the live area - off-ladder
size - off-brand colour or face - text under its contrast floor - signature over its ration - a
section using more than its pair - missing folio - a chart with a number no source holds - a
picture without source and licence.

## Quire binding

`core/skills/design-skills.ts` gives this skill to every design, layout and build stage. The brand
in force comes from `issue.brand` (`PUT /publications/:id/brand`); `core/pipeline/brand.ts` loads
`core/brands/<id>/` (brand.json, DESIGN-SYSTEM.md, references/, kit/, fonts/) and holds the spec,
section worlds and page art to it. The page critic (`page-look.ts`) judges against the brand's
spreads. §14 is what `checkDesign`, the brand check and the build's INSPECT measure.
