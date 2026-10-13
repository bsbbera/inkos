---
name: quire-illustration
description: How Quire decides what a picture shows and how it is made - brand first. Under a brand (core/brands/<id>) the picture style, palette and ornaments are the brand's and are not yours to change; you decide the subject from the text, the surface (photograph, illustration, measured figure, brand shape) and the brief. Covers sensing, briefs, cutouts, recurring characters, reuse and review, for magazines, books, storybooks, storyboards and covers. Composition belongs to quire-editorial-design.
version: 2.0.0
---

# Illustration, brand first

A picture is **derived from the text**, never decorated onto it. Design hands you a slot (frame,
role, treatment, the tone where type will sit, the zone to keep quiet); you return a subject and a
brief an engine can execute, and judge what comes back.

## 1. What is fixed, and by whom

- **Under a brand** the picture style is the brand's (Ochin: opaque gouache, flat colour, visible
  brush, warm paper showing through, in the brand's own colours; no gold, no neon, no gradients, no
  3D). It is prefixed to every brief by code. Do not restate it, fight it, or describe a camera.
- **Without a brand** the editor's pinned image style holds if there is one; otherwise one technique
  per world, its technique word verbatim in every brief of that world.
- **Ornament is never generated.** Borders, stitches, alpanas, birds and panels are the brand's
  shapes, drawn by its kit at the build (quire-editorial-design §7). Never ask a generator for them.

## 2. Choosing the surface

| the content is | surface | how |
|---|---|---|
| a real person, place, object or event | **photograph** | a real, licensed one (public domain / open licence), source and licence recorded, credited; never recoloured into the palette; cropped with intent |
| an exact thing: a number, scale, curve, wavelength, layer order, timeline | **measured figure** | vectors drawn to real data; never a generated picture; never a number the sources do not hold |
| an idea, a scene, an animal, a feeling, how something works | **illustration** | the brand's picture style, a plain subject on a flat ground |
| a threshold, a connection, a question, an ending | **brand shape** | lal paar, kantha, bird, alpana... (design decides; you never brief these) |
| a page whose word is the picture | **typographic** | nothing to generate |

No invented portraits: with no honest photograph of a person, design sets their initials in a disc.

## 3. Sensing the subject

Read the whole unit first. A subject is something a reader could point to in the text: an action,
an object, a face, a place at a moment. Not a mood, not a theme.

1. Find the beat - the moment the unit turns. One beat per picture; the dominant slot gets the
   strongest.
2. The thing over the idea: "a pewter plate drying on a window sill" beats "the dawn of photography".
3. Eye level of the reader: young readers see one figure doing one thing; adults get systems and details.
4. What the text does not say may not appear: no invented characters, wrong-era objects or props
   that contradict the setting.
5. A world topic keeps its own art inside the brand's frame: Hokusai's wave stays Hokusai's.

## 4. The brief

Forty words, sixty at most. Name the things and where they sit; give the role (hero, inset, detail,
portrait, diagram) and the orientation. No lighting, lens, film, "cinematic" or "high resolution".
No text or lettering in the picture. A few objects on a plain ground, not a room full of scenery -
the page's drawn colour, not the picture, carries the fields.

```yaml
slot: p14-1
subject: "a box camera on three legs, its brass lens toward a window, a hand lifting the lens cap"
subjectKey: box-camera-lens-cap
role: hero        orientation: landscape
treatment: cutout # plain subject, isolated, no ground shadow
mustNot: ["text", "modern camera"]
reason: "p14 para 2: Daguerre's sitters waited while the cap was off"
```

## 5. By production type

- **Magazine.** One to three slots per page, often none; surfaces by content (above). Sections differ
  in subject and in the brand colour pair the shapes are drawn in, never in picture style.
- **Storybook.** One picture per spread at the child's eye level; alternate full-bleed scene and
  white-ground cutout; the recurring cast present whenever the text names them.
- **Book / short.** At most one per chapter, often none: opener, tailpiece or a set-piece plate.
- **Storyboard.** One panel per shot; line or tonal; cast consistency over finish.
- **Cover.** The work's one image, or a typographic lockup; three candidates differing in scale;
  the title zone left quiet.

## 6. After generation

| treatment | operation | check |
|---|---|---|
| cutout / spot | background removed to alpha, 1 px erode, no shadow | closed silhouette, no halo, subject box measured |
| plate | the painted ground kept, its edge colour and grain measured | the page's shapes take that grain |
| full-bleed | upscaled to 300 dpi at frame size plus bleed | no edge artefacts |

Report the asset with alpha, subject box and gaze (a cutout's gaze points into the page).

## 7. Recurring characters

Before the first story picture, three candidate sheets per named character in the style, one
approved; every brief naming them carries the trait line and the sheet. A placed picture that does
not match the sheet fails.

## 8. Reuse before creation

Query approved pictures by subject key first. Mascots, cast sheets and recurring objects are made
once and placed thereafter. Never reuse a picture whose licence forbids it.

## 9. Review (fail -> re-brief or re-render, twice at most)

Subject not traceable to the text - off the brand's picture style or palette - realism where it is
forbidden - character mismatch - anachronism - text zone not quiet - cutout gaze off the page or a
halo - lettering in the picture - a generated picture where a measured figure or a real photograph
was owed - an ornament generated instead of drawn - resolution under 300 dpi at frame size.

## Quire binding

Given to the art-direction, art and cover stages by `core/skills/design-skills.ts`. Under a brand,
`brand.ts` sets every section's `imagePrompt` and `negative` to the brand's `imageStyle`; the
editor's pinned style applies to unbranded works. Picture briefs come from the page writer
(`image_prompts`) and the composer's slot `brief`; the router renders them (ComfyUI / Canva).
