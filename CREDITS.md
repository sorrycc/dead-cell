# Credits

## Art & audio

**Programmer-art only.** Every visual in Dead Cell is generated in code from colored
rectangles and simple shapes (Phaser `Graphics` + generated textures). There are **no external
sprite, image, font, or audio assets** — nothing is downloaded or bundled from third parties.
The game runs fully offline (and from `file://`).

This is a deliberate constraint: zero asset licensing, zero network fetches, instant boot.

## Code & libraries

- **[Phaser 3](https://phaser.io/)** — 2D game framework (MIT License).
- **[Vite](https://vitejs.dev/)** — build tool / dev server (MIT License).

The seeded PRNG (`mulberry32`, in `src/util/rng.js`) is a public-domain algorithm, used
verbatim from the sibling `crowd-runner` project for cross-compatible deterministic seeds.

## License

Original game code in this repository is the author's own. Third-party libraries retain their
respective licenses as noted above.
