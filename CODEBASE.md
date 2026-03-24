# Zoo Keeper — Codebase Reference

> Mobile-first playable ad — ~45–60 second 3D casual game, single self-contained HTML delivery.
> Last updated March 2026.

---

## Table of Contents

0. [Quick-Start Cookbook](#0-quick-start-cookbook)
   - [Build for delivery](#build-for-delivery-standalone-html)
1. [Overview](#1-overview)
2. [Level Data](#2-level-data)
3. [GameScene.ts](#3-gamesceents)
4. [Animal AI — AnimalWander.ts](#4-animal-ai--animalwanderts)
5. [Utility Modules](#5-utility-modules)
6. [Audio](#6-audio)
7. [Asset Map](#7-asset-map)

---

## 0. Quick-Start Cookbook

> Practical recipes. For system internals, see the numbered sections.

**Almost everything is configured in `level.json`. Start there before touching TypeScript.**

---

### Build for delivery (standalone HTML)

```bash
npm run bundle          # → dist/standalone.html
```

`npm run bundle` is `npm run build` followed by `node scripts/inline.js`. It produces a single `dist/standalone.html` that opens directly in any browser with no server required — all game code, 3D models, textures, audio, and UI images are embedded inside it.

**When to use it:** only when preparing the deliverable. Day-to-day development uses `npm run start` (webpack dev server with hot reload). `npm run build` alone produces the multi-file `dist/` used for local testing with a server.

**Why it matters:** playable ads are distributed as a single self-contained file. Ad networks do not allow external CDN requests, so every asset must travel inside the HTML. The 5 MB budget (§1) is measured against this file.

**How `inline.js` works:**

1. Reads `dist/index.html` and collects the `<script src>` bundles.
2. Processes `dist/assets/level.json` — small icon PNGs are embedded as base64 data URIs directly in the JSON; GLB paths are left unchanged (handled in step 4).
3. Walks `dist/assets/` and for every asset referenced in the JS:
   - **GLBs** — processed once per unique path (`processGlb` bakes any external textures into the binary), then stored in the binary shim. The same model referenced 8 times in `level.json` (e.g. pine trees) is stored exactly once.
   - **Audio** — stored in the binary shim.
   - **Images** — replaced with `data:` URIs inline in the JS string.
4. Injects a binary shim before the bundle. The shim patches `window.fetch` (used by Three.js for GLBs) and `XMLHttpRequest` (used by Phaser for audio) so that requests to known asset paths are answered with a pre-decoded `ArrayBuffer` from the in-memory map — no file system access needed.
5. Writes `dist/standalone.html`.

> `dist/standalone.html` is additive — it never modifies other files in `dist/`. Re-running `npm run bundle` after any code or asset change regenerates it cleanly.

---

### Add a decorative 3D prop

1. Drop the `.glb` into `src/assets/env/`.
2. Add an entry to `"props"` in `level.json`:

```json
{
  "model":    "assets/env/my-bench.glb",
  "position": { "x": 5, "y": 0, "z": -6 },
  "rotation": { "y": 45 },
  "scale":    1.2
}
```

`loadProps()` picks it up on the next run. `y: 0` places the pivot on the ground — adjust if the model floats or clips.

---

### Add a new pickup item & phase

**1 — Drop assets**
- Item GLB → `src/assets/food/`
- Icon PNG → `src/assets/food/icons/`

**2 — Register the item in `level.json`**

```json
{
  "type":         "apple",
  "enclosureId":  "elephant",
  "model":        "assets/food/apple.glb",
  "scale":        1.5,
  "positionY":    0.5,
  "positionZ":    -1.5,
  "bubbleIcon":   "icon-apple",
  "iconAsset":    "assets/food/icons/apple.png",
  "startVisible": true
}
```

`startVisible: false` hides the item until a phase's `onComplete.showItemType` reveals it (e.g. the lion's turkey).

**3 — Add a phase**

```json
{
  "id":                "elephant2",
  "enclosureId":       "elephant",
  "animalId":          "elephant",
  "requiredItem":      "apple",
  "deliveryLabel":     "🎁",
  "deliveryIcon":      "icon-delivery-apple",
  "deliveryIconAsset": "assets/ui/apple.png",
  "onComplete": { "starsAwarded": 50, "nextPhase": "lion_toy" }
}
```

Update the previous phase's `"nextPhase"` to point here. `iconAsset` and `deliveryIconAsset` are lazy-loaded by `create()` — no `preload()` edits needed.

---

### Add a new interactable

Implement the `Interactable` interface and register it in `setupInteractables()`:

```typescript
const item: Interactable = {
  id:          'my-thing',
  getWorldPos: () => myMesh.position.clone().add(new Vector3(0, 2, 0)),
  isAvailable: () => someCondition,   // closure — evaluated every frame
  action:      () => { /* tap handler */ },
  bubbleLabel: '❓',
  bubbleIcon:  'my-texture-key',      // optional; prefers over emoji
}

this.interactables.push(item)
item.bubbleSprite = createActionBubble(this, item.bubbleLabel, { iconKey: item.bubbleIcon })
this.add.existing(item.bubbleSprite)
```

`updateBubbles()` handles show/hide/positioning automatically from that point.

---

### Move something in the world

| What | Field |
|---|---|
| Player start | `level.json` → `player.startX`, `startZ` |
| Enclosure position | `level.json` → `enclosures[n].centerX` |
| Item depth | `level.json` → `items[n].positionZ` (more negative = deeper) |
| Decorative prop | `level.json` → `props[n].position` |
| Animal spawn | `level.json` → `animals[n].spawnZ` |
| World bounds | `level.json` → `world.bounds` |
| Camera offset | `constants.ts` → `CAMERA_OFFSET_X` (lead), `CAMERA_OFFSET_Z` (trail) |
| Camera height | `GameScene.updateCamera()` — hardcoded `y = 5` |

```
        −Z (into enclosures)
             ↑
  −X ←  [path Z=0]  → +X
             ↓
        +Z (behind player)

  Gate:       Z = −3
  Back wall:  Z = −11
```

---

### Balance the game feel

| Knob | Location | Effect |
|---|---|---|
| **Movement** | | |
| Player walk speed | `level.json` → `world.speed` | Units/sec |
| Camera catch-up | `constants.ts` → `CAMERA_LERP` | Higher = snappier |
| **Timer** | | |
| Active animal countdown | `level.json` → `world.timerDuration` | Seconds, full → 0 |
| Idle animal drain | `constants.ts` → `NEEDS_IDLE_RATE` | Units/sec |
| **Economy** | | |
| Enclosure cost | `level.json` → `enclosures[n].unlockCost` | Stars to unlock |
| Stars per delivery | `level.json` → `phases[n].onComplete.starsAwarded` | |
| **Animals** | | |
| Wander radius | `level.json` → `animals[n].wanderRadius` | World units |
| Walk speed | `level.json` → `animals[n].moveSpeed` | Units/sec |
| Anim blend | `constants.ts` → `ANIM_BLEND_RATE` | Higher = snappier transitions |
| **UX** | | |
| Pickup radius | `constants.ts` → `AUTO_PICKUP_RADIUS` | World units |
| Bubble trigger range | `level.json` → `world.interactRange` | World units |
| Tutorial duration | `level.json` → `tutorial.autoDismissMs` | |

---

### Add or tweak a sound

**Change a volume** — edit `src/scripts/config/AudioConfig.ts`. See §6.2 for the full table.

**Add a new SFX:**
```typescript
// preload():
this.load.audio('sfx-splash', 'assets/audios/splash.mp3')

// anywhere in the scene:
this.sfx.playSfx('sfx-splash', { volume: AudioConfig.sfx.splash })
```

**Swap BGM mid-game:**
```typescript
this.sfx.stopMusic(800)
this.sfx.playMusic('bgm-level2', { fadeIn: 1500 })
```

**Rules:**
- Files must be `.mp3`
- Use `this.sfx`, never `this.sound` (Phaser's built-in — bypasses volume control)
- Looping sounds: pre-create with `this.sound.add('key', { loop: true })` and hold the reference; `playSfx` does not always return a stoppable handle

---

### Key abstractions at a glance

| | |
|---|---|
| **`level.json`** | Level layout, phases, animals, timers, colors |
| **`AudioConfig.ts`** | All volumes |
| **`constants.ts`** | All magic numbers |
| **`AssetLoader`** | GLTF deduplication + fallback sphere on load error |
| **`SoundManager`** | Music fade, SFX volume, mute toggle |
| **`AnimalWander`** | Wander AI + animation blending |
| **`normalizeAnimalHeight`** | Auto-scales any GLB to target world height |
| **`safeItemSpawnPos`** | Rejection-sampling — items never spawn on the player |
| **`BubbleFactory`** | Creates action/purchase bubble Containers |
| **`projectToScreen`** | Three.js Vector3 → Phaser pixel coords |
| **`clampToScreenEdge`** | Off-screen position + arrow angle |
| **`PhaseManager`** | Phase state machine with null-safety |
| **Phaser Tweens** (`this.tweens.add`) | All 2D animation — no manual easing math |
| **`warpSpeed()`** | Three.js renderer + lights in one call |

---

## 1. Overview

Zoo Keeper is a mobile-first playable ad (~45–60 sec, portrait 540×960). Every technical decision follows from delivery:

| Constraint | Reason |
|---|---|
| Single HTML file | Ad networks allow no external CDN dependencies |
| 5 MB budget | Cellular loads; large files cut completion rate |
| No physics (Ammo.js disabled) | Ammo.js wasm is ~2 MB with async init overhead |

**Stack:**
```
Phaser 3      2D engine — UI, input, tweens, audio
enable3d      Attaches Three.js renderer to Phaser
Three.js      3D — meshes, cameras, GLTF, animations
TypeScript    Type safety
Webpack 5     Bundling → single HTML
```

Phaser 2D (`this.add.*`, tweens, input) renders on top of the Three.js 3D scene. Both APIs coexist through `this.third`.

**Structure:**
```
src/scripts/
  game.ts               ← Phaser.Game config + enable3d bootstrap
  constants.ts          ← All magic numbers
  scenes/
    GameScene.ts        ← Main scene (~1650 lines)
  types/
    LevelData.ts        ← TypeScript interfaces for level.json
  zoo/
    AnimalWander.ts     ← Kinematic wander AI + animation blending
  utils/
    AssetLoader.ts      ← GLTF cache with in-flight deduplication
    WorldUI.ts          ← 3D→2D projection + screen-edge clamping
  ui/
    BubbleFactory.ts    ← Action and purchase bubble factory
  managers/
    SoundManager.ts     ← Music + SFX service
    PhaseManager.ts     ← Phase state machine
  config/
    AudioConfig.ts      ← All audio volumes and timings
```

**Bootstrap (`game.ts`):**
```typescript
enable3d(() => new Phaser.Game({
  ...Canvas(),        // required enable3d config injection
  type: Phaser.WEBGL,
  width: 540, height: 960,
  transparent: true,  // lets the Three.js canvas show through
  scene: [GameScene],
}))
```

`enable3d()` must wrap `new Phaser.Game`. `...Canvas()` is mandatory. Deviating from this pattern breaks Three.js initialisation silently.

### No-physics contract

Ammo.js is disabled (`usePhysics: false`). There are no rigid bodies, colliders, or collision events anywhere. All spatial checks are manual:

| Need | Implementation |
|---|---|
| Movement bounds | `Math.max/min` clamp against `world.bounds` every frame |
| Animal enclosure bounds | `AnimalWander.clampTarget()` — rectangular bounds check |
| Item pickup | `Math.hypot(dx, dz) < AUTO_PICKUP_RADIUS` |
| Bubble trigger | `Math.hypot(dx, dz) < interactRange` |
| Zone entry (timer) | X range + `z < enclosureEntryZ` |

Do not re-enable physics for new features — follow the same patterns.

---

## 2. Level Data

### `level.json`

`src/assets/level.json` — single source of truth for all gameplay config. Loaded in `preload()`, accessed throughout the scene as `this.ld`.

**Layout:**
```
X:  −15      −9       0       +11      +20
        [MONKEY]  [ELEPHANT]  [LION]
         free      25⭐        75⭐
```

**Phase chain:**
```
monkey → elephant → lion_toy → lion_food → done
```

### `LevelData.ts` interfaces

| Interface | Shape |
|---|---|
| `LevelData` | Root — shape of `level.json` |
| `WorldConfig` | Speed, bounds, interact range, timer duration |
| `EnvironmentConfig` | Colors, ground/path/floor dimensions |
| `FenceConfig` | Fence GLB, segment width, gate panel count |
| `PlayerConfig` | Model path, start position, scale |
| `EnclosureConfig` | ID, centerX, width, unlock cost |
| `AnimalConfig` | Model, spawn position, wander settings, target height |
| `ItemConfig` | Type, model, position, icon, `startVisible` |
| `PhaseConfig` | Required item, enclosure, delivery icons, `onComplete` |
| `PhaseOnComplete` | Stars, next phase ID, optional item reveal, end-game flag |
| `PropConfig` | Model, position, rotation, scale |
| `TutorialConfig` | Auto-dismiss delay |

TypeScript catches JSON typos at compile time.

---

## 3. `GameScene.ts`

Extends `Scene3D` (enable3d) → `Phaser.Scene`. The entire game runs in this one scene.

### 3.1 Lifecycle

**`init()`** — calls `this.accessThirdDimension({ usePhysics: false, antialias: true })`. Must be here; calling it from `create()` risks the 3D layer not being ready in time.

**`preload()`** — loads 2D PNG assets via Phaser's pipeline. GLBs are loaded in `create()` — they require an active Three.js context.

**`async create()`** — initialisation order:

```
1.  Load level.json → this.ld
2.  Font load (fire-and-forget)
3.  Init purchasedEnclosures (unlockCost=0 open by default)
4.  Lazy-load icon textures from items[] and phases[]
5.  warpSpeed()         — Three.js renderer, lights
6.  buildEnvironment()  — ground, path, enclosure floors
7.  Promise.all([       — parallel:
      loadFences()
      loadPlayer()
      loadAnimals()
      loadItems()
      loadProps()
    ])
8.  Hide items for locked enclosures
9.  setupInteractables()
10. setupCamera()
11. setupJoystick()
12. setupUI()
13. Init SoundManager + pre-create footstep sounds
14. Start BGM
15. needsDrainActive = true
16. _showTutorial()
```

Steps 7a–7e are independent — total load time equals the slowest single asset.

**`update(time, delta)`** — `dt = delta / 1000`. `if (!this.player) return` guards the async boot window.

---

### 3.2 World Building

**`buildEnvironment()`** — ground plane, path strip, and enclosure sand floors via `PlaneGeometry` + `MeshLambertMaterial`. All colors and sizes from `this.ld.environment`. Ground is `receiveShadow = true`.

**`loadFences()`**
1. Loads the fence GLB (cached — one request regardless of panel count)
2. Measures bounding box to get the GLB pivot offset (`pivZ`)
3. Tiles panels around each enclosure; south row omits `gatePanels` at centre for the opening

The runtime pivot-offset measurement makes tiling work with any replacement fence GLB.

---

### 3.3 Player & Animals

**`loadPlayer()`** — loads character GLB, creates an `AnimationMixer` with `idle` and `walk` actions extracted by name. Animation clips must be named exactly `"idle"` and `"walk"` in the GLB export.

**`loadAnimals()`** — fires all GLTF loads in parallel. Per instance:
- `gltf.scene.clone(true)` — **required**; `AssetLoader` caches the template, placing it directly moves the single node instead of creating a copy
- Spread across enclosure width via linear interpolation
- Height normalised by `normalizeAnimalHeight`
- `AnimalWander` instance created with enclosure-scoped bounds
- `AnimalAnimPair` (`staticAction` + `walkAction`) passed to `AnimalWander` — blending is handled internally

Animals with `startLocked: true` are `visible = false` until `purchaseEnclosure()`.

**`normalizeAnimalHeight(group, targetHeight)`** — measures bounding box, applies uniform scale to hit `targetHeight` world units, repositions `y` to sit on the ground plane. Also used in `pickup()` to normalise carried items to `CARRY_ITEM_HEIGHT`.

---

### 3.4 Items & Props

**`loadItems()`** — loads GLBs, places at positions from `level.json`. On load failure, `_fallbackMesh()` creates a coloured sphere so the game remains playable.

**`safeItemSpawnPos(enc, baseY)`** — called whenever an item becomes visible mid-game (phase completion, enclosure unlock, retry). Picks a random position inside the enclosure (X ± 40% of width, Z ∈ [−4, −9]) and retries up to 20× until at least 4 units from the player. Falls back to the back-centre of the enclosure.

**`placeItem(type, pos)`** — moves an item mesh and keeps `itemPositions` and `itemBaseY` (bobbing baseline) in sync. Use this instead of setting `mesh.position` directly.

**`updateItemBobbing(dt)`** — bobs and rotates all non-carried world items via `Math.sin(elapsedTime)`.

**`loadProps()`** — decorative props from `level.json`. AssetLoader deduplication means repeated models (e.g. 8 pine trees) cost one HTTP request; `clone(true)` means one geometry allocation.

---

### 3.5 Interaction System

```typescript
interface Interactable {
  id:            string
  getWorldPos:   () => Vector3   // bubble anchor in 3D
  action:        () => void      // fired on tap
  isAvailable:   () => boolean   // evaluated every frame
  bubbleLabel:   string          // emoji fallback
  bubbleIcon?:   string          // Phaser texture key (preferred)
  bubbleSprite?: Phaser.GameObjects.Container
}
```

`isAvailable` is a closure — captures live references so it always reflects current state.

**`updateBubbles()`** — per frame:
1. Evaluates `isAvailable()` and proximity
2. Calls `_showBubble` / `_hideBubble` **only on state change** (via `prevBubbleVisible`) — avoids competing tweens
3. Projects `getWorldPos()` to screen coords and moves the sprite

**`_showBubble` / `_hideBubble`** — `Back.easeOut` pop-in, `Quad.easeIn` pop-out, ±8° wiggle while visible. Pop-in plays `sfx-whoosh`.

**`updateAutoPickup()`** — collects the current phase's required item when player is within `AUTO_PICKUP_RADIUS` (1.8 units). No tap required.

---

### 3.6 HUD & UI

**Prestige bar** — horizontal bar with three animal milestones. Advances on full animal phase completion (`!onComplete.showItemType && starsAwarded > 0`); intermediate `showItemType` steps do not advance it.

**Animal HUD** — floating portraits above each enclosure, projected via `projectToScreen`. Active animal has a radial needs ring (green→yellow→red). Off-screen animals get edge-clamped positions with a directional arrow (`clampToScreenEdge`, `topMargin = 70px` below the prestige bar).

**Star HUD** — on award, 5 star sprites fly from delivery point to the counter with a "+N" popup. Each star plays `sfx-coin` at rate 0.9→1.1 (ascending jingle, single audio file).

**Pickup arrows** — bouncing arrow above the current required item. Disappears on pickup.

**Tutorial** — hand icon + "SWIPE" label above joystick. Dismisses on first joystick input or after `tutorial.autoDismissMs`.

---

### 3.7 Movement & Camera

**`handleMovement(dt)`** — `right * speed * dt` on X, `top * speed * dt` on Z. Rotation via `Math.atan2(right, -top)`. Position clamped to `world.bounds` every frame. Animation crossfades on state change (`fadeOut/fadeIn(0.2)`). First movement dismisses the tutorial.

Footsteps are pre-created as three looping `Phaser.Sound.BaseSound` objects. `.play()` / `.stop()` is called directly on held references — more reliable than `playSfx` for loops.

**`updateCamera()`:**
```typescript
camera.position.x = lerp(camera.position.x, player.x + CAMERA_OFFSET_X, CAMERA_LERP)
camera.position.y = 5  // fixed height
camera.position.z = lerp(camera.position.z, player.z + CAMERA_OFFSET_Z, CAMERA_LERP)
camera.lookAt(player.x + 2, player.y + 0.5, player.z)
```

**`updateCarryStack()`** — `y = playerY + 2 + index * 0.6 + sin(time)`.

---

### 3.8 Game Loop

| Method | Responsibility |
|---|---|
| `handleMovement(dt)` | Joystick → player position + animations |
| `updateCarryStack()` | Carried items above player head |
| `updateItemBobbing(dt)` | Bob + spin world items |
| `updateCamera()` | Lerp camera toward player |
| `updateAutoPickup()` | Proximity item collection |
| `updatePickupArrows()` | Arrow projection + visibility |
| `updateBubbles()` | Bubble show/hide/position |
| `updateAnimalHud()` | HUD portraits + needs rings |
| `updateNeeds(dt)` | Needs drain for all animals |
| Animal wander loop | `AnimalWander.update(dt)` per animal |

---

### 3.9 Phase Flow, Delivery, Fail & End

**Delivery** — `deliver(type)` removes the item from carry stack and emits `delivery:success`. Five focused listeners handle all consequences:

| Listener | Responsibility |
|---|---|
| `delivery:sfx` | Animal cheer + success FX |
| `delivery:visual` | Bounce, hearts, stars |
| `delivery:stars` | `flyStars()` if `starsAwarded > 0` |
| `delivery:state` | Reset needs, mark `fedAnimals`, advance prestige |
| `delivery:transition` | Reveal next item / end game / activate timer |

New delivery consequences are new `events.on` listeners — existing code is untouched.

**`purchaseEnclosure(encId)`** — double-tap guard: adds the enclosure ID to `purchasedEnclosures` before any star deduction. Subsequent calls exit immediately. This prevents two rapid taps from both passing the star-count check before either deducts.

**`updateNeeds(dt)`** — iterates all animals every frame:
- Active animal: drains at `1 / timerDuration` (0→1 in `timerDuration` seconds)
- Other unlocked, unfed animals: drain at `NEEDS_IDLE_RATE`

At zero: screen shake → "YOU'RE FIRED!" overlay → retry.

**`retryCurrentAnimal()`** — drops carried items, reverts two-step phases (hides revealed items), restores needs to 1.0. Does not restart the full game.

**`showEndcard()`** — full-screen CTA. Staggered animation: panel slides up → logo drops → giraffe punches in → button pulses. CTA:

```typescript
if (typeof window.onCTATapped === 'function') window.onCTATapped()
else window.open('https://play.google.com/store/apps/details?id=...', '_blank')
```

Replace the placeholder URL before shipping.

---

## 4. Animal AI — `AnimalWander.ts`

Standalone kinematic AI. Decoupled from scene internals — receives a `Group` reference and moves it each frame.

**States:**
```
MOVING  → reaches waypoint (dist < 0.2)       → WAITING
        → boundary overrun                     → new target biased toward origin
WAITING → wait timer expires                   → MOVING
```

**Construction:**
```typescript
new AnimalWander(group, config, anims?)
// anims: { staticAction, walkAction } — optional AnimationMixer pair
```

When `anims` is provided, both actions start at weight 0/1 so blending works from the first frame. Blend is driven in `update()`:

```typescript
const target = this.isMoving ? 1 : 0
animBlend += (target - animBlend) * BLEND_RATE * dt  // BLEND_RATE = 6
staticAction.weight = 1 - animBlend
walkAction.weight   = animBlend
```

**`clampTarget(v)`** — rectangular hard bounds on every new waypoint. Visual-only fences have no colliders; this is their substitute.

Idle bounce uses `Math.abs(Math.sin(jumpTime))` — the `abs` fold creates a double-bounce that reads as more organic than a plain sine.

---

## 5. Utility Modules

### 5.1 `constants.ts`

| Constant | Value | |
|---|---|---|
| `GAME_W` / `GAME_H` | 540 / 960 | Canvas dimensions |
| `FONT` | `"Baloo 2", sans-serif` | All text elements |
| `ACTION_BUBBLE_W/H` | 74 × 74 | Action bubble size |
| `PURCHASE_BUBBLE_W/H` | 74 × 88 | Purchase bubble size |
| `BUBBLE_RADIUS` | 16 | Rounded corner radius |
| `CAMERA_LERP` | 0.1 | Camera follow smoothing |
| `CAMERA_OFFSET_X/Z` | 2 / 10 | Camera lead / trail |
| `AUTO_PICKUP_RADIUS` | 1.8 | Item auto-collect distance (world units) |
| `CARRY_ITEM_HEIGHT` | 0.35 | Carried item normalised height |
| `ANIM_BLEND_RATE` | 6 | Walk↔idle blend multiplier |
| `HUD_RING_RADIUS` | 32 | Needs ring pixel radius |
| `HUD_EDGE_MARGIN` | 58 | Off-screen indicator edge margin |
| `HUD_TOP_MARGIN` | 70 | Top clamp below prestige bar |
| `NEEDS_IDLE_RATE` | 0.025 | Idle animal drain per second |

---

### 5.2 `AssetLoader.ts`

Three-layer GLTF deduplication:

| Layer | Mechanism |
|---|---|
| Cache | `Map<path, gltf>` — resolved immediately on repeat calls |
| In-flight | `Map<path, Promise>` — concurrent requests for same path share one fetch |
| Failed | `Set<path>` — known-bad paths return `null` immediately |

```typescript
const gltf = await loader.loadGltf('assets/pets/animal-monkey.glb')
const group = gltf.scene.clone(true)   // always clone — see below
```

**The `.clone(true)` contract:** `loadGltf` always returns the same cached template. Placing it directly in the scene moves the template node — all but one instance disappear. Every placement must call `gltf.scene.clone(true)`.

---

### 5.3 `WorldUI.ts`

**`projectToScreen(worldPos, camera, w?, h?)`**
```typescript
{ x: (v.x + 1) / 2 * w, y: (1 - v.y) / 2 * h }
```
NDC [−1, 1] → Phaser pixel coords. Defaults to `GAME_W` / `GAME_H`.

**`clampToScreenEdge(tx, ty, margin, w?, h?, topMargin?)`** — returns the nearest on-screen edge position and the angle toward the original point. Drives off-screen HUD directional arrows.

---

### 5.4 `BubbleFactory.ts`

Returns invisible, zero-scale, interactive Phaser `Container`s. `_showBubble` / `_hideBubble` manage lifecycle.

**`createActionBubble(scene, label, options?)`** — white rounded-rect, icon or emoji, tap-pointer, CTA label (default: `'GIVE'`).

**`createPurchaseBubble(scene, cost, options?)`** — gold rounded-rect, star icon, cost, tap-pointer, CTA label (default: `'UNLOCK'`).

---

### 5.5 `PhaseManager.ts`

```typescript
const pm = new PhaseManager(this.ld.phases)

pm.currentId    // string | null
pm.current      // PhaseConfig | null
pm.isDone       // true after last phase
pm.advance()    // step to next phase
pm.findById(id)
pm.indexOf(id)
```

Phase list comes from `level.json` — no code change needed when phases are added.

---

## 6. Audio

### 6.1 `SoundManager.ts`

```typescript
// Init:
this.sfx = new SoundManager(this, { musicVolume: 0.25, sfxVolume: 0.85 })

// Music:
this.sfx.playMusic('bgm', { fadeIn: 1500 })
this.sfx.stopMusic(800)

// SFX:
this.sfx.playSfx('sfx-coin')
this.sfx.playSfx('sfx-coin', { volume: 0.7, rate: 1.1 })

// Mute:
this.sfx.toggleMute()

// Teardown (call from shutdown()):
this.sfx.destroy()
```

Field is `this.sfx`, not `this.sound` — `Phaser.Scene.sound` is a built-in; shadowing it causes TypeScript errors.

`playSfx` handles `NoAudioSoundManager` (locked audio context) — always returns `BaseSound | null`.

**Audio events:**

| Event | Key | Notes |
|---|---|---|
| BGM | `bgm` | Fade in 1500ms |
| Walk | `sfx-footstep-1/2/3` | Random variant, pre-created, looping |
| Bubble pop | `sfx-whoosh` | Via `_showBubble` |
| Delivery | `sfx-monkey/elephant/lion` | Phase-specific |
| Star collect | `sfx-coin` | Rate 0.9→1.1 across 5 stars |
| Enclosure buy | `sfx-coin` | Full volume |
| End card | `sfx-win` + BGM fade | Via `showEndcard` |

---

### 6.2 `AudioConfig.ts`

```typescript
export const AudioConfig = {
    master: { music: 0.25,  sfx: 0.85 },
    sfx: {
        footstep: 0.20,
        whoosh:   1.0,
        animal:   0.75,
        coin:     1.0,
        coinStar: 0.7,
        win:      1.0,
    },
    timing: { musicFadeIn: 1500, musicFadeOut: 800 },
}
```

| To change | Field |
|---|---|
| Music level | `master.music` |
| All SFX | `master.sfx` |
| Footsteps | `sfx.footstep` |
| Bubble whoosh | `sfx.whoosh` |
| Coin / purchase | `sfx.coin` |
| Star jingle | `sfx.coinStar` |
| Animal cheer | `sfx.animal` |
| Win fanfare | `sfx.win` |
| BGM fade times | `timing.musicFadeIn/Out` |

---

## 7. Asset Map

### 3D Models (GLB)

| File | |
|---|---|
| `assets/character-male-e.glb` | Player (idle + walk clips) |
| `assets/pets/animal-monkey.glb` | Monkey (static + walk clips) |
| `assets/pets/animal-elephant.glb` | Elephant |
| `assets/pets/animal-lion.glb` | Lion |
| `assets/food/banana.glb` | Banana pickup |
| `assets/food/barrel.glb` | Water barrel pickup |
| `assets/food/turkey.glb` | Turkey pickup (revealed after lion_toy) |
| `assets/graveyard/iron-fence-border.glb` | Fence segment (tiled) |
| `assets/env/coaster/bench.glb` | Bench prop |
| `assets/env/coaster/trash.glb` | Trash can prop |
| `assets/env/coaster/flowers.glb` | Flowers prop |
| `assets/env/coaster/tree.glb` | Tree prop |
| `assets/env/graveyard/hay-bale.glb` | Hay bale prop |
| `assets/env/graveyard/rocks.glb` | Rocks prop |
| `assets/env/graveyard/pine.glb` | Pine tree prop |

### UI Sprites (PNG)

| File | |
|---|---|
| `assets/ui/star.png` | Currency icon |
| `assets/ui/padlock.png` | Locked enclosure (HUD) |
| `assets/ui/throphy.png` | Trophy |
| `assets/ui/pointer.png` | Tap hint |
| `assets/ui/heart.png` | Delivery hearts |
| `assets/ui/gift.png` | Prestige bar milestone |
| `assets/ui/button.png` | Star HUD background |
| `assets/ui/button-red.png` | Try Again button |
| `assets/ui/arrow.png` | Pickup directional arrow |
| `assets/ui/animal-monkey.png` | Monkey portrait |
| `assets/ui/animal-elephant.png` | Elephant portrait |
| `assets/ui/animal-lion.png` | Lion portrait |
| `assets/ui/game-logo.png` | Endcard logo |
| `assets/ui/final-panel.png` | Panel card (fail + endcard) |
| `assets/ui/CTA-button.png` | Endcard play button |
| `assets/ui/giraffe-unlocked.png` | Endcard teaser |
| `assets/ui/cta-background.png` | Endcard background |
| `assets/ui/broken-star.png` | Failure screen |
| `assets/ui/banana.png` + `assets/food/icons/banana.png` | Delivery + pickup icons |
| `assets/ui/barrel.png` + `assets/food/icons/barrel.png` | Delivery + pickup icons |
| `assets/ui/turkey.png` + `assets/food/icons/turkey.png` | Delivery + pickup icons |
| `assets/ui/coconut.png` | Lion toy delivery icon |

### Audio (MP3)

All files must be `.mp3`.

| File | Key | |
|---|---|---|
| `assets/audios/bgm.mp3` | `bgm` | BGM loop |
| `assets/audios/win-sound.mp3` | `sfx-win` | End-card fanfare |
| `assets/audios/monkey.mp3` | `sfx-monkey` | Monkey cheer |
| `assets/audios/elephant.mp3` | `sfx-elephant` | Elephant cheer |
| `assets/audios/lion.mp3` | `sfx-lion` | Lion cheer |
| `assets/audios/Coin Bag 3-1.mp3` | `sfx-coin` | Stars + purchase |
| `assets/audios/Whoosh.mp3` | `sfx-whoosh` | Bubble pop |
| `assets/audios/Footsteps_Sand_Walk_01.mp3` | `sfx-footstep-1` | Walk variant 1 |
| `assets/audios/Footsteps_Sand_Walk_10.mp3` | `sfx-footstep-2` | Walk variant 2 |
| `assets/audios/Footsteps_Sand_Walk_17.mp3` | `sfx-footstep-3` | Walk variant 3 |

---

*Updated March 2026.*
