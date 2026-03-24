# 🦁 GDD — Zoo Keeper Playable Ad

---

## Synopsis

You are the manager of a small zoo — and your animals are not happy. Move through the zoo path, discover what each animal needs, and deliver the right item before time runs out.

The player controls a character from a third-person follow camera, moving primarily left-to-right (with depth movement available) via a virtual joystick. Walking near a pickup item automatically grabs it; walking into an enclosure zone shows a delivery bubble to tap and complete the drop-off. Carried items stack visibly on the player's head (up to 2 at once).

Three animals wait along the path: a **Monkey** who is hungry, an **Elephant** who is thirsty, and a **Lion** who is both hungry and dangerous. Caring for each animal earns stars, which are spent to unlock the next enclosure — whose species is hidden as a dark silhouette until purchased. The Lion requires a two-step sequence: throw in a coconut toy to distract it first, then deliver the turkey while it's occupied.

If the per-animal countdown timer expires, a "YOU'RE FIRED!" screen appears — but a friendly retry button puts the manager back on the job without restarting from scratch. Succeed with all three animals and the zoo erupts in celebration, followed by a "NEW ANIMAL UNLOCKED" teaser and a download CTA.

---

## 1. Clarifying Questions & Assumed Answers

**Q1. How does the player discover what an animal needs?**

The briefing says the player "checks for each animal's need" and doesn't specify how that need is communicated. Is it shown through a floating icon, an animation, a sound cue, or does the player have to tap the animal first to reveal it?

> **Answer:** A floating need icon appears above each animal from the start of that enclosure's phase (banana above Monkey, water droplet above Elephant, meat above Lion). Additionally, a bouncing arrow floats above the exact item the player currently needs to pick up, removing any ambiguity. Both cues are immediately readable without an extra tap.

---

**Q2. What is the exact interaction mechanic to fulfill a need?**

"Taking care" of an animal is described but not mechanically defined. Should the player tap a button, drag an item to the animal, perform a gesture, or complete a mini-game?

> **Answer:** The player moves with a virtual joystick. Walking within 1.8 world units of the phase-required item **automatically picks it up** — no tap needed. Once inside the correct delivery zone, a bubble appears above the delivery point; tapping it completes the delivery. The core mechanic is **walk near item → auto-grab → walk into zone → tap bubble**:
> - **Monkey** → walk near banana → auto-grab → enter monkey enclosure → tap delivery bubble
> - **Elephant** → walk near water barrel → auto-grab → enter elephant enclosure → tap delivery bubble
> - **Lion** → two-step: walk near coconut toy → auto-grab → enter lion enclosure → tap to throw in → turkey is revealed → walk near turkey → auto-grab → re-enter enclosure → tap delivery bubble

---

**Q3. Are locked animals visible before being unlocked, or hidden entirely?**

The briefing says each care action "unlocks a new one," but it's unclear whether upcoming animals are visible (but inactive) or completely hidden.

> **Answer:** All three enclosures are visible from the start, but the second and third animals are shown only as dark silhouettes with a padlock icon in the HUD portrait — the exact species is never revealed until the enclosure is purchased with stars. The enclosure structure (fence, ground, props) is fully visible, giving a clear sense of progression and spatial layout without spoiling the animal.

---

**Q4. In a 3D environment, what does "moving the screen horizontally" mean exactly?**

In 2D this is a simple pan. In 3D it could mean a camera dolly, a character walking a path, or swipe-to-rotate. The perspective is unspecified.

> **Answer:** The camera follows the player via a smoothed lerp in both X and Z, always positioned above and behind. The player runs left-to-right along the zoo path to progress between animals, but can also step into enclosure depth (Z axis) to reach items placed inside. The dominant direction of travel is horizontal, preserving the "scroll" feel while allowing natural exploration within each enclosure.

---

**Q5. Is there a fail state or time pressure?**

The briefing doesn't mention consequences for inaction. Should animals become sadder over time? Can the player fail?

> **Answer:** Yes. Each animal has a needs meter that drains continuously once active. The first animal's drain starts immediately at game boot; each subsequent animal's drain starts as soon as the previous delivery is completed. If the active animal's needs reach zero, a screen shake fires followed by a "YOU'RE FIRED!" overlay — panel card, broken star icon, subtitle "YOUR ANIMALS NEED YOU.", and a "TRY AGAIN" button. Retry resets only the current animal — no full restart. All unlocked-but-unfinished animals also have a slow passive drain (visible as HUD ring) to reward efficient play, but only the active animal triggers the fired screen.

---

**Q6. What should the endcard contain beyond a download button?**

The briefing specifies "a download button instigating the player to play more" but defines nothing else.

> **Answer:** Staggered animated sequence: background illustration → panel card slides up → game logo drops in → giraffe teaser punches in with "NEW ANIMAL UNLOCKED" copy → pulsing "PLAY NOW!" CTA button. Win SFX plays; BGM fades out. The giraffe teaser exploits FOMO — the player sees what they could unlock in the full game.

---

**Q7. Should there be audio?**

The briefing makes no mention of sound effects or music.

> **Answer:** Yes. A cheerful background music loop plus interaction SFX: footstep variants (3 clips, randomly chosen), bubble whoosh on pop-in, per-animal delivery cheers, an ascending coin jingle as each star flies to the HUD, and a win fanfare on endcard. Audio is toggleable. All audio events are managed by a centralised `SoundManager` with independent music/SFX volume controls.

---

**Q8. What is the visual/art direction?**

The briefing says nothing about style, color palette, or tone.

> **Answer:** Low-poly 3D, bright saturated colors, cute cartoon sensibility. Lightweight GLB models with baked idle and walk animations, flat-colored ground planes, and a Phaser 2D overlay for all HUD and UI. Font: Baloo 2 (friendly, rounded, mobile-legible).

---

**Q9. Should the game be 2D or 3D?**

The briefing does not specify the dimensionality of the game world.

> **Answer:** 3D world with a 2D UI overlay. The game uses Phaser 3 as the app shell (input, tweens, audio, HUD) with enable3d providing a Three.js 3D rendering layer. Low-poly GLB models populate the world; all HUD elements, bubbles, and overlays are Phaser 2D objects rendered on top. This hybrid approach delivers a polished 3D feel while keeping the codebase maintainable and the build within budget.

---

**Q10. Should the player be able to fail / lose?**

Related to Q5, but specifically: should there be a lose state, and if so, how punishing should it be?

> **Answer:** Yes — soft fail per animal. When the active animal's timer hits zero, a comedic "YOU'RE FIRED!" screen appears. The player retries that single animal (timer resets, carried items dropped, two-step phases revert to their first step). The full game never restarts from the beginning. Wrong-item delivery is not a fail condition — auto-pickup only grabs the phase-required item, making wrong delivery structurally impossible.

---

**Q11. Should the player move horizontally only, or primarily horizontally?**

The briefing describes "moving the screen horizontally" but the game is 3D — the player could be constrained to a rail or free to move in all directions.

> **Answer:** Primarily horizontally. The joystick is 8-directional, so the player can move into enclosure depth (Z axis) to reach items placed inside. However, the entire level runs left-to-right — three enclosures spaced along the X axis, with the main path at Z ≈ 0. The dominant direction of travel and narrative progression is horizontal. World bounds clamp the player to X ∈ [−15, 20] and Z ∈ [−12.5, 4].

---

## 2. Game Overview

| Field | Value |
|---|---|
| **Format** | Playable Ad (Web, HTML5) |
| **Engine** | Phaser 3 + enable3d (Three.js 3D layer) |
| **Language** | TypeScript |
| **Bundler** | Webpack 5 |
| **Target Duration** | ~45–60 seconds |
| **Build Size Limit** | 5 MB |
| **Delivery** | Single self-contained `index.html` (assets base64-inlined) |
| **Resolution** | Portrait 540 × 960 |
| **Art Style** | Low-poly 3D, cute/colorful |
| **Core Fantasy** | You are a zoo manager. Your animals need you |

---

## 3. Animals & Interactions

| Order | Animal | Need | Item | Mechanic | Notes |
|---|---|---|---|---|---|
| 1st | 🐒 Monkey | Hungry | 🍌 Banana | Auto-grab banana → enter enclosure → tap delivery bubble | First phase, always unlocked |
| 2nd | 🐘 Elephant | Thirsty | 🛢 Water Barrel | Auto-grab barrel → enter enclosure → tap delivery bubble | Costs 25 ⭐ to unlock |
| 3rd | 🦁 Lion | Hungry + Dangerous | 🥥 Coconut Toy → 🍗 Turkey | Step 1: auto-grab toy → enter enclosure → tap to throw. Step 2: turkey is revealed → auto-grab → re-enter → tap delivery bubble | Costs 75 ⭐ to unlock; two-phase sequence |

All three animals share the same core verb. Variety comes from level layout, the lion's two-step sequence, and the star-gate progression. Items bob and spin in the world to aid discoverability; a bouncing arrow above the current required item removes ambiguity for first-time players. The player can carry up to 2 items at once (visible stack on head).

---

## 4. Core Loop

```
Spawn (timer already draining for first animal)
       ↓
Walk near item → Auto-grab
       ↓
Walk into delivery zone → Tap bubble → Deliver
       ↓
Earn ⭐ Stars → Fly to HUD counter
(timer resets and restarts for next animal)
       ↓
[next enclosure locked?]
Yes → Tap purchase bubble → Spend ⭐ → Unlock → Repeat
No  → Move to next animal → Repeat
       ↓
  [all 3 done]
       ↓
    Endcard
```

**Fail path:**

```
Needs reach 0 → Camera shake → "YOU'RE FIRED!" overlay → TRY AGAIN → Retry current animal only
```

---

## 5. User Flow

### 5.1 Loading State

- Minimal loading screen with game logo and progress bar
- Target: under 2 seconds on average mobile connection
- All GLTF models load in parallel at startup

### 5.2 Gameplay

- Player character moves via on-screen virtual joystick (bottom-right, dynamic — anchors to first touch point)
- Tutorial hand icon + "SWIPE" label appears at game start; auto-dismisses after 9 seconds or on first joystick input
- A bouncing arrow floats above the current phase's required item, pointing directly at it
- Walking within 1.8 world units of the required item auto-grabs it — no tap needed
- Grabbed items appear as a visual stack above the player's head (max 2 items, with bob animation)
- Walking into a delivery zone shows a tap bubble above the delivery point
- Tapping the bubble delivers the item: per-animal cheer SFX + animal bounce tween + hearts VFX
- Stars are awarded and fly individually from the delivery point to the star HUD counter (ascending coin pitch per star)
- If the next enclosure is locked, a gold purchase bubble appears at its entrance; tapping spends stars and unlocks the animal with a reveal animation
- The active animal's needs drain continuously from game start; the drain resets and resumes for the next animal immediately after each delivery
- Needs reach zero → camera shake → "YOU'RE FIRED!" overlay (broken star icon, subtitle *"YOUR ANIMALS NEED YOU."*, red "TRY AGAIN" button) → retry current animal only
- Animal HUD portraits float above each enclosure in world space, each showing a radial needs ring (green → yellow → red as needs drain)
- Off-screen HUD portraits clamp to screen edges with a directional arrow pointing toward the enclosure

### 5.3 Endcard

- BGM fades out; win SFX plays
- Staggered animation sequence:
  1. Background illustration fades in
  2. Panel card + "YOUR ZOO IS BOOMING!" headline + "PLAY NOW!" button slide up from bottom as a group
  3. Game logo drops in from top
  4. Giraffe teaser punches in with "NEW ANIMAL UNLOCKED" copy
  5. "PLAY NOW!" CTA button pulses continuously (scale-bounce loop)
- Button triggers standard ad-network store redirect (`window.onCTATapped` hook with `window.open` fallback)

---

## 6. VFX Budget

All currently implemented effects are **tween-based** — no real particle systems yet. The budget allows up to 3 if needed for heavier effects.

| # | Effect | Implementation | Trigger | Status |
|---|---|---|---|---|
| — | Happy burst | 5 heart images tweened (scale-in + float-up-fade) | Animal successfully cared for | ✅ Implemented |
| — | Unlock reveal | 3D group scale bounce ×3 (yoyo tween) | Enclosure purchased | ✅ Implemented |
| 1 | Endcard confetti | Particle — colored paper pieces | Endcard appears | 🔲 Planned |

**Tween-only effects:**

- Animal bounce on success (Y-axis scale)
- Need icon bob (Y-axis sine wave)
- Item world bob + spin (passive, always on)
- CTA button pulse (uniform scale loop)
- Fail screen camera shake (before overlay appears)
- Padlock icon scale-out on unlock
- Star fly-to-HUD (5 sprites fly from delivery point to counter; counter ticks up as each arrives)
- "+N stars" popup spring from delivery point (scale bounce)
- Prestige bar fill advance (width tween + animal portrait tint: dark → full color)
- Giraffe teaser punch-in on endcard (Back.easeOut scale from zero)
- UI overlay slide-in (Y-axis ease-out)

---

## 7. Asset Budget

Total hard limit: **5 MB**

| Category | Budget | Notes |
|---|---|---|
| Phaser + enable3d bundle | ~350 KB | Gzipped (Phaser ~200KB, enable3d + Three.js ~150KB) |
| 3D models (GLB) | ~900 KB | Player + 3 animals + fence segment + ~7 env props |
| Animations | ~300 KB | Idle + walk per character/animal, baked into GLBs |
| Textures | ~600 KB | 1 atlas per animal, 512×512px |
| Environment | ~300 KB | Ground planes, path, enclosure floors (procedural colored meshes) |
| UI sprites | ~150 KB | Need icons, padlock, star, pointer, portraits, buttons, logo — PNG |
| Audio — Music | ~300 KB | 1 loop, MP3, mono, 96kbps |
| Audio — SFX | ~300 KB | ~10 effects (footstep ×3, whoosh, animal cheers ×3, coin, win) |
| Code + HTML | ~200 KB | TypeScript compiled + Webpack bundle |
| Buffer | ~800 KB | Covers base64 inflation (~33%) for single-HTML delivery |
| **Total** | **~4.0 MB** | ~1 MB under the 5 MB hard limit |

> ⚠️ If the build approaches 4.5 MB, cut the music loop first — keep SFX only.

---

## 8. Technical Notes

### Engine: Phaser 3 + enable3d

- **Phaser 3** handles: 2D canvas, virtual joystick input, tweens, audio, all HUD and UI elements
- **enable3d** bridges Phaser to a **Three.js** 3D renderer sharing the same WebGL context
- **TypeScript** for full type safety across all game code
- **Webpack 5** bundles everything; base64 asset inlining produces the single-HTML ad deliverable
- Version-controlled on Git normally — no proprietary project format or browser-locked editor

### No Physics

Ammo.js is **explicitly disabled** (`usePhysics: false`). This saves ~2 MB of wasm and removes async init complexity.

| What physics would normally handle | How it's done instead |
|---|---|
| Character movement | `position.x += direction * speed * dt` |
| World bounds | `Math.max(MIN, Math.min(MAX, pos))` |
| Proximity detection | `Math.hypot(a.x - b.x, a.z - b.z) < radius` |
| Fence collision | Visual-only fences; `AnimalWander` uses rectangular clamp bounds |

### Input

- **Movement:** 8-directional virtual joystick (dynamic — anchors to first touch point)
- **Interaction:** single tap on delivery or purchase bubble
- **Item pickup:** automatic on proximity — no tap required

### Data-Driven Level

All positions, speeds, item definitions, phase rules, enclosure unlock costs, and colors live in `level.json`. Adding a new animal or adjusting timer duration requires no TypeScript code changes.

### Build & Delivery

```
npm run start   → dev server at http://localhost:8080
npm run build   → production build in dist/
```

For single-HTML ad delivery, all assets are base64-inlined via Webpack loaders. The final `index.html` is self-contained with zero external dependencies.

---

## 9. Out of Scope

Deliberately excluded to respect the 1-minute duration and 5 MB limit:

- Character customization or skins
- Persistent save state
- Multiplayer or social features
- Narrative dialogue or cutscenes
- Dynamic physics simulation

---

## 10. Planned but Removed

Features originally designed or considered that were cut or superseded during development:

| Feature | Original Plan | Why Removed / Changed |
|---|---|---|
| **PlayCanvas engine** | Initial engine choice for its small footprint and web-first export | Replaced by Phaser 3 + enable3d for full code control, standard Git workflow, and a better 2D/3D hybrid architecture |
| **`playcanvas-rest-api-tools` export** | `npm run one-page` to embed all assets into a single HTML file | No longer applicable — Webpack 5 handles bundling and base64 asset inlining natively |
| **Tap-to-pickup interaction** | Player taps a bubble above a food crate to pick it up | Replaced by auto-pickup on proximity — tap-while-using-joystick is ergonomically awkward; auto-grab on walk is the standard mobile 3D UX pattern |
| **Wrong-item delivery fail state** | Delivering the wrong food item triggers an immediate fail screen | Structurally removed — auto-pickup only grabs the phase-required item, making wrong delivery impossible by design |
| **"Economy / currency system" out of scope** | Original brief listed this as explicitly excluded | Re-scoped in as the star system: stars are earned on delivery and spent to unlock enclosures, creating a lightweight progression loop within the ad |
| **Horizontal-only movement** | Original brief implied a left-to-right side scroller | Expanded to 8-directional 3D movement so the player can navigate enclosure depth to reach items |
