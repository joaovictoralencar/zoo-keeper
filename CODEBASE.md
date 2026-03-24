# Zoo Keeper — Codebase Documentation
> A deep-dive reference covering every system, why it matters, and how it all fits together.
> Validated against source — corrections from first review are marked **[CORRECTED]**.

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
7. [Asset Map](#7-asset-map)
8. [Improvement Points for Future 3D Games](#8-improvement-points-for-future-3d-games)

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
src/scripts/scenes/GameScene.ts   (~1603 lines)
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
The main setup method. Runs sequentially (top to bottom) and `await`s at every async operation. The full order, as found in the source:

```
1.  Load level.json → this.ld
2.  Kick off Baloo 2 font load (non-blocking, fire-and-forget)
3.  Init purchasedEnclosures — enclosures with unlockCost=0 start open
4.  Lazy-load dynamic icon textures declared in items[] and phases[]
5.  this.third.warpSpeed()   — init Three.js scene, camera, lights
6.  buildEnvironment()       — ground, path, enclosure floors
7.  loadFences()             — fence GLB instances
8.  loadPlayer()             — character GLB + animations
9.  loadAnimals()            — all animal GLBs in parallel
10. loadItems()              — pickup item GLBs
11. loadProps()              — decorative scene props
12. Init animalNeeds to 1.0 for all animals
13. Hide items belonging to still-locked enclosures
14. setupInteractables()     — build interaction bubble objects
15. setupCamera()            — position and configure PerspectiveCamera
16. setupJoystick()          — create DOM joystick
17. setupUI()                — prestige bar, HUD, star counter
18. needsDrainActive = true  — start the timer system
19. _showTutorial()          — overlay tutorial hint
```

**Why it matters:** The serial order means nothing renders until the slowest `await` resolves. Moving to parallel `Promise.all` for independent loads would speed up startup (see Improvement Points §8.2).

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
1. Loads the fence GLB once
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
- Position-spread across the enclosure width using linear interpolation
- Normalized to a `targetHeight` (see `normalizeAnimalHeight`)
- Given an `AnimalWander` AI instance with bounds matching its enclosure
- Given a `staticAction` + `walkAction` mixer pair (blended each frame based on `w.isMoving`)

**[CORRECTED] Locked animals:** Animals with `startLocked: true` are set to `group.visible = false` immediately after loading — they are simply hidden in 3D. The perceived "silhouette" effect comes entirely from the 2D HUD layer, where the animal's portrait is dark-tinted and a padlock icon is rendered on top (see `createAnimalHudItems`). There are two dead-code methods `lockAnimal()` and `unlockAnimal()` (lines 422–439) that implement a material-swap approach but are **never called** anywhere in the codebase. When an enclosure is purchased, the 3D group is made visible again via `g.visible = true` in `purchaseEnclosure`.

**Why it matters:** Knowing the actual lock mechanism (visibility toggle, not material swap) is important for extending it — for example, adding a "reveal animation" would mean animating from `visible = false → true`, not reversing a material swap.

**Why it matters (Promise.all):** The `Promise.all` pattern is the correct way to load many assets concurrently. Sequential `await` inside a loop would multiply load time by the number of animals.

#### `normalizeAnimalHeight(group, targetHeight)`
Measures the bounding box of a loaded GLB, computes the scale factor needed to reach `targetHeight` world units, applies it, then repositions `y` so the model sits exactly on the ground plane.

**Why it matters:** Different GLBs export at wildly different scales (some are in centimetres, some in metres). This method makes every animal the same world-space height without requiring every artist to export at a consistent scale. It is also used in `pickup()` to normalise carried items to 0.35 world units.

---

### 5.4 Items & Props

#### `loadItems()`
Loads each item GLB and places it at its world-space position from `level.json`. If the GLB fails to load, `_fallbackMesh()` creates a simple coloured sphere so the game remains playable even with missing assets.

**Why it matters:** The fallback pattern means a broken or missing asset doesn't crash the game — critical for a playable ad where you have no control over CDN caching behaviour.

#### `updateItemBobbing(dt)`
Every in-world item that isn't being carried gently bobs up and down using `Math.sin(elapsedTime)` and slowly spins on Y. This is a classic "this item is important, pick it up" visual cue used in virtually every casual game.

**Why it matters:** Animated items dramatically improve discoverability — players notice motion in a 3D scene far more readily than static objects.

#### `loadProps()`
Loads decorative environment props (benches, trash cans, trees, hay bales, rocks, pine trees) from `level.json`. Uses a model cache (`Map<string, Group | null>`) so that repeated models (e.g. 8 pine trees) only make one `gltf` load call.

**Why it matters:** The cache pattern turns O(n) GLTF loads into O(unique models) — critical for build size since each `gltf.scene.clone(true)` copies geometry references, not geometry data.

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
Animates bubbles in and out with spring-style tweens (`Back.easeOut` pop-in, `Quad.easeIn` pop-out). After popping in, a continuous "wiggle" tween rocks the bubble ±8°.

**Why it matters:** The scale-from-zero pop-in is the standard mobile game "tap me" signal. The continuous wiggle keeps drawing the player's eye. These micro-animations are what separate polished playable ads from flat ones.

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

**Why it matters:** Earning currency needs to *feel* rewarding. The animated fly-to-HUD pattern (copied from every top mobile game) makes the reward moment tactile and satisfying, which is critical for a playable ad — the feeling of reward is what drives installs.

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

**Why it matters:** Multiplying by `dt` (delta time in seconds) makes movement frame-rate independent. Without this, the game would run twice as fast on a 120Hz phone as on a 60Hz one. The hard clamp prevents players from walking off the edge of the world.

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

#### Phase State Machine
The game has a single string `this.phase` that acts as a state machine token:

```
'monkey'  →  'elephant'  →  'lion_toy'  →  'lion_food'  →  'done'
```

All conditional logic reads from `this.phase`. Phase definitions live in `level.json` so the state machine implicitly extends when new phases are added to the JSON.

**Why it matters:** A single phase string is the simplest possible state machine. It's easy to serialize, easy to debug (just log it), and level.json-driven so no code changes are needed to add phases.

#### `deliver(type, phaseId)` + `onDelivery()`
`deliver` removes the item from the carry stack and calls `onDelivery`. `onDelivery` is the main branching method:
- Triggers success FX (bounce, hearts, stars)
- Resets active animal needs to full; marks it in `fedAnimals` (permanently stops its drain)
- Advances prestige only when `!onComplete.showItemType && onComplete.starsAwarded` (i.e. not for intermediate steps)
- Checks `PhaseOnComplete` to decide what happens next:
  - `showItemType`: reveal a hidden item and advance to `nextPhase`
  - `endGame`: disable needs drain and call `showEndcard` after 1800ms
  - Default: just advance to `nextPhase`

**Why it matters:** Keeping delivery and phase-advance logic in `onDelivery` means all consequence logic is in one place. The `PhaseOnComplete` data structure is an extension point — future phases can add new completion actions without restructuring the method.

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
Builds the full-screen CTA (call-to-action) panel: background illustration, game logo, panel card, giraffe teaser, "NEW ANIMAL UNLOCKED" text, and a pulsing "PLAY NOW!" button. All elements animate in with a staggered sequence (panel slides up → logo drops in → giraffe punches in → button pulses).

**[CORRECTED] ⚠️ The CTA button is currently a stub.** The `pointerdown` handler only does:
```typescript
.on('pointerdown', () => console.log('CTA → store redirect'))
```
The actual store/app-store redirect is **not implemented**. This must be replaced before shipping the ad.

**Why it matters:** The endcard is the entire *point* of the playable ad — converting viewers into installs. The giraffe teaser ("see what you could unlock") and achievement copy exploit the FOMO (fear of missing out) psychology that mobile game UA is built on. A broken CTA means zero installs regardless of how good the game is.

---

## 6. Animal AI — `AnimalWander.ts`

```
src/scripts/zoo/AnimalWander.ts   (150 lines)
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

#### `constructor(entity, config)`
Saves the entity reference and records `entity.position.clone()` as `this.origin`. This origin point is the centre of the animal's wander zone — all waypoints are relative to it.

**Why it matters:** Saving the origin at construction time means each animal wanders around its spawn point regardless of where it was placed. Moving an animal just by changing its spawn position in `level.json` automatically updates its wander center.

#### `pickNewTarget(towardOrigin?)`
Picks a random point within `wanderRadius` of the origin. If the optional `towardOrigin` vector is passed (used when a boundary is hit), the angle is biased back toward origin with ±90° randomness — a "soft bounce" that prevents animals from immediately running back to the wall.

**Why it matters:** The boundary-biased angle is what makes the wander feel natural. A purely random bounce would cause animals to instantly re-hit the same wall. The bias creates organic turning-away behavior.

#### `clampTarget(v)`
Applies rectangular hard bounds (`xMin/xMax/zMin/zMax`) to a target position. Used so animals never step outside their enclosure regardless of the wander radius.

**Why it matters:** The enclosure fences are visual-only (no physics). This clamp is the substitute collision system. Without it, animals would wander through fence panels.

#### `update(dt)`
The per-frame driver. In the MOVING state it steps the position toward the target, rotates the entity to face the direction of travel (`Math.atan2(dir.x, dir.z)`), and checks for waypoint arrival and boundary overrun. In the WAITING state it drives an idle bounce via `Math.abs(Math.sin(jumpTime))`.

**Why it matters:** The `Math.abs(Math.sin(...))` bounce creates a "double bounce" pattern (the abs folds the negative half up) — subtle but it reads as a more organic idle than a pure sine. The facing rotation (`atan2`) is the minimal-code way to make an entity face its direction of travel in 3D without a full LookAt operation.

### `isMoving` getter
Returns `true` when `!this.waiting && !!this.target`. GameScene uses this every frame to blend the animal's walk animation weight in/out:
```typescript
const target = w.isMoving ? 1 : 0
const next   = cur + (target - cur) * Math.min(1, dt * 6)
anim.walkAction.setEffectiveWeight(next)
```

**Why it matters:** The `dt * 6` lerp factor (~6x per second convergence) means the blend takes ~0.17 seconds, creating a natural transition between idle and walk animations that doesn't snap.

---

## 7. Asset Map

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

---

## 8. Improvement Points for Future 3D Games

These are patterns observed in the codebase that could be abstracted, replaced, or refined to make building the *next* 3D playable ad significantly faster and less error-prone.

---

### 8.1 Extract an `AssetLoader` Service

**Current situation:** Asset loading is scattered across five separate methods (`loadFences`, `loadPlayer`, `loadAnimals`, `loadItems`, `loadProps`). Each one calls `this.third.load.gltf(path)` directly and handles its own error handling inconsistently (some have try/catch, some don't). `loadProps` has its own local cache Map; nothing else does.

**Improvement:** A single `AssetLoader` class or utility:
```typescript
class AssetLoader {
  private cache = new Map<string, Group>()

  async load(path: string): Promise<Group | null> {
    if (this.cache.has(path)) return this.cache.get(path)!.clone(true)
    try {
      const gltf = await this.third.load.gltf(path)
      this.cache.set(path, gltf.scene)
      return gltf.scene.clone(true)
    } catch {
      console.warn(`[AssetLoader] Failed: ${path}`)
      return null
    }
  }

  async loadMany(paths: string[]): Promise<(Group | null)[]> {
    return Promise.all(paths.map(p => this.load(p)))
  }
}
```

**Benefit:** Eliminates 5 repetitive try/catch blocks, automatically deduplicates loads (unifying `loadProps`'s ad-hoc local cache into one global cache), and makes `Promise.all` parallel loading the default everywhere.

---

### 8.2 Make `create()` Fully Parallel

**Current situation:** `create()` calls `loadFences()`, `loadPlayer()`, `loadAnimals()`, `loadItems()`, `loadProps()` sequentially with `await`. Total load time = sum of all load times. Note that `loadAnimals` already uses `Promise.all` internally — the remaining sequential bottleneck is between these five top-level calls.

**Improvement:**
```typescript
await Promise.all([
  this.loadFences(),
  this.loadPlayer(),
  this.loadAnimals(),
  this.loadItems(),
  this.loadProps(),
])
```

**Benefit:** Total load time = longest single load time. On a typical connection this could cut asset loading time by 3–4×. The only constraint is that none of these methods may read results set by another (already true in the current codebase).

---

### 8.3 Extract a `WorldUI` Projection Utility

**Current situation:** `project(worldPos)` and `_screenEdgeClamp(tx, ty, margin)` are instance methods on `GameScene`. Any future scene that needs 3D→2D projection must re-implement this logic.

**Improvement:** A standalone `WorldUI` utility module:
```typescript
export function projectToScreen(worldPos: Vector3, camera: Camera, w: number, h: number) {
  const v = worldPos.clone().project(camera)
  return { x: (v.x + 1) / 2 * w, y: (1 - v.y) / 2 * h }
}

export function clampToScreenEdge(
  tx: number, ty: number, margin: number, w: number, h: number, topMargin = margin
) { /* ... */ }
```

**Benefit:** Any future scene can import and use these immediately. This is the most universally useful utility in the codebase — every 3D game with a 2D overlay will need it.

---

### 8.4 Replace the Phase String with a `PhaseManager`

**Current situation:** `this.phase` is a raw string, and phase transitions happen inside `onDelivery()` which also handles FX, needs resets, item reveals, and prestige. This is a multi-concern method (~55 lines).

**Improvement:** A small `PhaseManager` class:
```typescript
class PhaseManager {
  private phaseId: string
  get current(): PhaseConfig { ... }
  get isLastPhase(): boolean { ... }
  advance(nextId: string): void { ... }
}
```

**Benefit:** Phase logic becomes inspectable and testable in isolation. Adding a new completion consequence (e.g. "unlock a new prop") is a new handler, not a new branch in `onDelivery`.

---

### 8.5 Centralise Magic Numbers into a `GameConstants` File

**Current situation:** Values like `74` (bubble width), `0.1` (camera lerp), `1.8` (auto-pickup range), `dt * 6` (animation blend rate), `RING_R = 32`, `MARGIN = 58`, `idleRate = 0.025` appear inline throughout the scene.

**Improvement:** A `src/scripts/constants.ts` file:
```typescript
export const BUBBLE_SIZE         = 74
export const CAMERA_LERP         = 0.1
export const AUTO_PICKUP_RADIUS  = 1.8
export const ANIM_BLEND_RATE     = 6
export const HUD_RING_RADIUS     = 32
export const HUD_EDGE_MARGIN     = 58
export const NEEDS_IDLE_RATE     = 0.025
```

**Benefit:** Tuning the feel of the game (camera lag, pickup radius, needs drain) becomes a single-file edit. Avoids the risk of updating a value in one place but missing it in another.

---

### 8.6 Type the Player and Mixer References Properly

**Current situation:**
```typescript
private player: any = null
private mixer:  any = null
```
`any` defeats TypeScript's type checking on every player and mixer access.

**Improvement:**
```typescript
import type { Group, AnimationMixer } from 'three'

private player: Group | null = null
private mixer:  AnimationMixer | null = null
```

**Benefit:** Immediate IDE autocompletion and compile-time safety on all `player`/`mixer` property accesses. Lowest-effort improvement with the highest immediate developer experience gain.

---

### 8.7 Make `AnimalWander` Animation-Aware (Optional)

**Current situation:** `AnimalWander` exposes `isMoving: boolean` and GameScene manually blends animation weights in the main loop. The blending logic is external to the AI.

**Improvement:** Pass the `{ staticAction, walkAction }` pair into `AnimalWander` as an optional second argument:
```typescript
constructor(entity: Group, config: AnimalWanderConfig = {}, anim?: AnimalAnimPair)
// internally: blend walkAction weight based on isMoving state
```

**Benefit:** The game loop's animal section collapses from 10 lines to 3. Animation blending is co-located with movement logic where it semantically belongs.

---

### 8.8 Move Bubble Creation into a `BubbleFactory`

**Current situation:** `_createActionBubble` and `_createPurchaseBubble` are ~30-line methods on the scene class that build Phaser `Container` hierarchies. Any future interactable that needs a different bubble style requires a new scene method.

**Improvement:** A `BubbleFactory` module:
```typescript
export const BubbleFactory = {
  action:   (scene: Phaser.Scene, label: string, iconKey?: string) => { ... },
  purchase: (scene: Phaser.Scene, cost: number) => { ... },
}
```

**Benefit:** Decouples visual construction from game logic. Can be reused across multiple scenes. Makes testing bubble visuals in isolation possible.

---

### 8.9 Use Phaser's Event Bus for `onDelivery` Consequences

**Current situation:** `onDelivery()` directly calls `successEffect()`, `spawnHearts()`, `flyStars()`, `_advancePrestige()`, `_activateTimerForCurrentPhase()`, and `showEndcard()`. It is the single biggest multi-concern method in the codebase (~55 lines).

**Improvement:** Phaser's built-in event system (`this.events`) is already available:
```typescript
this.events.emit('delivery:success', { phase, starsAwarded })
// listeners registered in setupUI, setupFX, etc:
this.events.on('delivery:success', ({ starsAwarded }) => this.flyStars(starsAwarded, ...))
this.events.on('delivery:success', () => this._advancePrestige())
```

**Benefit:** `onDelivery` shrinks to emitting one event. Systems subscribe to events they care about. Adding a new consequence (SFX, haptics, analytics) is a new listener — zero modification to existing code. Zero additional dependencies.

---

### 8.10 Implement the CTA Store Redirect

**Current situation:** The "PLAY NOW!" button only does `console.log('CTA → store redirect')`.

**Improvement:** Replace with the actual redirect, ideally behind an interface that ad networks can inject:
```typescript
// Simple approach:
window.open('https://play.google.com/store/apps/details?id=com.your.game', '_blank')

// Ad-network-compatible approach (most networks provide a callback):
if (typeof window.onCTATapped === 'function') window.onCTATapped()
else window.open(STORE_URL, '_blank')
```

**Benefit:** Without this, the ad generates zero installs regardless of how engaging the gameplay is. This is the highest-priority fix before any live deployment.

---

### 8.11 Add a Scene `shutdown()` Teardown Contract

**Current situation:** There's no `shutdown()` or `destroy()` method. The joystick DOM element, tween references, and Three.js scene objects are never cleaned up. For a single-scene ad this is fine — the page is discarded. For multi-scene games this causes memory leaks.

**Improvement:**
```typescript
shutdown() {
  this.joystickEl?.remove()
  this.animalWanders.clear()
  this.tweens.killAll()
  // dispose Three.js geometry/materials
  this.third.scene.traverse((obj: any) => {
    obj.geometry?.dispose()
    if (Array.isArray(obj.material)) obj.material.forEach((m: any) => m.dispose())
    else obj.material?.dispose()
  })
}
```

**Benefit:** Makes the project safe to extend with multiple scenes (main menu → game → leaderboard) without memory bloat or ghost tweens from a previous scene.

---

*Documentation generated and validated March 2026 — reflects codebase at that date.*
