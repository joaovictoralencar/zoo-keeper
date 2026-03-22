# Copilot Instructions

## Project Overview

This is a **Phaser 3 + enable3d** playable ad — a mobile-first 3D game built in TypeScript with a Webpack build system. The target experience is the **Zoo Keeper Playable Ad**: a ~45–60 second interactive 3D game described in `GDD_Zoo_Keeper_Playable_Ad.md`.

## Tech Stack

| Layer | Library | Version |
|---|---|---|
| 2D engine | Phaser | 3.88.2 |
| 3D extension | @enable3d/phaser-extension | 0.26.1 |
| 3D renderer | Three.js | 0.171.0 |
| Physics | Ammo.js | **disabled** (`usePhysics: false`) |
| Language | TypeScript | 4.9.x |
| Bundler | Webpack | 5.x |

## Running the Game

```bash
npm install
npm run start   # dev server with hot reload → http://localhost:8080
npm run build   # production build → dist/
```

`dist/` is auto-generated — never edit it manually.

## Architecture

```
src/
  scripts/
    game.ts                 ← Phaser.Game config + enable3d bootstrap
    scenes/
      GameScene.ts          ← main 3D scene (extends Scene3D, ~770 lines)
    zoo/
      AnimalWander.ts       ← kinematic wander AI for animal models
  assets/
    character-male-e.glb    ← player character (with idle + walk animations)
    pets/                   ← animal GLBs: animal-monkey, animal-elephant, animal-lion
    food/                   ← item GLBs: banana, barrel, turkey; icons/ subfolder
    graveyard/              ← environment props: iron-fence-border.glb
  index.html                ← HTML template (processed by HtmlWebpackPlugin)
webpack/
  webpack.common.js
  webpack.dev.js
  webpack.prod.js
GDD_Zoo_Keeper_Playable_Ad.md
```

## Scene Conventions

`GameScene` extends `Scene3D` from enable3d:

```typescript
export default class GameScene extends Scene3D {
  constructor() { super({ key: 'GameScene' }) }

  init() {
    // MUST be called first — bootstraps the Three.js renderer
    this.accessThirdDimension({ usePhysics: false, antialias: true })
  }

  async create() { /* load assets, build scene */ }
  update(_time: number, delta: number) { /* per-frame logic; dt = delta / 1000 */ }
}
```

Key enable3d APIs used:

```typescript
this.third.scene          // Three.js Scene — add all 3D objects here
this.third.camera         // PerspectiveCamera
this.third.load.gltf(path)           // returns Promise<GLTF>
this.third.animationMixers.create(model)  // AnimationMixer wrapper
this.third.warpSpeed(...)            // enable3d preset helpers (pass '-name' to skip)
```

Phaser 2D overlay (`this.add.text()`, `this.add.graphics()`, etc.) renders on top of the 3D layer and works normally.

## No Physics — Manual Everything

Ammo.js is **explicitly disabled**. This is intentional for playable ad delivery.

| What you'd normally use physics for | How we do it instead |
|---|---|
| Character movement | `player.position.x += dx * SPEED * dt` |
| World boundaries | `Math.max(X_MIN, Math.min(X_MAX, player.position.x))` |
| Proximity detection | `Math.hypot(a.x - b.x, a.z - b.z) < INTERACT_RANGE` |
| Collision | Handled visually — fence GLBs have no collider |

**No RigidBody, no colliders, no collision events** anywhere in the codebase.

## Interaction System

Every interactable object implements this interface:

```typescript
interface Interactable {
  id: string
  getWorldPos: () => Vector3       // 3D position for bubble placement
  action: () => void               // called on bubble tap
  isAvailable: () => boolean       // gate: phase + carry state
  bubbleLabel: string              // emoji fallback
  bubbleIcon?: string              // Phaser texture key (preferred)
  bubbleSprite?: Phaser.GameObjects.Container
}
```

Flow: player moves within `INTERACT_RANGE` → bubble appears (3D position projected to 2D screen) → player taps bubble → `action()` fires.

## Level Layout

Three enclosures along the X axis, path at Z = 0:

| Enclosure | Centre X | X range | Animal | Phase |
|---|---|---|---|---|
| Monkey | −9 | −13 to −5 | Monkey | `'monkey'` |
| Elephant | 0 | −5 to +5 | Elephant | `'elephant'` |
| Lion | +11 | +6 to +16 | Lion | `'lion_toy'` → `'lion_food'` |

Enclosure depth: Z = −3 (south fence with gate) to Z = −11 (back fence).
Player world bounds: X ∈ [−15, 20], Z ∈ [−12.5, 4].

## Per-Animal Zone Timer

The timer starts automatically when the player physically enters an enclosure (Z < −2.8 **and** correct X range). It pauses when they leave and does not restart unless `retryCurrentAnimal()` is called. New state fields managing this:

```typescript
private timerStarted = false   // has zone been entered for current phase?
private timerActive  = false   // is the countdown currently running?
```

## GDD Key Constraints

| Constraint | Value |
|---|---|
| Duration | ~45–60 seconds |
| Build size limit | 5 MB total |
| Delivery target | Single self-contained `index.html` with base64 assets |
| Platform | Mobile-first, portrait 540 × 960 |
| Physics | None (Ammo.js disabled) |

Base64 inflates binary assets ~33%, so the 5 MB limit maps to ~3.75 MB of raw files.

## Asset Budget

| Category | Budget |
|---|---|
| 3D models (GLB) | ~900 KB |
| Animations (baked into GLBs) | ~300 KB |
| Textures | ~600 KB |
| Environment props | ~300 KB |
| UI sprites | ~150 KB |
| Audio | ~600 KB |
| Code + HTML | ~200 KB |
| Buffer (base64 inflation) | ~800 KB |
| **Total** | **~4.0 MB** |

If near the limit, cut the music loop first — keep SFX only.

## Current Game State (March 2026)

| Feature | Status |
|---|---|
| Player character (GLTF, idle/walk anims) | ✅ |
| Virtual joystick movement | ✅ |
| Three enclosures with animals | ✅ |
| Proximity bubble interaction system | ✅ |
| Item pickup + carry stack (max 2) | ✅ |
| Phase-based flow: monkey → elephant → lion → endcard | ✅ |
| Locked silhouette animals | ✅ |
| Animal wander AI | ✅ |
| Fence placement with gate opening | ✅ |
| Per-animal zone-based timer with animal emoji HUD | ✅ |
| Tutorial overlay at game start | ✅ |
| World movement bounds | ✅ |
| Improved level design (meshes, paths) | ⚠️ WIP |
| Single-file HTML delivery | 🔲 Planned |