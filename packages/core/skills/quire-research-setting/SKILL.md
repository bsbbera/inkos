---
name: quire-research-setting
description: "Turns a work's time and place into sourced, usable material - a setting bible of concrete nouns rather than adjectives, a lexicon of preferred and impossible words, and honest open questions - so authentic detail goes into the prompt instead of generic texture being scrubbed out afterwards. Use for setting research and anachronism work, not for plot or market questions."
version: 1.0.0
---
# Setting research

Apply this method when a work's period, place or culture is being researched,
or when a setting bible is being written, extended or checked.

The rule this exists for is **research in, slop out**. A story set in Calcutta
in 1943 that gets only the year will invent the century from training averages,
and the result is exactly the generic texture a cleanup pass then tries to
remove. Putting real material into the prompt is the cheaper order.

## Material, not adjectives

Write nouns a writer can put on the page. "Atmospheric" is not material.
"Kerosene, because the mains went off at nine" is.

- Every number, price, date and name comes from a source. Cite it.
- What you cannot source goes under **open questions**, not into the prose.
  A confident invented detail is worse than an admitted gap, because nothing
  downstream can tell the two apart.
- Prefer the ordinary over the notable. A reader is placed by what a meal cost
  and how a door locked, not by the famous events of the year.
- Research the **lens**, not just the coordinates: a mill worker and a
  magistrate in the same city in the same year live in different worlds, and
  the bible should be written for the one the story follows.

## The bible's fixed sections

These headings are fixed, because slices are retrieved by name later:

`Daily life & objects` · `Money, prices & work` · `Speech & register` ·
`Social norms & institutions` · `Technology & media` · `Place & senses` ·
`Calendar` · `Anachronism blacklist` · `Open questions`

Each researched section is 6–12 short bullet lines. Answer one section at a
time, as JSON only:

```json
{"lines": ["Trams ran until 11pm on the Chowringhee route [2]"],
 "unknown": ["whether the curfew moved the last tram earlier"],
 "sources": [2]}
```

## The lexicon

The blacklist is the important half, because it is the half a machine can
enforce. `forbidden` is anything that did not exist then or there — including
modern generic English a careless writer reaches for by default. One line of
reason each, and only terms that would plausibly turn up in prose.

```json
{"prefer": [{"term": "tram", "for": "streetcar"}, {"term": "dada", "gloss": "elder brother"}],
 "forbidden": [{"term": "okay", "reason": "Americanism, not in this speech"}],
 "addressForms": [{"speaker": "child", "to": "father", "form": "Baba"}],
 "currency": {"unit": "rupee", "sub": "anna"}}
```

## Fidelity is the user's call, not yours

- **strict** — a contradiction with the research is a blocking finding.
- **flavour** — the research colours the prose; contradictions warn.
- **loose** — material is available, nothing is enforced.

A secondary world or a speculative setting still gets a bible; it is simply
authored rather than searched, and its blacklist is what the world itself
forbids. Do not tell a user their invented world cannot be researched — tell
them which sections they have to decide instead.

## Do / don't

- **Do** say plainly when the sources disagree, and record both.
- **Do** keep the research out of canon. It guides chapters; it does not
  overrule what the work has already established about itself.
- **Don't** let a single source carry a number. A price with one citation is a
  claim, not a fact.
- **Don't** pad the bible to look thorough. Twelve sourced lines beat forty
  plausible ones, and the forty are what a reader recognizes as filler.
- **Don't** turn research into drafting. Answer the question asked; writing is
  a separate, confirmed step.
