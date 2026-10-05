---
name: quire-long-story-analysis
description: "Deconstructs a novel or long sample into transferable craft - reader promise, conflict escalation, motivation, information release, scene function, volume rhythm, prose behaviour - with evidence pointers and no borrowed expression. Use for analysis and comparison, not for drafting."
version: 1.0.0
---
# Long-form story analysis

Use this skill when the user asks to deconstruct, compare, learn from, or continue from a long novel or substantial sample.

- Preserve the source as traceable material with `ingest_material` when it comes from a file, PDF, URL, or upload.
- Analyze semantic mechanisms: reader promise, conflict escalation, character motivation, information release, scene function, emotional payoff, volume rhythm, prose behavior, and continuity load.
- Keep source evidence pointers. Separate direct observation from inference.
- Extract reusable craft, not names, wording, scene order, or signature combinations.
- If the user explicitly wants the active book to consult this source later, call `manage_book_reference(action="bind")` with the user's natural-language purposes. Binding is guidance, never canon.
- If the user only asks a question, answer it; do not start writing or editing a book.
- Respond in the user's language.

Load `references/analysis-lens.md` only for a full decomposition or comparison deliverable.
