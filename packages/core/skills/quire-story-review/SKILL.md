---
name: quire-story-review
description: "Reviews prose against the standard the genre, target audience, tone and platform actually imply, showing concrete issues with severity, evidence and likely reader impact, and treating a parser or model-format failure as an audit failure rather than a verdict on the prose. Use for chapter or manuscript review with transparent criteria."
version: 1.0.0
---
# Story review

Use this skill when the user wants diagnosis, scoring, comparison, approval, or revision advice for existing prose.

- First identify the applicable standard from genre, target audience, tone, platform, and explicit user preference. Everyday comedy, literary fiction, romance, mystery, and commercial serials should not share one logic-density threshold.
- In an active book, use the auditor for persisted chapters. Show concrete issue descriptions, severity, evidence, and likely reader impact.
- A parser or model-format failure is an audit failure, not evidence that the prose is bad and not permission to rewrite it.
- Do not revise merely because an audit failed. Revise when the user asks, or when the confirmed workflow authorizes it; report whether the revised artifact was actually applied.
- Preserve the user's voice and successful passages. Prefer the smallest scope that resolves the real defect.
- Respond in the user's language.

Load `references/review-matrix.md` for a full review or when standards are disputed.

## Output contract

When the review is asked for as data rather than as conversation, answer with this
and nothing else. It is the shape the audit screen parses, and a finding that
arrives in any other shape is dropped rather than shown.

```json
{"findings":[{
  "dimension": 7,
  "severity": "warning",
  "title": "The limp changed legs",
  "quote": "favoured his right leg",
  "fix": "favoured his left leg",
  "description": "Chapter 4 established the left leg; this passage moves it.",
  "suggestion": "Restore the left leg, or show the second injury."
}]}
```

- `dimension` is the number of the criterion from the list you were given. An
  unrecognized number still carries the finding, so report under the closest one
  rather than dropping a real problem.
- `severity` is `blocking` only when the text contradicts something the work has
  already established — a fact, a name, a number, a rule it set itself. Use
  `warning` for what should change and `note` for what is worth knowing.
  **Only `blocking` stops the work being approved, so it is never for taste.**
- `quote` is text copied exactly from the passage, so the screen can find it. A
  paraphrase cannot be located and the finding loses its place in the text.
- `fix` is the replacement for that exact quote and nothing wider. A `fix`
  without a `quote` has no span to stand in and is discarded — omit it and let
  `suggestion` carry the advice instead.
- `title` is at most eight words naming the problem, not restating the rule.

## Do / don't

- **Do** state the standard you are judging against before the first finding.
- **Do** report the same passage once. Two findings on one span become two
  competing rewrites of it.
- **Don't** raise severity to get attention. An inflated `blocking` blocks a real
  gate and teaches the reader to force past it.
- **Don't** turn a failed parse into a prose verdict, and don't rewrite because
  an audit failed — revision is a separate, authorized step.
