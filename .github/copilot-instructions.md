# Copilot Instructions

## Project Overview

This is a **Phaser 3** (v3.88.2) HTML5 game project. The target game is a **Zoo Keeper Playable Ad** — a ~45–60 second mobile-first playable ad described in `GDD_Zoo_Keeper_Playable_Ad.md`. The current code is a starter scene; the GDD describes the full game to be built.

## Running the Game

No build system. Phaser is bundled as a local `phaser.js` file. Because `src/main.js` uses ES modules (`type="module"`), the game **must be served over HTTP** — it will not work when opened as a `file://` URL.

```bash
# Any static server works, e.g.:
npx serve .
# or
python -m http.server
```

Then open `http://localhost:<port>` in a browser.

## Architecture

```
index.html          ← single entry point; loads phaser.js then src/main.js
src/
  main.js           ← creates Phaser.Game; registers all scenes in the scene array
  scenes/
    Start.js        ← (and future scenes) — one class per file
assets/             ← static images and spritesheets loaded at runtime
project.config      ← INI file: game title, canvas dimensions, Phaser version
```

- **Canvas size:** 1280×720, scaled with `Phaser.Scale.FIT + CENTER_BOTH`.
- **Renderer:** `Phaser.AUTO` (WebGL, falls back to Canvas).
- `pixelArt: false` — assets are smoothed, not pixel-perfect.

## Scene Conventions

Every scene is an ES module class extending `Phaser.Scene`:

```js
export class MyScene extends Phaser.Scene {
    constructor() { super('MyScene'); }
    preload() { /* load assets */ }
    create()  { /* build scene */ }
    update()  { /* per-frame logic */ }
}
```

- Register new scenes by importing them in `src/main.js` and adding to the `scene: []` array.
- Scene keys (the string passed to `super()`) must be unique and match any `this.scene.start('Key')` calls.
- Assets are loaded in `preload()` and first used in `create()` — never load assets outside `preload()`.

## GDD Key Constraints

The `GDD_Zoo_Keeper_Playable_Ad.md` specifies hard rules that affect implementation:

- **No physics engine** — no `RigidBody` or Ammo.js. All movement uses `setPosition` / direct transform manipulation. Proximity detection uses manual distance checks, not collision events.
- **Max 3 particle systems** — all other motion must use tweens (scale, position, color).
- **5 MB total asset budget** — keep assets minimal; music is the first cut if near the limit.
- **Single-file delivery target** — final output will be a self-contained `index.html` with assets base64-encoded (base64 inflates binary ~33%, budgeted for).
- **Interaction model** — virtual joystick for movement + proximity bubble tap for all actions; no drag, no gesture recognition needed.
