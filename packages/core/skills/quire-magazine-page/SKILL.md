---
name: quire-magazine-page
description: "Authors one magazine page as a single bundle - copy, furniture, picture briefs and, under a bilingual brand, its Bengali line and word box - written together so the words arrive already layoutable and already in the brand's voice. Use for magazine and publication page authoring, not prose chapters."
version: 2.0.0
---
# Writing one magazine page

The copy, the furniture and the pictures are one decision. A page written without its furniture is a
page the layout has to fight. **One turn produces the whole bundle.**

## Voice

Under a brand, its voice is the page's voice. Ochin: an elder sibling at the window - curious, warm,
exact. Simple enough for a ten-year-old to follow, layered enough that an adult keeps finding more. It
asks before it tells, names real people, and admits what nobody knows yet. It never says "Discover the
amazing world of..." or "Did you know there are many fascinating facts...".

The promise behind the voice: we never pretend to catch the bird. A page shows where its open
question flies, who chased it before, and what is still unknown.

## The bar (checked per page, before the content gate)

| reader | words/sentence | longest paragraph | words: light / feature / dense |
|---|---|---|---|
| around 9 | 14 | 60 | 120 / 220 / 300 |
| teen | 18 | 90 | 180 / 350 / 450 |
| general | 20 | 110 | 180 / 350 / 450 |
| expert | 26 | 160 | 350 / 500 / 650 |

Over the cap is a hard fail: cut, never hope.

## How a page is written

- **Open on a scene or an object**, never a definition. The definition, if any, comes second, in one sentence.
- **One idea per page.** The premise is the idea; a second idea is a different page.
- **Open a feature on a question** the page then answers: a question block, or a deck ending in "?".
- **Every big number gets something the reader already holds**: "150 tonnes - as heavy as 25 elephants".
- **Every hard noun** is explained in its own sentence or becomes a glossary chip.
- **Subheads are twists**, read alone in order they tell the story. Never labels.
- **Section names are ways of looking** ("Zoom in", "Long ago", "What if"), three words at most.
- **Build the bridges you were given**: write the tie to the neighbouring pages the way a person would say it.
- **Threads surface in passing**, from this page's side, never as a recap.
- **Keep the hard parts in**: who was exploited, who resisted, what it cost.
- **Voices are real or absent**: a quotation only when the research holds those exact words with a source.
- **The last page answers the first**, and ends in the reader's own hands. No summary, no moral.
- **A section is wonder -> how -> so what.** Know which beat this page is before writing.

## Two languages (bilingual brands)

Ochin: English carries the reading; Bengali carries the heart. Write title, deck and body in English.
Then, as furniture (always allowed, whatever the archetype):

- `{"kind": "wordbox", "text": "<Bengali word> | <how it sounds> | <what it means, under 18 words>"}` -
  when a Bengali word names this page's idea better than English (ছায়া, chhaya: shadow, and also
  shelter). At most one, features only.
- `{"kind": "bengali-line", "text": "<one line of Bengali> | <its English>"}` - on the page that opens
  or closes a story: an epigraph, a line from a real Bengali source (Lalon, Tagore, a proverb), or a
  closing line. Quoted lines must be real; otherwise write your own and do not attribute it.

Bengali is never a translation of the English beside it, and never more than one line. Write it in
Bengali script; the build shapes it.

## Pictures

As many briefs as the page actually wants - often none. Each names things and where they sit, in forty
to sixty words, with a role (hero, inset, diagram, portrait, detail, background) and an orientation.
No style, no lighting, no lens talk: the brand's picture style is prefixed by code, and a brief that
describes a photograph gets a photograph. A real person or place wants a real photograph, which
research finds; an exact thing (a scale, a timeline, a curve) wants a measured figure, which design
draws. Never brief an ornament - borders, stitches, birds and alpanas are the brand's shapes.

## Output

One JSON object, nothing else.

```json
{
  "title": "The window at Le Gras",
  "deck": "A roof, a pear tree and eight hours of sun: what does the oldest photograph remember?",
  "body": "plain prose, blank line between paragraphs, inside the word cap",
  "pull_quote": "Where light fell, the bitumen hardened.",
  "furniture": [
    {"kind": "pull-number", "text": "8 hours - as long as a school day, for one picture", "source": "https://..."},
    {"kind": "wordbox", "text": "ছায়া | chhaya | shadow, and also shelter: every photograph is made of what the light did not reach"}
  ],
  "image_prompts": [{"prompt": "a pewter plate on a stone window sill, a roof and a pear tree outside", "orientation": "landscape", "role": "hero"}],
  "sources": ["https://..."],
  "uncertain": ["whether the exposure was eight hours or several days"]
}
```

- Furniture kinds are the archetype's allowed ones (pull-number, sidefact, did-you-know, question,
  timeline, vs, process, map, glossary), plus the two bilingual kinds under a bilingual brand.
- Every fact block carries its `source`. `uncertain` costs nothing and stands between a confident
  sentence and a wrong one.
- A caption never repeats the sentence beside it; a decorative detail nothing later needs is cut.
