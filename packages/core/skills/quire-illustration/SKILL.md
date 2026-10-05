---
name: quire-illustration
description: Portable rules for deciding what to illustrate and how — sensing subjects from approved text, choosing surface and technique, writing engine-agnostic briefs, producing cutouts and alpha edges, keeping recurring characters consistent, reusing approved art, and reviewing results — with a distinct process per production type (book, short, storybook, storyboard, magazine, cover). Composition and measurement belong to the sibling Editorial Design skill; the two meet through the slot/asset contract.
version: 1.0.0
---

# Editorial Illustration Director

Illustration is **derived from the text**, never decorated onto it. This skill turns
approved copy into art briefs an engine can execute (ComfyUI, Canva AI, a human
illustrator, a vector toolkit), post-processes the result for placement, and judges
it. It does not lay out pages: it receives a **slot** from the Design skill and
returns an **asset** (Design skill §11).

---

## 1. Inputs

```yaml
type:      book | short | storybook | storyboard | magazine | cover
audience:  child-5 | child-9 | teen | general | expert
policy:    { surfaces: [illustration, photo, infographic, typographic, texture], realism: forbidden | allowed | preferred }
world:     { technique, palette: {paper, ink, hue, field}, props[], mood[], negative[], imagePrompt }   # one per work, or per section
cast:      [{ id, traits[], wardrobe[], refs[] }]        # recurring characters, if any
text:      the approved unit (chapter / spread / page bundle) — the only source of subjects
slots:     from the Design skill (frame, treatment, role, colour, text_zone, edge)
library:   approved assets with subjectKey, world, technique   # reuse before creating
```

Policy is decided upstream by type (books and stories: illustration only, realism
forbidden; magazine: all surfaces, realism allowed for `photo`). This skill never
overrides it.

---

## 2. Sensing: from text to subject

Read the whole unit before briefing. A subject is **a sentence a reader could
point to in the text** — an action, an object, a face, a place at a moment — not a
mood, theme or caption.

Rules:
1. Find the **beat**: the moment the unit turns (a decision, an arrival, a
   reveal). One beat per image; the dominant slot gets the strongest beat.
2. Prefer **the thing over the idea**: "a rusted key on a wet step" beats "mystery".
3. **Eye level of the audience**: child-5 → child's eye height, faces visible,
   one figure doing one thing; expert → objects, systems, details.
4. **What the text does not say** may not appear (no invented characters, props
   contradicting the setting, wrong era objects — check against the setting
   bible/lexicon when present).
5. Write a `subjectKey` (2–3 words, kebab) for reuse matching: `sun-lantern`,
   `mira-lifting-lantern`.

Output per slot: `subject` (≤ 25 words), `subjectKey`, `characters[]`, `mustNot[]`,
`reason` (one line quoting the text).

---

## 3. Surface and technique

| surface | when | technique comes from | realism words |
|---|---|---|---|
| illustration | default for every narrative type; magazine essays/explanations | `world.technique` (watercolor, gouache, ink-and-wash, linocut, riso, paper-cut, pastel, vector-flat, isometric, crayon, felt, digital-painterly, line, blueprint…) | forbidden unless policy allows |
| infographic | any quantity, sequence, comparison, anatomy, map | world's line-weight family (0.5/0.75/1 pt), palette tints only | none |
| photo | magazine reportage, real objects, real places | documentary / studio-still; duotone to paper/ink inside illustrated sections | allowed |
| typographic | openers, breathers, covers where the word is the picture | the section's display face | — |
| texture | grounds behind text (opacity 12–20 %) | paper grain, halftone, wash in `field` | — |

One technique per world; a technique word appears **verbatim** in every brief of
that world so the engine cannot drift. Two adjacent worlds/sections never share a
technique.

---

## 4. The brief (engine-agnostic)

```yaml
brief:
  slot: p14-1                      # from Design
  surface: illustration
  technique: "gouache, flat opaque colour, visible brush edges"
  subject: "Mira lifts the lantern over the flooded stairs, water at her knees"
  subjectKey: mira-lifting-lantern
  characters: [mira]               # → cast refs / trait lines
  composition: "figure left third, gaze right, stairs lead into the frame"   # derived from slot.text_zone + gaze rule
  palette: { paper: "#F7F2E8", ink: "#1E1B18", hue: "#E4572E", field: "#FFE8D6" }
  treatment: cutout                 # from slot → post-process (§6)
  edge: alpha
  aspect: "3:2"  px: [2480, 1654]   # from slot.frame at 300 dpi
  mustNot: ["adult faces", "modern lamp", "text in image"]
  negative: [world.negative, policy block, setting anachronisms]
  reuse: null | "library:mira-lifting-lantern@2"
  reason: "ch.7 ¶12 — the chapter turns on her deciding to go down"
```

Prompt assembly (for prompt-driven engines) is fixed order:
`world.imagePrompt → technique → subject → composition → treatment suffix → 2–4 props
→ palette words`. Negative: `engine base → policy block → world.negative → mustNot`.
Engines without a negative channel get the policy block rewritten positively
("hand-painted, no photorealism, no 3D").

Treatment suffixes: cutout → "single subject, full figure, isolated on plain white,
no ground shadow, no background"; spot → "small vignette, plain white ground";
vignette → "subject centred, edges fading to white"; wash → "soft abstract field,
no subject"; plate/full-bleed → "full scene, extends to all edges".

---

## 5. Process per type

### 5.1 Magazine (design-heavy, world per section)
- Read the **page bundle** (copy + blocks). Every page gets 1–3 slots from Design;
  surfaces by content kind: reportage → photo; quantity/sequence → infographic;
  explanation/essay → illustration; opener → typographic or illustration.
- **Prompts change per section**: technique, palette, props and mascot come from
  that section's world. Never carry a technique across a section boundary.
- Infographics first as data (block kinds: bignumber, vs, timeline, process, map,
  scale-compare, parts-of); render as vectors when a component exists, else as a
  generated diagram in the world's line family with ≤ 3-word labels (child-5).
- Section mascot / ornament / masthead: **generate once per issue**, approve, then
  reuse by `subjectKey` on every page of the section.
- Surface mix target per issue (e.g. 40 photo / 35 illustration / 15 infographic /
  10 typographic) is a target, not a quota; adjacent pages never share treatment.

### 5.2 Storybook (storytelling-heavy, one world)
- One image per spread; the subject is the spread's beat at the child's eye level;
  the recurring cast must be present when the text names them.
- **Cutouts are the attention device**: spreads alternate full-bleed scene ↔
  white-ground cutout (figure or object isolated, gaze toward the text). Never two
  cutout spreads in a row; never two full-bleeds in a row.
- Same technique, palette and cast sheet across the whole book; variety comes from
  beat, scale (close / mid / wide), and treatment — not from style.
- Text zone from Design is sacred: the image keeps that region quiet (sky, wall,
  water, white).

### 5.3 Book / short / translation (sparse, one world)
- Read each chapter; brief **≤ 1 image**; many chapters get none. Opener when a new
  place or character enters; tailpiece when the chapter ends on an imageable beat;
  plate only for set-pieces. Restraint is the design.
- Slots are small (tailpiece ≤ 45 mm, spot ≤ 30 mm) except plates; treatments spot,
  ornament, vignette, occasionally cutout for a chapter-turning object.
- Ornaments (chapter rule motifs, drop-cap frames) are drawn once and reused.

### 5.4 Storyboard
- One panel per shot from the shot list; line or tonal only unless the world says
  colour; camera notes drive composition (shot size, angle, movement arrow).
- Cast consistency matters more than finish; sheet refs on every panel.

### 5.5 Cover
- Subject = the work's one image (the object/figure the whole story orbits) or a
  typographic lockup. Leave the type-safe area (Design §10) quiet. Produce 3
  candidates differing in scale (close / mid / wide), same technique.

---

## 6. Post-processing for placement

| treatment | operation | check |
|---|---|---|
| cutout / spot / ornament | background removal → alpha PNG; erode 1 px, feather 0.5 px; drop shadow **never** | silhouette closed; no halo; `subject_box` computed |
| vignette | radial alpha mask, 60 % → 0 % from centre to frame | fade reaches paper |
| watercolor-bleed | noise-displaced alpha edge (8–14 px amplitude) | 6 mm clearance from text respected by Design |
| duotone | map luminance to paper → ink; optional hue for 10 % highlights | contrast under text ≥ 4.5 |
| wash / tile | opacity 12–20 %; tile: seamless crop | text contrast still passes |
| plate / full-bleed | upscale to ≥ 300 dpi at frame size + bleed | no upscaling artefacts at edges |

Report back `asset` (Design §11) with `alpha`, `subject_box`, `gaze`, and
`palette_check` (dominant 5 colours within ΔE 12 of paper/ink/hue/field family).

---

## 7. Recurring characters (cast sheet)

Before the first story image: for each named recurring character render 3 candidate
sheets (front, side, expressions) in the world's technique on plain ground; approve
one. Every brief with `characters[]` attaches the sheet refs (identity weight 0.6;
storybook 0.75) and the trait line in the prompt; wardrobe changes are explicit in
the brief. Engines without reference conditioning mark the asset
`identity: prompt-only` so review looks harder. A vision check on each placed image
("same character? list differences") fails the asset on mismatch.

---

## 8. Reuse before creation

Query the library by `subjectKey` and `world` first. Mascots, ornaments, mastheads,
textures, chapter motifs and cast sheets are **made once, approved once, placed
thereafter**. New art is created only when nothing approved fits, and it enters the
library on approval. Never train or export on assets whose licence forbids it (stock,
hosted-engine outputs with restrictive terms).

---

## 9. Review checklist (fail → re-brief or re-render, ≤ 2×)

1. Subject not traceable to the text · 2. Technique word missing or contradicted ·
3. Realism where forbidden · 4. Character mismatch vs sheet · 5. Anachronism / setting
violation · 6. Text zone not quiet · 7. Gaze off-page for a cutout · 8. Cutout with
halo or open silhouette · 9. Palette check warn on a dominant · 10. Same treatment as
the previous unit · 11. Two cutouts in a row (storybook) · 12. Reusable asset
re-created instead of placed · 13. Text rendered inside the image · 14. Resolution
below 300 dpi at frame size.

---

## Quire binding (the only engine-specific part)

Ships as `packages/core/skills/quire-illustration/SKILL.md`, bound to `design.artplan`
(ArtDirector, 08 §4) and `design.review`. `policy` = `artPolicy` from the production
registry; `world` = `DesignWorld` (08 §2); cast = Cast Sheet (08 §9); library = the
gallery + Design Kit (04, 07 §1b); brief → `art/briefs/<unit>-<k>.json` and
`composeImagePrompt()` (08 §3); engine = `renderImage()` router (Comfy / Canva, 09 §5,
23 §3); post-processing = the rembg / mask workflows (09 §1) or Affinity AI Studio
(23 §4); §9 feeds the image↔text coherence audit (19 §5c).
