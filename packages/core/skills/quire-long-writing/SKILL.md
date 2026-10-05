---
name: quire-long-writing
description: "Shared craft method for long-form fiction: scenes built on objective, resistance, turn and surviving consequence; character choice driven by want, knowledge, fear and cost; deliberate information release; revision that repairs the smallest layer actually at fault. Used by the architect, writer, auditor and reviser."
version: 1.0.0
---
# Long-form narrative craft

Apply this method inside the active architect, writer, auditor, or reviser operation.

- Turn the chapter goal into scenes with an immediate objective, resistance, a meaningful turn, and consequences that survive the scene.
- Let character choices follow what each person wants, knows, fears, and can afford. Relationships change through events, not author explanation.
- Reveal setting and backstory through action, evidence, dialogue, and sensory particulars. Do not replace a scene with a synopsis or analysis.
- Every passage must alter conflict, evidence, emotion, relationship, knowledge, position, or future consequence. Remove padding rather than stretching to a number.
- Control information deliberately: answer some active reader questions, deepen others through concrete evidence, and do not manufacture twists by hiding facts the viewpoint should know.
- Preserve the user's voice, viewpoint, prohibitions, proportions, and current direction. Genre convention is only a default when the governed context is silent.
- End a chapter after a material change or fresh pressure, not with a mechanical cliffhanger formula. Show the after-effect of major payoffs before starting another escalation cycle.
- Use references as evidence for craft or facts only. Do not reproduce source wording, names, scene order, or signature combinations.
- During review or revision, diagnose and repair the smallest layer that actually causes the problem. A formatting failure is not evidence that the prose is bad.

## When a style block follows

A `# Style Guide` block may be appended to your instructions. When it is, **it
wins over genre defaults** — the genre pack describes what books like this
usually do, and the style guide describes what *this* book does. Read it in
three parts:

- **The prose description** is the intent. Follow it.
- **`## Statistical Fingerprint`** is measured, not aspirational: sentence
  length, paragraph length, dialogue share, punctuation habits. Treat the
  numbers as a range to land inside, never as a quota to hit exactly — prose
  that matches a mean at every sentence reads more mechanical, not less.
- **`## The voice, in its own words`** holds real passages by this writer. Match
  their rhythm, punctuation and habits. Do not reuse their content, names,
  images or sentence order.

A block of the person's own accepted rules may follow all of that. Those are
decisions already made about this book; they outrank both the genre pack and
your own preference, and you do not relitigate them in the prose.

Writing in the voice beats restyling into it afterwards: a restyle is another
pass over the text, and text is what gets lost in passes.

## Scene ledger

When the run asks for a ledger alongside the prose, one row per scene, in order:

```json
{"ledger":[{
  "scene": 1,
  "pov": "Lin Ci",
  "where": "the archive, after midnight",
  "wants": "the third volume, before the censor returns",
  "resists": "the lock, and Wen knowing she was here",
  "turn": "the volume is already gone",
  "costs": "she has to ask Wen, which tells him she was looking",
  "knows_after": ["the volume left the building on the 4th"]
}]}
```

`turn` is what the scene changed. A scene whose `turn` restates `wants` did not
turn, and is the scene to cut or rebuild before the chapter goes on.
