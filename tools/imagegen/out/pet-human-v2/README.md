# Pet Human V2 Effects

Handoff status (2026-08-22): local V2 intake is complete. Source image `N.webp` maps to
template `human-effect-NN`; all images are normalized to `720x1280`, prompt records and
planned object keys are registered, and the retired 12-template experiment is absent from
the active registry. Nothing has been uploaded, seeded, frozen, or marked live.

Place the new self-owned effect images in `effects/`.

- Filename: `<id>.webp` (`1.webp` through `40.webp` for this batch)
- Prompt catalog: `apps/platform/src/server/pet-human-effect-prompts.json`
- Catalog shape: `[{ "id": "human-effect-NN", "prompt": "<template-specific prompt>" }]`

These source files are staging inputs only. They are not bundled into the Mini Program.
Before a template becomes live, its image is uploaded to object storage and the same object is
used both as the public template sample and as Image 2 in the generation request.
