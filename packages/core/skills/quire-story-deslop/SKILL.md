---
name: quire-story-deslop
description: "Finds and repairs vagueness, template phrasing, summary voice and other machine habits by reading function and effect rather than counting banned words, preserving plot facts, viewpoint, evidence and the author's own strong lines. Use for semantic prose cleanup, not keyword deletion."
version: 1.0.0
---
# Semantic prose cleanup

Use this skill when the user says prose feels generic, mechanical, over-explained, repetitive, or AI-generated.

- Diagnose by reading function and effect, not by counting banned words or applying global replacements.
- Distinguish a real defect from a legitimate voice choice. Repetition can be rhythm; abstraction can be intentional; short sentences can be pressure.
- Look for unsupported conclusions, emotion labels without scene evidence, generic transitions, symmetrical canned phrasing, repeated interpretation, decorative detail, summary replacing scenes, and dialogue that only transfers information.
- In an active book, audit first when scope is unclear. Use the reviser for an authorized rewrite; do not paste a replacement chapter into chat and claim it was saved.
- Preserve plot facts, viewpoint, character voice, evidence, pacing function, and strong original lines.
- Respond in the user's language.

Load `references/semantic-cleanup.md` for a passage-level diagnosis or revision brief.

## What the deterministic pass already catches

Five habits are counted before you are asked anything, and reported under these
names: **Paragraph length**, **Paragraph uniformity**, **Hedge density**,
**Formulaic transitions**, **List-like structure**. Do not re-report them. Your
job starts where counting stops.

## The habits counting cannot see

Each of these is a defect only when it is doing no work. Say which, and why.

- **Rule of three** — three parallel items where the third carries nothing the
  first two did not. Real triads build or break; decorative ones just fill.
- **Em-dash chains** — a second and third dash inside one sentence, each opening
  an aside the sentence never needed.
- **Negative parallelism** — "not X, but Y" used as a rhythm rather than as a
  correction of something the reader actually believed.
- **Summary voice** — a paragraph that reports what a scene would have shown.
  The tell is a verb of process ("they spent the afternoon arguing") where the
  argument was the point.
- **Emotion labels** — naming the feeling instead of the evidence for it.
- **Uniform sentence rhythm** — clause counts that never vary across a passage,
  so nothing can land harder than anything else.
- **Unearned conclusion** — an interpretive sentence closing a paragraph whose
  own content does not support it.
- **Decorative specificity** — a precise detail (a brand, a time, a colour) that
  nothing later uses.

## Output contract

When the cleanup is asked for as data rather than as conversation, answer with
this and nothing else — it is the shape the audit screen parses, and it is what
puts a working "accept this fix" control on the row.

```json
{"findings":[{
  "dimension": 22,
  "severity": "warning",
  "title": "Emotion named, not shown",
  "quote": "She felt a deep and terrible sadness.",
  "fix": "She read the second line twice, then put the letter face down.",
  "description": "The feeling is asserted; the scene has evidence for it two paragraphs up and does not use it.",
  "suggestion": "Cut the label and let the letter do the work."
}]}
```

- `quote` must be copied exactly from the passage. A paraphrase cannot be
  located, so the finding arrives with nowhere to sit.
- `fix` replaces that exact span and nothing wider. Omit it when the repair
  needs the paragraph rebuilt — then say so in `suggestion` and let the rewrite
  run at paragraph scope instead.
- Never emit a `fix` that deletes a line you merely dislike. Preserved voice
  beats a cleaner sentence.

## Do / don't

- **Do** read function and effect. A repeated word can be rhythm; a short
  sentence can be pressure; abstraction can be the point.
- **Do** leave strong original lines alone even when they sit beside a defect.
- **Don't** apply global replacements or delete on a word list. That is what
  makes prose sound scrubbed rather than written.
- **Don't** paste a replacement chapter into chat and call it saved. In an
  active book, audit first, then let the reviser apply an authorized rewrite.
