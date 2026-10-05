---
name: quire-magazine-page
description: "Authors one magazine page as a single bundle - copy, page furniture and image briefs written together against the section's world, the archetype's density budget and the audience's reading bar, so the words are already layoutable when they arrive. Use for magazine and publication page authoring, not for prose chapters."
version: 1.0.0
---
# Magazine page authoring

Apply this method when writing a page of a publication issue.

A magazine page is not prose that gets designed afterwards. The copy, the
furniture and the pictures are one decision, and a page written without them is
a page the layout has to fight. **One turn produces the whole bundle.**

## What you are given

- The **section brief** — what this run of pages is for, and the question it opens on.
- The **world spec** — the section's visual world; its prompt fragment is appended to
  every brief you write, so do not restate its style in your own words.
- The **archetype and density** — `L`, `M` or `H`, which is a word budget, not a mood.
- The **pillar** and **premise** — the one idea this page carries.
- **Sources** — facts already gathered. A fact with no source is not a fact yet.

## The writing bar

These are checked automatically, per page, before the content gate, and they
fail loudly. Write to them the first time rather than being sent back.

| Reader | Avg words/sentence | Grade | Longest paragraph | Words: light / feature / dense |
|---|---|---|---|---|
| around 5 | 12 | 4 | 45 | 60 / 120 / 180 |
| around 9 | 14 | 6 | 60 | 120 / 220 / 300 |
| teen | 18 | 8 | 90 | 180 / 350 / 450 |
| general | 20 | 10 | 110 | 180 / 350 / 450 |
| expert | 26 | 14 | 160 | 350 / 500 / 650 |

Chinese counts characters where the table says words.

Then, in order of how often they are the reason a page comes back:

- **Never open on a definition.** "A volcano is a mountain that…" is a failed
  first sentence for every reader, including experts. Open on a concrete scene
  or object; the definition comes second, in one sentence, if at all.
- **One idea per page.** The premise is the idea. A second idea belongs on a
  different page, not in a second half.
- **Compare every big number to something the reader already holds.** `150
  tonnes` fails; `150 tonnes — as heavy as 25 elephants` passes. Words that
  satisfy the check are `as heavy/big/tall/long/fast as`, `than`, `times`,
  `like`, `the size of`, `enough to`.
- **Source every did-you-know.** A `didyouknow` or `fact` block without a
  `source` is flagged, and a spread with no such block at all is flagged too.
- **No subject labels.** Section names are ways of looking — "Zoom in", "Long
  ago", "What if" — never "Physics", "Biology", "History". Three words at most.
- **Explain or chip every hard noun.** A word the reader would not know either
  gets explained in the sentence that uses it, or becomes a glossary chip. It
  never just stands there.
- **Open a feature on a question the page then answers.** Either the first block
  is a `question` or the deck ends in `?`.

## The section spine

A section is three beats across its pages: **wonder → how → so what**. Know
which beat this page is before writing a word. A page that restates its
neighbour's beat is why sections read flat, and the section — not the page — is
what the person approves.

## Every page is a stop on the web

The magazine takes one thing and follows it through every connection. A page
that stands alone, however good, is a page from some other magazine.

- **Build the bridges you were given.** The page arrives with the pages it is
  tied to and the word they share. Write that tie into the text the way a
  person would say it — "the same blue the farmers of Champaran refused to
  grow" — not as a cross-reference. A bridge left unwritten is caught by the
  audit and the page comes back.
- **Let the threads surface.** A thread is a moment, a person, a place or an
  object that recurs. It reappears in passing, from this page's own side, never
  as a recap.
- **Subheads are twists.** Read alone, in order, they tell the story: "Before
  blue had a name", "The blue that begins green". Never a label.
- **The wonder moment is told more than once,** each time from a different
  side — the chemist's, the dyer's, the reader's.
- **The last page answers the first.** The closing page returns to the
  question the issue opened on, with what the reader now holds, and ends in
  their own hands. No summary, no moral.
- **Keep the hard parts in.** Who was exploited, who resisted, what it cost.
- **Voices are real or absent.** A quotation only when the research holds
  those exact words with a source. Otherwise describe the person's work and use
  no quotation marks.

## Output contract

One JSON object, nothing else.

```json
{
  "title": "The animal that never sleeps",
  "deck": "How do you rest when stopping would kill you?",
  "body": "markdown for the page, inside the word cap",
  "pullQuote": "Half a brain at a time.",
  "furniture": [
    {"kind": "didyouknow", "text": "A dolphin sleeps one half of its brain at a time.", "source": "src-114"},
    {"kind": "bignumber", "text": "15 years — as long as a dolphin can go without ever fully sleeping", "source": "src-118"}
  ],
  "image_prompts": [
    {"prompt": "a bottlenose dolphin just under a bright surface, seen from below, one eye open", "orientation": "landscape"}
  ],
  "sources": ["src-114", "src-118"],
  "uncertain": ["whether the 15-year figure covers captive animals too"]
}
```

- `furniture` kinds in use: `didyouknow` / `fact`, `bignumber` / `stat`,
  `question`, `timeline`, `vs`, `process`, `map`, `glossary`. The design layer
  decides whether one renders as vectors or as a picture — that is not your call.
- `image_prompts` may be empty. A type-only page is a legal page, and inventing
  a picture to fill the field is how a spread ends up decorated rather than
  illustrated.
- Write the subject, action, setting, composition and light. Do **not** write the
  style: the world's own fragment is appended after yours, and two style
  statements fight.
- `uncertain` is for what you could not confirm. It costs nothing and is the
  only thing standing between a confident sentence and a wrong one.

## Do / don't

- **Do** cut to the cap rather than writing long and hoping. Over-cap is a hard fail.
- **Do** let the furniture carry the numbers and the surprises, so the body can stay a
  single clean line of thought.
- **Don't** write a caption that repeats the sentence beside it.
- **Don't** use a decorative detail nothing later needs.
- **Don't** restate the section's world, palette or technique in prose. It is already
  law, and repeating it in a brief only competes with it.
