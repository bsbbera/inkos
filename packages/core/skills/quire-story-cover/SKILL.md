---
name: quire-story-cover
description: "Cover direction and generation from the work itself - title, genre, protagonist, central conflict, emotional promise, platform and display size - treating the user's visual instructions as authoritative and keeping deterministic typography separate from image generation. Use for cover strategy, prompts and confirmed generation."
version: 1.0.0
---
# Story cover

Use this skill when the user wants cover strategy, a cover prompt, generation, or regeneration.

- Start from the actual work: title, genre, protagonist, central conflict, emotional promise, platform, and display size.
- Treat the user's visual instructions as authoritative. Do not impose a fixed Quire house style, watermark, frame, collage, typography, or text prohibition.
- Distinguish a mobile book cover, cinematic key art, interactive-world scene image, character image, and item image. They serve different purposes.
- In chat, discuss or propose the action. Generate only through the available `generate_cover` confirmation path.
- Do not promise textual accuracy from an image model. If deterministic title layout is available, separate background generation from typography.
- Keep the cover faithful to the finished content; do not advertise events absent from the story.
- Respond in the user's language.

Load `references/cover-brief.md` when converting a manuscript into a production-ready visual brief.
