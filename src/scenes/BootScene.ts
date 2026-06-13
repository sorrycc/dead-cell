import Phaser from 'phaser'

// ── BootScene (design §6.0, AC3/AC4) ──
// The FIRST registered scene, so it auto-starts. Phase 0 has no assets to load
// (programmer-art only, Decision 4 — no network load.* calls, runs offline / from
// file://), so Boot does its (currently empty) one-time setup and immediately hands off
// to Title. Later phases may bake a few solid-color textures here via
// make.graphics().generateTexture() for reuse; that hook lives in create().
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot')
  }

  create(): void {
    // (Phase 1+: bake reusable primitive textures here.)
    this.scene.start('Title')
  }
}
