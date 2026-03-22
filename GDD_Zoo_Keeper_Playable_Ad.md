# 🦁 GDD — Zoo Keeper Playable Ad

---

## Synopsis

You are the manager of a small zoo — and your animals are not happy. Move through the zoo path, find out what each animal needs, grab the right food or item from the crates along the way, and deliver it before time runs out.

The player controls a character from a third-person side view, moving left and right with a virtual joystick. Interactable objects — crates, animals, troughs — show a tap bubble when the player is nearby. Tapping the bubble picks up or delivers an item. Carried items stack visibly on the player's head (up to 2 at once).

Three animals wait along the path: a **Monkey** who is hungry, an **Elephant** who is thirsty, and a **Lion** who is both hungry and dangerous. Caring for each one unlocks the next enclosure, whose animal is hidden as a silhouette until revealed. The Lion requires a two-step approach — distract it with a toy first, then sneak the food in while it's occupied.

Fail to deliver in time, or bring the wrong item, and it's back to the start of that animal's challenge. Succeed with all three and the whole zoo erupts in celebration — followed by a download CTA inviting the player to keep the adventure going.

---

## 1. Clarifying Questions & Assumed Answers

**Q1. How does the player discover what an animal needs?**

The briefing says the player "checks for each animal's need" and doesn't specify how that need is communicated. Is it shown through a floating icon, an animation, a sound cue, or does the player have to tap the animal first to reveal it?

> **Answer:** A floating need icon appears above each animal from the start of the interaction with that enclosure (banana above Monkey, water droplet above Elephant, meat above Lion). Immediately readable without an extra tap — suits the low-friction nature of playable ads.

---

**Q2. What is the exact interaction mechanic to fulfill a need?**

"Taking care" of an animal is described but not mechanically defined. Should the player tap a button, drag an item to the animal, perform a gesture, or complete a mini-game?

> **Answer:** The player moves with a virtual joystick. Every interactable object (food crates, animals, troughs) shows a bubble above it when the player is in proximity. Tapping that bubble triggers the interaction. The core mechanic is **move into range → tap bubble**:
> - **Monkey** → move near banana crate → tap bubble to pick up → move near cage → tap bubble to deliver
> - **Elephant** → move near water bucket → tap bubble to pick up → move near trough → tap bubble to deliver
> - **Lion** → two-step: move near toy crate → tap bubble to pick up → move near cage entrance → tap bubble to toss in (lion chases, collision disabled) → walk past lion to food pot → tap bubble to pick up → move near lion → tap bubble to deliver

---

**Q3. Are locked animals visible before being unlocked, or hidden entirely?**

The briefing says each care action "unlocks a new one," but it's unclear whether upcoming animals are visible (but inactive) or completely hidden.

> **Answer:** All three enclosures are visible from the start, but the second and third animals are shown only as dark silhouettes behind a padlock icon — the exact species is never revealed until unlocked. The enclosure itself (fence, ground, props) is fully visible, giving the player a clear sense of progression and spatial layout without spoiling the surprise of which animal comes next. Shape recognition may hint at the animal, but no colors, textures, or animations are shown.

---

**Q4. In a 3D environment, what does "moving the screen horizontally" mean exactly?**

In 2D this is a simple pan. In 3D it could mean a camera dolly, a character walking a path, or swipe-to-rotate. The perspective is unspecified.

> **Answer:** The camera follows a fixed horizontal dolly path at a slight angle — a third-person side view. The player moves their character left-to-right using the virtual joystick; the camera follows. This preserves the "horizontal scroll" feel from the briefing in a 3D context, while remaining readable and intuitive.

---

**Q5. Is there a fail state or time pressure?**

The briefing doesn't mention consequences for inaction. Should animals become sadder over time? Can the player fail?

> **Answer:** Yes. Each enclosure has its own per-animal countdown timer that activates when the player enters that zone. If the timer expires, or if the player picks up and delivers the wrong food item to the animal, a fail screen appears ("Oh no! Try again?") with a retry button. Failure is framed as funny and encouraging, not punishing.

---

**Q6. What should the endcard contain beyond a download button?**

The briefing specifies "a download button instigating the player to play more" but defines nothing else.

> **Answer:** Game logo, key visual (all 3 happy animals), copy *"Your animals need you!"*, and a large pulsing CTA: **"Download Free"**. Warm tone consistent with the gameplay.

---

**Q7. Should there be audio?**

The briefing makes no mention of sound effects or music.

> **Answer:** Yes. A cheerful background music loop plus interaction SFX (splash, chomp, bounce, lion roar). Audio muted by default and toggleable. Meaningful polish at minimal file size cost.

---

**Q8. What is the visual/art direction?**

The briefing says nothing about style, color palette, or tone.

> **Answer:** Low-poly 3D, bright saturated colors, cute cartoon sensibility. Lightweight, instantly recognizable, proven to perform well in mobile game advertising.

---

## 2. Game Overview

| Field | Value |
|---|---|
| **Format** | Playable Ad (Web, HTML5) |
| **Engine** | PlayCanvas (~147KB gzipped) |
| **Target Duration** | ~45–60 seconds |
| **Build Size Limit** | 5 MB |
| **Art Style** | Low-poly 3D, cute/colorful |
| **Core Fantasy** | You are a zoo manager. Your animals need you |

---

## 3. Animals & Interactions

| Order | Animal | Need | Mechanic | Steps |
|---|---|---|---|---|
| 1st | 🐒 Monkey | Hungry | Move + Tap | Move near banana crate → tap bubble to pick up → move near cage → tap bubble to deliver |
| 2nd | 🐘 Elephant | Thirsty | Move + Tap | Move near water bucket → tap bubble to pick up → move near trough → tap bubble to deliver |
| 3rd | 🦁 Lion | Hungry + Dangerous | Move + Tap (two-step) | 1. Move near toy crate → tap bubble to pick up → move near cage entrance → tap bubble to toss in (lion chases, collision disabled) → 2. Walk past lion to food pot → tap bubble to pick up → move near lion → tap bubble to deliver |

All three animals share the same core verb — move into range, tap the bubble — which keeps the mechanic instantly learnable. Variety comes from layout and the lion's two-step obstacle. The player can carry up to 2 items at once, which matters for the lion (toy + food in the same run). Items are displayed on the player's head as a visual carry stack.

---

## 4. Core Loop

```
Spawn → Read need → Move → Pick up → Move → Deliver → Unlock → Repeat
                                                           ↓
                                                      [all 3 done]
                                                           ↓
                                                       Endcard
```

**Fail path:**

```
Wrong item delivered  OR  timer expires → Fail screen → Retry
```

---

## 5. User Flow

### 5.1 Loading State

- Minimal loading screen with game logo and progress bar
- Target: under 2 seconds on average mobile connection

### 5.2 Gameplay

- Player character moves via on-screen virtual joystick (right thumb area, dynamic — anchors to first touch point)
- Every interactable shows a bubble above it when the player is in proximity range
- Tapping a bubble triggers the action (pick up or deliver) — no separate tap button
- Tutorial bubble highlight appears on the first interactable only
- Per-animal timer activates when player enters each enclosure zone (~10s per animal)
- Player moves near food crate → bubble appears → tap to carry (item appears on head, max 2 items)
- Player moves near animal/trough/cage → bubble appears → tap to deliver
- Wrong food item delivered → immediate fail screen for that animal
- Timer expires → fail screen for that animal
- On success: happy burst VFX + animal celebrate animation (scale bounce tween)
- Unlock flash VFX fires on next enclosure activation

### 5.3 Endcard

- Wide shot of all 3 animals celebrating (tween-animated)
- Confetti VFX plays once
- UI overlay slides in from bottom (ease-out tween):
  - Game logo top center
  - Copy: *"Your animals need you!"*
  - CTA: **"Download Free"** (scale pulse tween, looping)
- Button triggers store redirect

---

## 6. VFX Budget

Maximum **3 real particle systems**. All other motion handled via tweens (transform, scale, color) to stay performant and within size budget.

| # | Effect | Type | Trigger |
|---|---|---|---|
| 1 | Happy burst | Particle — stars/hearts | Animal successfully cared for |
| 2 | Unlock flash | Particle — light rays + sparkles | Next enclosure activates |
| 3 | Endcard confetti | Particle — colored paper pieces | Endcard appears |

**Tween-only (no particles):**

- Animal jump on success (Y-axis scale bounce)
- Need icon bob (Y-axis sine wave)
- CTA button pulse (uniform scale loop)
- Fail screen shake (X-axis oscillation)
- Lock icon fade-out on unlock
- Camera pan along zoo path (position lerp)
- UI overlay slide-in (Y-axis ease-out)

---

## 7. Asset Budget

Total hard limit: **5 MB**

| Category | Budget | Notes |
|---|---|---|
| PlayCanvas engine | ~150 KB | Gzipped |
| 3D models (GLB) | ~900 KB | 3 animals ×~200KB + 3 enclosures ×~100KB |
| Animations | ~300 KB | ~3 per animal (idle, happy, fail) baked into GLBs |
| Textures | ~600 KB | 1 atlas per animal, 512×512px, JPG |
| Environment | ~300 KB | Ground, sky, shared props |
| UI sprites | ~150 KB | Need icons, padlock, buttons, logo — PNG atlas |
| Audio — Music | ~300 KB | 1 loop, MP3, mono, 96kbps |
| Audio — SFX | ~300 KB | ~6 effects (chomp, splash, roar, success, fail, button) |
| Code + HTML | ~200 KB | Game logic, tween lib, PlayCanvas scripts |
| Buffer | ~800 KB | Covers base64 inflation (~33%) for single-HTML delivery |
| **Total** | **~4.0 MB** | ~1 MB under the 5MB hard limit |

> ⚠️ **Option A note:** Embedding assets as base64 in a single HTML file inflates binary sizes ~33%. The 800KB buffer accounts for this. If the build approaches 4.5MB, cut the music loop first — keep SFX only.

---

## 8. Technical Notes

### Engine: PlayCanvas

- Native 3D, small footprint (~147KB gzipped), web-first deployment
- Exported as a self-contained HTML build — no server required
- Delivery preference: single HTML → ZIP + assets folder → hosted URL (fallback)
- Export tool: `playcanvas-rest-api-tools` (`npm run one-page`) — embeds all assets as base64 into a single `index.html`

> ⚠️ **Ammo.js is explicitly not supported by `playcanvas-rest-api-tools`** (confirmed in the README). This means **no dynamic RigidBody components anywhere in the scene**. All movement uses kinematic `setPosition` / `setLocalEulerAngles` calls. Proximity detection uses manual distance checks (`Vec3.distance`) instead of collision events. This is not a workaround — it is the correct architecture for playable ads on this engine.

### Input

- **Movement:** virtual joystick (on-screen, right thumb area, dynamic — anchors to first touch point)
- **Interaction:** single tap on bubble; each interactable will show a bubble indicating the action, and will perform the interaction when tapped

---

## 9. Out of Scope

Deliberately excluded to respect the 1-minute duration and 5MB limit:

- Character customization or skins
- Economy / currency system
- Persistent save state
- Multiplayer or social features
- Narrative dialogue or cutscenes
