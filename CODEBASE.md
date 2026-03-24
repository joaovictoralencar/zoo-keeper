# Zoo Keeper — Codebase Documentation
> A deep-dive reference covering every system, why it matters, and how it all fits together.
> Last updated March 2026 — reflects all refactoring sessions completed to date.

---

## Table of Contents
1. [Project Bird's-Eye View](#1-projects-birds-eye-view)
2. [Entry Point — `game.ts`](#2-entry-point--gamets)
3. [The Data Contract — `LevelData.ts`](#3-the-data-contract--leveldatats)
4. [The Level File — `level.json`](#4-the-level-file--leveljson)
5. [The Main Scene — `GameScene.ts`](#5-the-main-scene--gamesceents)
   - 5.1 [Lifecycle Methods](#51-lifecycle-methods)
   - 5.2 [World-Building Methods](#52-world-building-methods)
   - 5.3 [Character & Animals](#53-character--animals)
   - 5.4 [Items & Props](#54-items--props)
   - 5.5 [Interaction System](#55-interaction-system)
   - 5.6 [UI & HUD Systems](#56-ui--hud-systems)
   - 5.7 [Movement & Camera](#57-movement--camera)
   - 5.8 [Game-Loop Updaters](#58-game-loop-updaters)
   - 5.9 [Game Flow: Phases, Delivery, Fail & End](#59-game-flow-phases-delivery-fail--end)
6. [Animal AI — `AnimalWander.ts`](#6-animal-ai--animalwanderts)
7. [Utility Modules](#7-utility-modules)
   - 7.1 [Game Constants — `constants.ts`](#71-game-constants--constantsts)
   - 7.2 [Asset Loader — `AssetLoader.ts`](#72-asset-loader--assetloaderts)
   - 7.3 [World UI — `WorldUI.ts`](#73-world-ui--worlduits)
   - 7.4 [Bubble Factory — `BubbleFactory.ts`](#74-bubble-factory--bubblefactoryts)
8. [Audio System](#8-audio-system)
   - 8.1 [Sound Manager — `SoundManager.ts`](#81-sound-manager--soundmanagerts)
   - 8.2 [Audio Config — `AudioConfig.ts`](#82-audio-config--audioconfigts)
9. [Asset Map](#9-asset-map)
10. [Remaining Improvement Points](#10-remaining-improvement-points)

---

## 1. Project Bird's-Eye View

Zoo Keeper is a **mobile-first playable advertisement** — a bite-sized (~45–60 second) 3D casual game intended to sell a real Zoo Keeper mobile game to prospective players. Everything about the tech stack and architecture is shaped by that goal:

| Constraint | Why it matters |
|---|---|
| Single self-contained HTML file | Ad networks require zero external CDN dependencies |
| 5 MB budget | Mobile devices load ads over cellular; large files kill completion rate |
| No physics engine (Ammo.js disabled) | Ammo.js wasm alone is ~2 MB and adds async init complexity |
| Portrait 540 × 960 | Matches the typical phone screen where ads are shown |
| 45–60 second session | Long enough to feel satisfying; short enough to not overstay its welcome |

**Tech stack summary:**

```
Phaser 3          — 2D game engine: UI, input, tweens, audio
@enable3d         — Bridge that attaches a Three.js renderer to Phaser
Three.js          — 3D rendering: meshes, cameras, GLTF loading, animations
TypeScript        — Type safety across all game code
Webpack 5         — Bundles everything into the final HTML
```

The hybrid approach (Phaser 2D overlay on top of a Three.js 3D scene) is one of enable3d's core value propositions. It means you write familiar Phaser UI code (`this.add.text`, tweens, input events) and Three.js 3D code side by side without bridging frameworks.

**Project structure:**

```
src/scripts/
  game.ts                         ← Phaser.Game config + enable3d bootstrap
  constants.ts                    ← All magic numbers (sizes, speeds, radii)
  scenes/
    GameScene.ts                  ← Main 3D scene (~1650 lines)
  types/
    LevelData.ts                  ← TypeScript interfaces for level.json
  zoo/
    AnimalWander.ts               ← Kinematic wander AI + animation blending
  utils/
    AssetLoader.ts                ← GLTF cache with in-flight deduplication
    WorldUI.ts                    ← 3D→2D projection + screen-edge clamping
  ui/
    BubbleFactory.ts              ← Factory for action and purchase bubbles
  managers/
    SoundManager.ts               ← Reusable audio service (music + SFX)
    PhaseManager.ts               ← Phase state machine (current phase, advance, isDone)
  config/
    AudioConfig.ts                ← All audio volumes and timings in one place
```

---

## 2. Entry Point — `game.ts`

```
src/scripts/game.ts   (21 lines)
```

This is the smallest file but the most important starting point. It does three things:

### `Phaser.Game` config object
Defines the canvas size (540 × 960), scaling mode (`FIT` + `CENTER_BOTH`), the renderer (`WEBGL`), and which scenes to include. `transparent: true` lets the Three.js canvas behind Phaser show through.

**Why it matters:** The canvas dimensions set here are the coordinate space for every single Phaser UI element. Changing width/height here would require updating every hardcoded `x`/`y` value in GameScene. This is a single-scene game so `scene: [GameScene]` is the entire game.

### `Canvas()` spread from enable3d
`...Canvas()` injects extra Phaser config options that enable3d needs to attach its Three.js renderer. It's not optional — skip it and the 3D layer simply never initialises.

### `enable3d(() => new Phaser.Game(config))`
enable3d must wrap the `new Phaser.Game(...)` call to ensure its Three.js context is ready before Phaser tries to use it. The `window.addEventListener('load', ...)` guard ensures the DOM is fully ready before the game boots.

**Why it matters:** This is the canonical enable3d bootstrap pattern. Deviating from it (e.g. constructing `new Phaser.Game` outside the callback) will break Three.js initialisation silently.

---

## 3. The Data Contract — `LevelData.ts`

```
src/scripts/types/LevelData.ts   (125 lines)
```

This file defines **all the TypeScript interfaces** that describe a level. Nothing is hardcoded into GameScene — every value (positions, speeds, colors, model paths, phase rules) flows in through this shape.

### Key interfaces

| Interface | Role |
|---|---|
| `LevelData` | Root object — the shape of `level.json` |
| `WorldConfig` | Player speed, world bounds, interact range, timer duration |
| `EnvironmentConfig` | Sky/ground colors, path/enclosure floor colors and sizes |
| `FenceConfig` | Fence GLB path, segment sizing, gate panel count |
| `PlayerConfig` | Player GLB path, starting position, scale |
| `EnclosureConfig` | Per-cage ID, center position, zone boundaries, unlock cost |
| `AnimalConfig` | Per-animal model path, wander settings, target height, spawn position |
| `ItemConfig` | Pickup item type, model path, world position, icon textures |
| `PhaseConfig` | Which item is needed, which enclosure it goes to, what happens on completion |
| `PhaseOnComplete` | Stars awarded, next phase id, optional item reveal, endgame flag |
| `PropConfig` | Decorative prop model path and world transform |
| `TutorialConfig` | Tutorial steps and auto-dismiss timer |

**Why it matters:** This is the separation between *game logic* and *game data*. Adding a new animal, item, or level doesn't require touching TypeScript code — just update `level.json`. The TypeScript interfaces also catch typos in the JSON at compile time.

---

## 4. The Level File — `level.json`

```
src/assets/level.json   (165 lines)
```

This is the single source of truth for **all gameplay configuration**. It is loaded in `preload()` and immediately accessed as `this.ld` throughout the scene.

### Current level layout

Three enclosures run left to right along the X axis, with the player path at Z = 0:

```
X:  -15        -9         0         +11        +20
         [MONKEY]   [ELEPHANT]    [LION]
          free       25⭐          75⭐
```

### Phase chain
```
monkey (free)  →  elephant (25⭐ to unlock)  →  lion_toy (75⭐)  →  lion_food  →  done
```
Each phase requires the player to pick up a specific item and deliver it inside the correct enclosure. The lion has a two-step sub-sequence (toy first, then food) to create a pacing beat.

### What makes this powerful
By being pure JSON, `level.json` functions as a **no-code level editor**. A designer can:
- Add a new enclosure by appending an `EnclosureConfig` + matching `AnimalConfig` + `PhaseConfig`
- Adjust the game timer (`timerDuration`) without touching code
- Change the entire visual look (colors, sky) without touching code
- Reorder phases to change narrative flow

---

## 5. The Main Scene — `GameScene.ts`

```
src/scripts/scenes/GameScene.ts   (~1650 lines)
```

This is the heart of the project — the single Phaser scene that runs the entire game. It extends `Scene3D` from enable3d, which in turn extends `Phaser.Scene`, giving it access to both the Phaser API and the Three.js layer via `this.third`.

### 5.1 Lifecycle Methods

#### `init()`
Called before `preload`. **Must** call `this.accessThirdDimension(...)` here — this boots enable3d and attaches Three.js to the Phaser renderer. `usePhysics: false` explicitly disables Ammo.js to save the 2 MB wasm download. `antialias: true` is critical for visual quality on retina screens.

**Why it matters:** If `accessThirdDimension` is called anywhere other than `init`, the 3D layer may not be ready when `create` runs. This is one of the most common enable3d footguns.

#### `preload()`
Loads all UI images via Phaser's asset pipeline. These are 2D PNG files used in the HUD — not 3D models. 3D models (GLBs) are loaded later in `create()` via `this.third.load.gltf()` because they need the Three.js context to be ready.

**Why it matters:** Splitting asset loading this way (Phaser assets in `preload`, GLTF in `create`) is forced by the framework's two-phase boot. Understanding this split prevents "texture not found" errors.

#### `async create()`
The main setup method. The full order, as found in the source:

```
1.  Load level.json → this.ld
2.  Kick off Baloo 2 font load (non-blocking, fire-and-forget)
3.  Init purchasedEnclosures — enclosures with unlockCost=0 start open
4.  Lazy-load dynamic icon textures declared in items[] and phases[]
5.  this.third.warpSpeed()   — init Three.js scene, camera, lights
6.  buildEnvironment()       — ground, path, enclosure floors
7.  Promise.all([            — all five load methods run IN PARALLEL:
      loadFences()           —   fence GLB instances
      loadPlayer()           —   character GLB + animations
      loadAnimals()          —   all animal GLBs
      loadItems()            —   pickup item GLBs
      loadProps()            —   decorative scene props
    ])
8.  Init animalNeeds to 1.0 for all animals
9.  Hide items belonging to still-locked enclosures
10. setupInteractables()     — build interaction bubble objects
11. setupCamera()            — position and configure PerspectiveCamera
12. setupJoystick()          — create DOM joystick
13. setupUI()                — prestige bar, HUD, star counter
14. Init SoundManager (this.sfx) — create pre-loaded footstep sounds
15. Start BGM with fade-in
16. needsDrainActive = true  — start the timer system
17. _showTutorial()          — overlay tutorial hint
```

**Why the `Promise.all` matters:** Steps 7a–7e are fully independent — none reads data written by another. Running them in parallel means total load time equals the slowest single load, rather than their sum. On a slow connection this could be a 3–4× faster startup.

**Why it matters (SoundManager init order):** The SoundManager and pre-created footstep sounds are initialised after all assets are loaded. This ensures Phaser's audio context is warm and the keys are registered before any sound is played.

#### `update(_time, delta)`
Called every frame by Phaser. `delta` is milliseconds since the last frame; it's immediately converted to seconds (`dt = delta / 1000`) for physics-friendly math. Every per-frame system is called here as a named method — movement, camera, UI, AI, etc.

**Why it matters:** The clean per-system call pattern makes it trivial to add, remove, or disable individual systems for debugging. The `if (!this.player) return` guard prevents crashes during the async boot window.

---

### 5.2 World-Building Methods

#### `buildEnvironment()`
Procedurally builds the ground plane, path strip, and per-enclosure sand floors using Three.js `PlaneGeometry` + `MeshLambertMaterial`. All colors and sizes come from `this.ld.environment`. No GLBs are used here — flat colored planes are fast and sufficiently attractive for a playable ad.

**Why it matters:** Using data-driven colors means changing the game's entire look (e.g. winter theme) is a one-line JSON edit. The ground is `receiveShadow = true` which allows the character and animals to cast soft shadows on it.

#### `loadFences()`
This method is the most geometrically complex setup routine. It:
1. Loads the fence GLB via `AssetLoader.loadGltf()` (cached — only one HTTP request even if called again)
2. Measures the GLB's bounding box to find the pivot offset (`pivZ`)
3. For each enclosure, tiles fence panels around a rectangular perimeter:
   - South row (facing player): skips `gatePanels` in the centre to create a walkable opening
   - North row (back wall): solid
   - East/West columns: rotated 90° to run perpendicular to the path

**Why it matters:** The pivot-offset math is the key insight — GLB models often aren't centred at their origin. Measuring the bounding box at runtime means the fence tiles correctly for any GLB model, not just the current iron fence. The gate opening is calculated as `midPanel ± gatePanels/2` so it's always centred regardless of enclosure width.

---

### 5.3 Character & Animals

#### `loadPlayer()`
Loads the player character GLB, attaches it to the Three.js scene, and creates an `AnimationMixer` with two clips: `idle` and `walk`. Both actions are extracted by name from `gltf.animations`. The idle action starts playing immediately; the walk action is kept ready to cross-fade in.

**Why it matters:** The two-action cross-fade (`fadeOut` + `fadeIn` with 0.2s duration) in `handleMovement` is what makes the character feel alive rather than snapping between states. The animation clips must be named exactly `"idle"` and `"walk"` in the GLB export — a naming contract between artists and code.

#### `loadAnimals()`
The most optimised loading routine in the codebase. It builds a flat queue of all animal instances, then fires all `gltf` loads **in parallel** via `Promise.all`. This means 9 animals (5 monkeys + 3 elephants + 1 lion) load simultaneously rather than sequentially.

After loading, each instance is:
- Cloned via `gltf.scene.clone(true)` before being placed — **critical** because the AssetLoader caches the original scene; placing it directly would move the same node rather than create a new instance
- Position-spread across the enclosure width using linear interpolation
- Normalized to a `targetHeight` (see `normalizeAnimalHeight`)
- Given an `AnimalWander` AI instance with bounds matching its enclosure
- Given a `staticAction` + `walkAction` mixer pair passed into `AnimalWander` — blending is handled inside the AI class itself (see §6)

**The `.clone(true)` rule:** The AssetLoader cache stores the *template* gltf. Every placement must call `gltf.scene.clone(true)` to get a new, independent Three.js `Group`. Failing to do this means Three.js moves the single node to the last position — all but one instance silently disappear.

**Locked animals:** Animals with `startLocked: true` are set to `group.visible = false` immediately after loading. The perceived "silhouette" effect comes from the 2D HUD layer, where the portrait is dark-tinted with a padlock icon. When an enclosure is purchased, `purchaseEnclosure()` sets `g.visible = true` with a staggered reveal animation.

#### `normalizeAnimalHeight(group, targetHeight)`
Measures the bounding box of a loaded GLB, computes the scale factor needed to reach `targetHeight` world units, applies it, then repositions `y` so the model sits exactly on the ground plane.

**Why it matters:** Different GLBs export at wildly different scales (some are in centimetres, some in metres). This method makes every animal the same world-space height without requiring every artist to export at a consistent scale. It is also used in `pickup()` to normalise carried items to 0.35 world units.

---

### 5.4 Items & Props

#### `loadItems()`
Loads each item GLB via `AssetLoader.loadGltf()` and places it at its world-space position from `level.json`. Each instance calls `.clone(true)` on the cached scene. If the GLB fails to load, `_fallbackMesh()` creates a simple coloured sphere so the game remains playable even with missing assets.

**Why it matters:** The fallback pattern means a broken or missing asset doesn't crash the game — critical for a playable ad where you have no control over CDN caching behaviour.

#### `updateItemBobbing(dt)`
Every in-world item that isn't being carried gently bobs up and down using `Math.sin(elapsedTime)` and slowly spins on Y. This is a classic "this item is important, pick it up" visual cue used in virtually every casual game.

**Why it matters:** Animated items dramatically improve discoverability — players notice motion in a 3D scene far more readily than static objects.

#### `loadProps()`
Loads decorative environment props (benches, trash cans, trees, hay bales, rocks, pine trees) from `level.json`. All calls go through `AssetLoader.loadGltf()`, which provides automatic deduplication — repeated models (e.g. 8 pine trees) trigger only one HTTP request. Each instance calls `gltf.scene.clone(true)` to get its own independent copy.

**Why it matters:** The AssetLoader cache turns O(n) GLTF loads into O(unique models). `gltf.scene.clone(true)` copies geometry *references* (not geometry data), so placing 8 pine trees costs only one actual geometry allocation in GPU memory.

---

### 5.5 Interaction System

#### The `Interactable` interface
Every interactive object in the world implements this interface:

```typescript
interface Interactable {
  id:              string
  getWorldPos:     () => Vector3     // where the bubble floats in 3D
  action:          () => void        // what happens on tap
  isAvailable:     () => boolean     // should the bubble show at all?
  bubbleLabel:     string            // emoji fallback
  bubbleIcon?:     string            // Phaser texture key (preferred)
  bubbleSprite?:   Phaser.GameObjects.Container
}
```

**Why it matters:** Using a single interface for all interactables (delivery points, purchase locks) means `updateBubbles()` doesn't need to know what type of thing it's dealing with — it just checks `isAvailable()` and positions the bubble. Adding a new interactable type (e.g. "feed animal directly") is adding one object that implements this interface, nothing else.

#### `setupInteractables()`
Iterates `level.json`'s phases and enclosures to create Interactable objects, then creates their bubble UI sprites. The `isAvailable` function for delivery bubbles checks: correct phase + enclosure purchased + correct item carried. The `isAvailable` for purchase bubbles checks: not yet purchased + prerequisite enclosure owned.

**Why it matters:** The `isAvailable` lambda captures game state at call time (not at creation time), so it always reflects the current state without needing to be manually updated.

#### `updateBubbles()`
Called every frame. For each interactable:
1. Calls `isAvailable()` to decide if the bubble should show
2. Checks proximity (delivery = zone-based `enc.zoneXMin/zoneXMax + enclosureEntryZ`, purchase = Euclidean distance)
3. Transitions the bubble sprite via `_showBubble` or `_hideBubble` **only when the state changes** (tracked in `prevBubbleVisible`)
4. If visible, projects the world position to screen space and moves the bubble

**Why it matters:** The `prevBubbleVisible` diff check is crucial — without it, `_showBubble` and `_hideBubble` would fire every frame, creating a storm of competing tweens.

#### `_showBubble(item)` / `_hideBubble(item)`
Animates bubbles in and out with spring-style tweens (`Back.easeOut` pop-in, `Quad.easeIn` pop-out). After popping in, a continuous "wiggle" tween rocks the bubble ±8°. When a bubble pops in, `sfx-whoosh` plays via the SoundManager — a short audio confirmation that reinforces the visual pop.

**Why it matters:** The scale-from-zero pop-in is the standard mobile game "tap me" signal. The continuous wiggle keeps drawing the player's eye. The whoosh sound adds a satisfying tactile layer to the visual cue. These micro-animations are what separate polished playable ads from flat ones.

Bubbles are created by `BubbleFactory` functions (`createActionBubble`, `createPurchaseBubble`) — see §7.4.

#### `project(worldPos)`
Converts a Three.js `Vector3` (3D world position) to a Phaser 2D screen position. Uses Three.js's built-in `vector.project(camera)` which maps to NDC [-1,1], then scales to pixel coordinates.

```typescript
private project(worldPos: Vector3): { x: number; y: number } {
    const v = worldPos.clone().project(this.third.camera)
    return { x: (v.x + 1) / 2 * GAME_W, y: (1 - v.y) / 2 * GAME_H }
}
```

**Why it matters:** This is the bridge between the 3D and 2D layers. Every bubble, HUD icon, and particle effect that needs to "follow" a 3D object uses this method. Getting this wrong would cause all 2D UI to be mis-positioned.

#### `updateAutoPickup()`
When the player walks within 1.8 units of the current phase's required item, it is automatically picked up. There is no tap required.

**Why it matters:** Tap-to-pickup on a joystick-controlled character is awkward on mobile. Auto-pickup on proximity is the standard UX pattern for mobile 3D games and removes a frustrating extra interaction step.

---

### 5.6 UI & HUD Systems

#### Prestige Bar (`createPrestigeBar`, `_drawPrestigeBarFill`, `_advancePrestige`)
A horizontal progress bar at the top of the screen with three animal milestone markers. The fill animates forward each time an animal's full phase chain is completed (specifically when `!onComplete.showItemType && onComplete.starsAwarded` — intermediate `showItemType` steps do NOT advance it). Each milestone tints an animal portrait and star badge from dark to full colour as the bar reaches it.

**Why it matters:** In casual games, visible progress indicators ("meta-progression") are the #1 driver of extended engagement and replay desire. For a playable ad, they communicate "there's more to unlock if you play the full game."

#### Animal HUD (`createAnimalHudItems`, `updateAnimalHud`, `_drawRadialRing`)
Floating animal portraits positioned above each enclosure in world space (via `project`). Each shows a radial "needs" ring that drains over time (green → yellow → red for the active animal). Off-screen animals get a screen-edge clamped position with a directional arrow indicator; the clamping respects a `topMargin = 70px` to stay below the prestige bar.

**Why it matters:** The needs ring is the core tension mechanic — it's the ticking clock that creates urgency. The off-screen arrow is a key UX feature: without it, players with the camera positioned away from a distant enclosure would have no hint it exists.

#### Star HUD (`setupStarHud`, `flyStars`, `updateStarHud`)
A star counter in the top-right corner. When stars are awarded, `flyStars` spawns exactly **5 visual star sprites** (regardless of the actual count) that fly from the delivery point to the HUD counter, while a "+N" popup springs up from the delivery point. The counter ticks up proportionally as each star arrives. The HUD pops with a `Back.easeOut` scale bounce on update.

Each star plays `sfx-coin` the moment it lands on the HUD. The playback **rate** rises linearly from 0.9 on the first star to 1.1 on the last, creating a classic ascending ding-ding-ding collect jingle without needing multiple audio files.

**Why it matters:** Earning currency needs to *feel* rewarding. The animated fly-to-HUD pattern (copied from every top mobile game) makes the reward moment tactile and satisfying, which is critical for a playable ad — the feeling of reward is what drives installs. The ascending coin pitch is the audio equivalent of the visual scale bounce.

#### Pickup Arrows (`createPickupArrows`, `updatePickupArrows`)
A bouncing arrow image floats above the current phase's required item, pointing at it. It only appears for the item the player currently needs and disappears once picked up. The arrow Y position gets a bob offset from `Math.sin(elapsedTime * 3.5) * 0.12` synced to the item's wander.

**Why it matters:** First-time players have no idea which item to pick up. The arrow removes this ambiguity entirely without requiring a wordy tutorial overlay.

#### Tutorial (`_showTutorial`, `_dismissTutorial`)
A hand icon + "SWIPE" label appears above the joystick at game start, animating left-right. It auto-dismisses via `this.time.delayedCall(tut.autoDismissMs ?? 4000, ...)` and also dismisses on the player's first joystick move (inside `handleMovement`).

**[CORRECTED] Auto-dismiss timing:** The code fallback is `4000ms` (4 seconds). The current `level.json` overrides this to `9000ms` (9 seconds). Both values are data-driven — changing the timing does not require touching TypeScript code.

---

### 5.7 Movement & Camera

#### `handleMovement(dt)`
Reads `this.moveData` (populated by the joystick) and moves the player by `right * speed * dt` on X and `top * speed * dt` on Z. Rotation uses `Math.atan2(right, -top)` to face the direction of travel. On state change (stopped → moving or moving → stopped), the animation is crossfaded via `fadeOut/fadeIn(0.2)`. First movement dismisses the tutorial.

Player position is hard-clamped to `bounds` from `level.json` every frame.

Footstep sounds are **pre-created** in `create()` as three `Phaser.Sound.BaseSound` objects (one per variant, all looping). On movement start, one is picked at random and `.play()` called directly on the object. On movement stop, `.stop()` is called on the same reference. This is more reliable than `SoundManager.playSfx({ loop: true })` because it guarantees a stoppable reference even if the audio context was locked at play time.

**Why it matters:** Multiplying by `dt` makes movement frame-rate independent. Pre-creating sounds ensures footsteps never "run away" (play with no reference to stop them), which was the bug in the previous `playSfx`-based approach.

#### `updateCarryStack()`
Positions carried items above the player's head in a vertical stack with a subtle bob offset. Items float at `y = playerY + 2 + index * 0.6 + sin(time)`.

**Why it matters:** This is pure visual feedback — showing what you're carrying is fundamental UX. The bob matches the item's standalone bob animation so carried items feel consistent with world items.

#### `setupCamera()` / `updateCamera()`
The camera is a `PerspectiveCamera` with FOV 75, initially positioned at `(-8, 5, 12)` looking at `(-12, 0, 0)`.

**[CORRECTED] Each frame, both X and Z positions lerp toward the player:**
```typescript
camera.position.x = MathUtils.lerp(camera.position.x, x + 2, 0.1)  // +2 ahead on X
camera.position.y = 5                                                 // fixed height
camera.position.z = MathUtils.lerp(camera.position.z, z + 10, 0.1) // +10 behind on Z
camera.lookAt(x + 2, y + 0.5, z)
```

The `+2` X offset nudges the camera slightly ahead of the player in the primary direction of travel (+X). The lerp factor `0.1` creates a slight lag that feels organic. Y is fixed at 5.

**Why it matters:** The `lerp` follow creates a "weighted camera" feel which is the standard for 3D character games. A camera that snaps would feel mechanical and nauseating on mobile.

---

### 5.8 Game-Loop Updaters

All of these are called every frame from `update()`:

| Method | What it does every frame |
|---|---|
| `handleMovement(dt)` | Apply joystick input to player position + animations |
| `updateCarryStack()` | Snap carried items above player head |
| `updateItemBobbing(dt)` | Bob + rotate world items |
| `updateCamera()` | Lerp camera toward player (X and Z) |
| `updateAutoPickup()` | Check if player is close enough to auto-grab item |
| `updatePickupArrows()` | Project item arrows to screen and show/hide |
| `updateBubbles()` | Show/hide/position interaction bubbles |
| `updateAnimalHud()` | Position animal HUD icons + redraw needs rings |
| `updateNeeds(dt)` | Drain needs for all unlocked, unfed animals |
| Animal wander loop | Advance all AnimalWander AI instances + blend animations |

**Why it matters:** Splitting `update()` into well-named sub-methods is the single most important architectural decision for maintainability. A monolithic `update()` body of 200 lines is untraceable; ten named calls each under 30 lines is readable and debuggable.

---

### 5.9 Game Flow: Phases, Delivery, Fail & End

#### Phase State Machine — `PhaseManager`
Phase state is owned by `PhaseManager` (`managers/PhaseManager.ts`), not a raw string:

```
'monkey'  →  'elephant'  →  'lion_toy'  →  'lion_food'  →  'done'
```

```typescript
this.phaseManager = new PhaseManager(this.ld.phases)
this.phaseManager.currentId    // 'monkey' | 'elephant' | ...
this.phaseManager.current      // PhaseConfig | null
this.phaseManager.isDone       // true when past last phase
this.phaseManager.advance()    // move to the next phase
```

Phase definitions still live in `level.json` — the state machine extends automatically when new phases are added there, no code change required.

**Why it matters:** Wrapping the string in a class makes the state machine inspectable, testable, and a single source of truth. `isDone` and `current` are computed properties with null-safety, eliminating scattered `=== 'done'` checks across the codebase.

#### `deliver(type, phaseId)` + `onDelivery()` + `_setupDeliveryListeners()`
`deliver` removes the item from the carry stack and calls `onDelivery`. `onDelivery` now does exactly two things:
1. Advances `phaseManager` to the next phase
2. Emits `delivery:success` with a `DeliveryPayload` (the completed phase config, enclosure, and model groups)

All consequences are handled by five focused listeners registered in `_setupDeliveryListeners()` (called once from `create()`):

| Listener | Responsibility |
|---|---|
| `delivery:sfx` | Plays animal cheer + success FX |
| `delivery:visual` | Triggers bounce, hearts, stars with ascending coin jingle |
| `delivery:stars` | Calls `flyStars()` if `starsAwarded > 0` |
| `delivery:state` | Resets needs, marks `fedAnimals`, advances prestige |
| `delivery:transition` | Handles `showItemType`, `endGame`, or phase timer activation |

**Why it matters:** `onDelivery` shrinks from ~55 lines to ~10. Adding a new delivery consequence (haptics, analytics, a new animation) is a new `events.on` listener — existing code is untouched. Each listener is individually readable and testable.

#### `purchaseEnclosure(encId)`
Deducts stars and unlocks an enclosure. Includes a **double-purchase guard**: the enclosure ID is added to `purchasedEnclosures` as the very first action — before any star deduction. Any subsequent call (e.g. rapid double-tap) hits `if (this.purchasedEnclosures.has(encId)) return` and exits immediately. If somehow stars are insufficient (edge case), the ID is removed from the set and the HUD shakes.

**Why it matters:** Without this guard, rapid tapping could fire `purchaseEnclosure` twice in the same frame — both calls would pass the star-count check before either had time to deduct. The "reserve first, validate second" pattern is the correct fix: atomically claim the resource before doing any accounting.

#### `updateNeeds(dt)` / `onTimerExpired()`
**[CORRECTED] `updateNeeds` iterates over ALL animals every frame**, not just the active one. Two drain rates apply:
- **Active animal** (current phase's animal, not yet completed): `activeDrainRate = 1 / timerDuration` (with `timerDuration = 20s`, this drains from 1 to 0 in 20 seconds)
- **All other unlocked, unfed animals**: `idleRate = 0.025` per second (a constant slow drain)

Only the active animal triggers `onTimerExpired()` when it reaches 0. Locked animals and already-fed animals are skipped entirely.

When the active animal reaches 0: screen shake, "YOU'RE FIRED!" failure overlay, and a retry button.

**Why it matters:** The dual-rate drain creates an interesting tension: even animals you've already unlocked but haven't fed yet are slowly losing happiness. This nudges the player to move efficiently through the level.

#### `retryCurrentAnimal()`
Resets the current phase: drops carried items, reverts two-step phases (e.g. `lion_food` reverts to `lion_toy` and hides the revealed turkey), ensures the required item is visible, restores needs to full.

**Why it matters:** A gentle retry (no full restart) keeps players in the experience. Restarting from scratch after failing one animal would be too punishing for an ad context — players would just close it.

#### `showEndcard()`
Builds the full-screen CTA (call-to-action) panel: background illustration, game logo, panel card, giraffe teaser, "NEW ANIMAL UNLOCKED" text, and a pulsing "PLAY NOW!" button. All elements animate in with a staggered sequence (panel slides up → logo drops in → giraffe punches in → button pulses). The win SFX plays and the BGM fades out when endcard triggers.

The CTA button is wired to the standard ad-network redirect pattern:
```typescript
if (typeof window.onCTATapped === 'function') window.onCTATapped()  // ad network hook
else window.open('https://play.google.com/store/apps/details?id=...', '_blank')
```
Before shipping, replace the placeholder store URL with the real app URL.

**Why it matters:** The endcard is the entire *point* of the playable ad — converting viewers into installs. The giraffe teaser ("see what you could unlock") and achievement copy exploit the FOMO (fear of missing out) psychology that mobile game UA is built on.

---

## 6. Animal AI — `AnimalWander.ts`

```
src/scripts/zoo/AnimalWander.ts   (168 lines)
```

A standalone, physics-free kinematic AI class for animals. It is completely decoupled from Phaser and Three.js scene internals — it receives a `Group` reference and a config, then moves the group each frame.

### State Machine
The AI has two states: **moving** and **waiting**.

```
MOVING: walk toward target waypoint at moveSpeed
   └─ on arrival (dist < 0.2): enter WAITING
   └─ on boundary overrun (dist from origin > wanderRadius): pickNewTarget → MOVING
WAITING: play idle bounce (|sin| wave on Y), count down wait timer
   └─ on timer expiry: pickNewTarget → MOVING
```

### Key methods

#### `constructor(entity, config, anims?)`
Saves the entity reference and records `entity.position.clone()` as `this.origin`. The optional third parameter is an `AnimalAnimPair`:

```typescript
interface AnimalAnimPair {
  staticAction: AnimationAction  // idle/static clip
  walkAction:   AnimationAction  // walk clip
}
```

When provided, both actions are started immediately (both playing, `walkAction.weight = 0`) so cross-fading can begin from the first frame. The blend is driven inside `update()` — GameScene doesn't need to touch animation weights at all.

**Why it matters:** Co-locating animation blending with movement logic means an AI state change (`waiting → moving`) and its animation consequence happen atomically in the same frame. When blending lived in GameScene's update loop instead, it was possible for the AI state and the animation weight to briefly disagree.

#### `pickNewTarget(towardOrigin?)`
Picks a random point within `wanderRadius` of the origin. If the optional `towardOrigin` vector is passed (used when a boundary is hit), the angle is biased back toward origin with ±90° randomness — a "soft bounce" that prevents animals from immediately running back to the wall.

#### `clampTarget(v)`
Applies rectangular hard bounds (`xMin/xMax/zMin/zMax`) to a target position. Used so animals never step outside their enclosure regardless of the wander radius. The enclosure fences are visual-only (no physics) — this clamp is the substitute collision system.

#### `update(dt)`
The per-frame driver. In the MOVING state it steps the position toward the target, rotates the entity to face the direction of travel (`Math.atan2(dir.x, dir.z)`), and checks for waypoint arrival and boundary overrun. In the WAITING state it drives an idle bounce via `Math.abs(Math.sin(jumpTime))`.

At the end of every `update` call, if `anims` was provided, the walk/idle blend is smoothly driven:
```typescript
const target = this.isMoving ? 1 : 0
animBlend += (target - animBlend) * BLEND_RATE * dt   // BLEND_RATE = 6
staticAction.weight = 1 - animBlend
walkAction.weight   = animBlend
```

The `BLEND_RATE = 6` constant lives as a `private static` inside `AnimalWander` — it's an AI detail, not a game-wide tunable.

**Why it matters:** The `Math.abs(Math.sin(...))` bounce creates a "double bounce" pattern (the abs folds the negative half up) — subtle but it reads as a more organic idle than a pure sine. The `dt * 6` lerp means the blend takes ~0.17 seconds, creating a natural transition without snapping.

### `isMoving` getter
Returns `true` when `!this.waiting && !!this.target`. Useful for external callers (e.g. the game loop) that need to know the current movement state without reaching into internals.

---

## 7. Utility Modules

These are standalone modules extracted from GameScene. Each can be dropped into any future Phaser 3 + enable3d project without modification.

---

### 7.1 Game Constants — `constants.ts`

```
src/scripts/constants.ts   (32 lines)
```

Single source of truth for all magic numbers used across more than one file. Importing from here instead of hardcoding values means tuning the game feel (camera lag, pickup radius, HUD sizes) is a single-file edit.

| Constant | Value | Role |
|---|---|---|
| `GAME_W` / `GAME_H` | 540 / 960 | Canvas pixel dimensions |
| `FONT` | `"Baloo 2", sans-serif` | All Phaser text elements |
| `ACTION_BUBBLE_W/H` | 74 × 74 | Action bubble container size |
| `PURCHASE_BUBBLE_W/H` | 74 × 88 | Purchase bubble container size |
| `BUBBLE_RADIUS` | 16 | Rounded corner radius for bubbles |
| `CAMERA_LERP` | 0.1 | Camera follow smoothing (~10 frames to catch up) |
| `CAMERA_OFFSET_X/Z` | 2 / 10 | Camera leads player on X, trails on Z |
| `AUTO_PICKUP_RADIUS` | 1.8 | World units — item auto-collected within this distance |
| `CARRY_ITEM_HEIGHT` | 0.35 | Normalised height for items in the carry stack |
| `ANIM_BLEND_RATE` | 6 | Walk↔idle blend convergence multiplier (× dt) |
| `HUD_RING_RADIUS` | 32 | Pixel radius of the animal needs ring |
| `HUD_EDGE_MARGIN` | 58 | Pixels from screen edge for off-screen HUD indicators |
| `HUD_TOP_MARGIN` | 70 | Pixels below prestige bar reserved for top clamp |
| `NEEDS_IDLE_RATE` | 0.025 | Needs drain per second for non-active unlocked animals |

**Why it matters for future games:** Copy this file into any new project and replace values. Every system that imports these constants adjusts automatically — no grep-and-replace required.

---

### 7.2 Asset Loader — `AssetLoader.ts`

```
src/scripts/utils/AssetLoader.ts   (68 lines)
```

A thin GLTF loading service with three-layer deduplication:

| Layer | Mechanism | Purpose |
|---|---|---|
| Cache | `Map<path, gltf>` | Returns resolved gltf immediately on repeat calls |
| In-flight | `Map<path, Promise>` | Multiple concurrent requests for same path share one fetch |
| Failed | `Set<path>` | Known-bad paths return `null` immediately — no retry spam in console |

```typescript
const loader = new AssetLoader(this.third)

// Single load:
const gltf = await loader.loadGltf('assets/pets/animal-monkey.glb')
const group = gltf.scene.clone(true)   // ← always clone!

// Batch parallel:
const gltfs = await loader.loadManyGltf(['a.glb', 'b.glb', 'c.glb'])
```

**The `.clone(true)` contract:** `loadGltf` returns the *cached template* gltf — the same object every time for a given path. Every placement in the Three.js scene must call `gltf.scene.clone(true)` to get an independent `Group`. Placing the template directly would move the single node to each new position in sequence, leaving only the last one visible.

**Why it matters for future games:** Drop `AssetLoader` in, replace all `this.third.load.gltf()` calls, and get deduplication + error safety for free. The in-flight map is especially valuable when multiple systems load the same model at startup — only one HTTP request fires regardless of how many `await loadGltf(samePath)` calls are made concurrently.

---

### 7.3 World UI — `WorldUI.ts`

```
src/scripts/utils/WorldUI.ts   (41 lines)
```

Two pure functions for bridging the 3D and 2D coordinate systems.

#### `projectToScreen(worldPos, camera, w?, h?)`
Projects a Three.js `Vector3` to Phaser pixel coordinates. Uses `vector.project(camera)` (NDC [-1,1]) then scales to pixels:
```typescript
{ x: (v.x + 1) / 2 * w, y: (1 - v.y) / 2 * h }
```
`w` and `h` default to `GAME_W`/`GAME_H` for convenience.

#### `clampToScreenEdge(tx, ty, margin, w?, h?, topMargin?)`
Takes a projected screen point that may be off-screen and returns the nearest on-screen edge position plus the angle toward the original point. Used for off-screen HUD indicators — the angle drives the rotation of the directional arrow.

**Why it matters for future games:** Every 3D game with a 2D overlay needs these two functions. Placing them in a standalone module means you never re-derive the NDC-to-pixel formula — a common source of subtle bugs.

---

### 7.4 Bubble Factory — `BubbleFactory.ts`

```
src/scripts/ui/BubbleFactory.ts   (104 lines)
```

Two factory functions that build Phaser `Container` hierarchies for the interaction bubbles. Both accept an options bag with sensible defaults so call sites only pass what differs.

#### `createActionBubble(scene, label, options?)`
White rounded-rect bubble with an icon (or emoji fallback), a pulsing tap-pointer, and a CTA label.

```typescript
export interface ActionBubbleOptions {
  iconKey?:    string   // Phaser texture key — falls back to `label` emoji if absent
  pointerKey?: string   // Default: 'ui-pointer'
  ctaText?:    string   // Default: 'GIVE'
}
```

#### `createPurchaseBubble(scene, cost, options?)`
Gold rounded-rect bubble with a star icon, cost number, pulsing tap-pointer, and a CTA label.

```typescript
export interface PurchaseBubbleOptions {
  starKey?:    string   // Default: 'ui-star'
  pointerKey?: string   // Default: 'ui-pointer'
  ctaText?:    string   // Default: 'UNLOCK'
}
```

Both functions return an invisible, zero-scale, interactive `Container` — `_showBubble` / `_hideBubble` in GameScene handle its lifecycle.

**Why it matters for future games:** Bubble visuals are completely decoupled from game logic. To use a different pointer sprite or CTA text, pass it in the options bag. To create a third bubble type (e.g. "TALK"), add a new factory function — no GameScene methods to modify.

---

## 8. Audio System

---

### 8.1 Sound Manager — `SoundManager.ts`

```
src/scripts/managers/SoundManager.ts   (231 lines)
```

A reusable audio service for Phaser 3 games. Wraps Phaser's sound system with two independent categories:

- **Music** — one background track at a time, optional fade in/out, cross-fade support
- **SFX** — fire-and-forget effects, optional loop, playback rate control

```typescript
// Setup (in create()):
this.sfx = new SoundManager(this, { musicVolume: 0.25, sfxVolume: 0.85 })

// Music:
this.sfx.playMusic('bgm', { fadeIn: 1500 })
this.sfx.stopMusic(800)           // fade out over 800ms

// SFX:
this.sfx.playSfx('pickup')
this.sfx.playSfx('sfx-coin', { volume: 0.7, rate: 1.1 })

// Mute toggle (e.g. for a settings button):
this.sfx.toggleMute()

// Cleanup:
this.sfx.destroy()   // call from scene shutdown()
```

**Important — field naming:** In GameScene the field is named `this.sfx`, **not** `this.sound`. Phaser.Scene has a built-in `sound` property (its own SoundManager). Naming the field `sound` causes TypeScript errors and silent shadowing.

**`playSfx` return type guard:** `scene.sound.play()` returns `boolean | BaseSound` — it returns `false` in `NoAudioSoundManager` (e.g. when the audio context is locked). `playSfx` checks `typeof result === 'boolean'` before returning, so it always returns `BaseSound | null`. Callers can safely call `.stop()` on the return value without a crash.

#### Audio wired in Zoo Keeper

| Event | Sound key | Notes |
|---|---|---|
| BGM start | `bgm` | Fade in 1500ms, loops |
| Player walks | `sfx-footstep-1/2/3` | Random variant, pre-created, looping |
| Bubble pop-in | `sfx-whoosh` | Via `_showBubble` |
| Delivery | `sfx-monkey/elephant/lion` | Phase-specific cheer |
| Star lands on HUD | `sfx-coin` | Per-star, rate rises 0.9→1.1 |
| Enclosure purchase | `sfx-coin` | At full volume |
| End card | `sfx-win` + BGM fade-out | Triggered in `showEndcard` |

**Why it matters for future games:** Drop `SoundManager` in, instantiate it in `create()`, and get music fading, SFX volume control, and mute toggle with no extra code. All Phaser audio quirks (return type, NoAudioSoundManager, context lock) are handled internally.

---

### 8.2 Audio Config — `AudioConfig.ts`

```
src/scripts/config/AudioConfig.ts   (33 lines)
```

**The only file you need to edit to adjust audio volumes.** All volume values and timing constants are centralised here — nothing is hardcoded in GameScene.

```typescript
export const AudioConfig = {
    master: {
        music: 0.25,   // BGM overall level
        sfx:   0.85,   // All SFX overall level
    },
    sfx: {
        footstep: 0.20,  // Looping walk sound
        whoosh:   1.0,   // Bubble pop-in
        animal:   0.75,  // Delivery cheer
        coin:     1.0,   // Enclosure purchase
        coinStar: 0.7,   // Per-star coin ding
        win:      1.0,   // End-card fanfare
    },
    timing: {
        musicFadeIn:  1500,  // ms
        musicFadeOut:  800,  // ms
    },
}
```

**Quick tuning reference:**

| Want to change | Edit |
|---|---|
| Music too loud/quiet | `master.music` |
| All SFX too loud/quiet | `master.sfx` |
| Footsteps specifically | `sfx.footstep` |
| Bubble whoosh | `sfx.whoosh` |
| Delivery/purchase coin | `sfx.coin` |
| Per-star collect jingle | `sfx.coinStar` |
| Animal cheer | `sfx.animal` |
| Win fanfare | `sfx.win` |
| BGM fade duration | `timing.musicFadeIn/Out` |

---

### 8.3 Phase Manager — `PhaseManager.ts`

```
src/scripts/managers/PhaseManager.ts   (~55 lines)
```

Owns the phase state machine. Replaces the raw `private phase = 'monkey'` string that previously lived directly in `GameScene`.

```typescript
this.phaseManager = new PhaseManager(this.ld.phases)

this.phaseManager.currentId   // 'monkey' | 'elephant' | ...
this.phaseManager.current     // PhaseConfig | null (null when done)
this.phaseManager.isDone      // true when past the last phase
this.phaseManager.advance()   // move to the next phase
this.phaseManager.findById(id)
this.phaseManager.indexOf(id)
```

**Why it matters:** A raw string can't enforce valid transitions, has no null-safety, and needs string comparisons scattered everywhere. Wrapping it in a class centralises all phase logic, makes `isDone` a safe computed property, and lets future games drop in a `PhaseManager` with their own phase list.

---

## 9. Asset Map

### 3D Models (GLB)
| File | Used for |
|---|---|
| `assets/character-male-e.glb` | Player character (idle + walk clips) |
| `assets/pets/animal-monkey.glb` | Monkey (static + walk clips) |
| `assets/pets/animal-elephant.glb` | Elephant (static + walk clips) |
| `assets/pets/animal-lion.glb` | Lion (static + walk clips) |
| `assets/food/banana.glb` | Banana pickup item |
| `assets/food/barrel.glb` | Water barrel pickup item |
| `assets/food/turkey.glb` | Turkey pickup item (revealed mid-game after lion_toy) |
| `assets/graveyard/iron-fence-border.glb` | Fence segment (tiled procedurally) |
| `assets/env/coaster/bench.glb` | Decorative bench |
| `assets/env/coaster/trash.glb` | Decorative trash can |
| `assets/env/coaster/flowers.glb` | Decorative flowers |
| `assets/env/coaster/tree.glb` | Decorative tree |
| `assets/env/graveyard/hay-bale.glb` | Decorative hay bale |
| `assets/env/graveyard/rocks.glb` | Decorative rocks |
| `assets/env/graveyard/pine.glb` | Decorative pine tree |

### UI Sprites (PNG)
| File | Used for |
|---|---|
| `assets/ui/star.png` | Currency icon |
| `assets/ui/padlock.png` | Locked enclosure indicator (HUD) |
| `assets/ui/throphy.png` | Trophy/reward |
| `assets/ui/pointer.png` | Tap hint (bubble + tutorial hand icon) |
| `assets/ui/heart.png` | Delivery success hearts |
| `assets/ui/gift.png` | Prestige bar milestone (3rd slot) |
| `assets/ui/button.png` | Star HUD background |
| `assets/ui/button-red.png` | Try Again button |
| `assets/ui/arrow.png` | Pickup item directional arrow |
| `assets/ui/animal-monkey.png` | Monkey HUD portrait |
| `assets/ui/animal-elephant.png` | Elephant HUD portrait |
| `assets/ui/animal-lion.png` | Lion HUD portrait |
| `assets/ui/game-logo.png` | Endcard logo |
| `assets/ui/final-panel.png` | Panel card (reused for both fail + endcard) |
| `assets/ui/CTA-button.png` | Endcard play button |
| `assets/ui/giraffe-unlocked.png` | Endcard teaser animal |
| `assets/ui/cta-background.png` | Endcard background illustration |
| `assets/ui/broken-star.png` | Failure screen broken star |
| `assets/ui/banana.png` + `assets/food/icons/banana.png` | Delivery + pickup bubble icons |
| `assets/ui/barrel.png` + `assets/food/icons/barrel.png` | Delivery + pickup bubble icons |
| `assets/ui/turkey.png` + `assets/food/icons/turkey.png` | Delivery + pickup bubble icons |
| `assets/ui/coconut.png` | Delivery bubble icon (lion toy phase) |

### Audio (MP3)
All audio files must be `.mp3` — Phaser's extension-to-MIME mapping does not reliably handle `.mpeg` or other variants.

| File | Key | Used for |
|---|---|---|
| `assets/audios/bgm.mp3` | `bgm` | Background music loop |
| `assets/audios/win-sound.mp3` | `sfx-win` | End-card fanfare |
| `assets/audios/monkey.mp3` | `sfx-monkey` | Monkey delivery cheer |
| `assets/audios/elephant.mp3` | `sfx-elephant` | Elephant delivery cheer |
| `assets/audios/lion.mp3` | `sfx-lion` | Lion delivery cheer |
| `assets/audios/Coin Bag 3-1.mp3` | `sfx-coin` | Star collect + enclosure purchase |
| `assets/audios/Whoosh.mp3` | `sfx-whoosh` | Bubble pop-in |
| `assets/audios/Footsteps_Sand_Walk_01.mp3` | `sfx-footstep-1` | Walk sound variant 1 |
| `assets/audios/Footsteps_Sand_Walk_10.mp3` | `sfx-footstep-2` | Walk sound variant 2 |
| `assets/audios/Footsteps_Sand_Walk_17.mp3` | `sfx-footstep-3` | Walk sound variant 3 |

---

## 10. Remaining Improvement Points

---

The following improvements were identified during the initial codebase review. Most have been implemented. The two remaining items are the highest-value refactors still pending.

### ✅ Implemented

| # | Improvement | Where |
|---|---|---|
| 8.1 | Extract an `AssetLoader` service | `utils/AssetLoader.ts` |
| 8.2 | Make `create()` fully parallel | `GameScene.ts` — `Promise.all([...5 loaders])` |
| 8.3 | Extract a `WorldUI` projection utility | `utils/WorldUI.ts` |
| 8.4 | Replace phase string with `PhaseManager` | `managers/PhaseManager.ts` |
| 8.5 | Centralise magic numbers | `constants.ts` |
| 8.6 | Type player/mixer references properly | `GameScene.ts` — `Group | null`, `AnimationMixer | null` |
| 8.7 | Make `AnimalWander` animation-aware | `zoo/AnimalWander.ts` — `AnimalAnimPair` param |
| 8.8 | Move bubble creation into a `BubbleFactory` | `ui/BubbleFactory.ts` |
| 8.9 | Event bus for `onDelivery` consequences | `GameScene.ts` — `_setupDeliveryListeners()` + `events.emit` |
| 8.10 | Implement the CTA store redirect | `GameScene.ts` — `window.onCTATapped` + `window.open` fallback |
| 8.11 | Add a `shutdown()` teardown | `GameScene.ts` — joystick removal, tween kill, geometry dispose |
| — | Add a `SoundManager` | `managers/SoundManager.ts` |
| — | Centralise audio volumes | `config/AudioConfig.ts` |
| — | Fix double-purchase rapid-tap bug | `purchaseEnclosure` — reserve-first guard |

All identified improvement points have been implemented.

---

*Documentation updated March 2026 — reflects all refactoring sessions completed to date.*
