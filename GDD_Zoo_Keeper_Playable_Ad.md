# 🦁 GDD — ZooKeeper Playable Ad

## Synopsis

You will be the manager of a small zoo, and your animals will need you to take care of them. Move through the zoo, discover what each animal needs, and deliver the right item before time runs out, otherwise they can be angry!

The player will move through the zoo, pick up helpful items along the way, and deliver them to each animal when prompted. Three animals will appear along the path: a monkey, an elephant, and a lion. Taking care of each one will reward the player with stars, which will unlock the next enclosure. Each new animal will initially be shown as a silhouette until it is unlocked.

If an animal's needs are not fulfilled in time, a lighthearted fail screen will appear with a quick retry option. Successfully helping all three animals will trigger a celebration, followed by a giraffe teaser and a download call to action.

---

## 📚 1. References

The references vary from cozy games to real zoo management games. Other playable ads are valid references for camera, movement, mechanics, CTAs, tutorials, and mostly how to make the player quickly engage with the game.

---

## ❓ 2. Questions to the Briefing Writer

**Q1. How does the player discover what an animal needs?**

The briefing describes "checking each animal's need" without specifying how that need is communicated. A playable ad must deliver its goal within the first few seconds, so the discovery method directly impacts initial comprehension.

> **Answer:** A floating need icon will appear above each animal at the start of its enclosure phase, such as a banana above the monkey, a water droplet above the elephant, and meat above the lion. A bouncing arrow will also highlight the required item in the world. Both cues will be readable at a glance without requiring additional interaction.

---

**Q2. What is the core interaction mechanic?**

The briefing mentions "taking care of animals" but leaves the actual mechanic open. Tap, drag, gesture, or mini-games? The chosen solution must support one-handed mobile play and be understandable in under five seconds.

> **Answer:** The interaction will be based on movement and contextual actions. The player will walk near an item to pick it up automatically, then enter a delivery zone where a tap prompt will appear to complete the action.
>
> The core loop will be simple and repeatable: **move → collect → deliver → tap.**
>
> This structure will keep the experience intuitive, reduce friction, and allow different animal needs to be introduced without adding new control complexity.

---

**Q3. Are locked animals visible before unlocking?**

We know that each care action unlocks a new animal, but it's unclear how upcoming content is revealed to the player. For a playable ad, this point can be crucial for retention. We should explore the player's curiosity.

> **Answer:** All three enclosures will be visible from the start, while locked animals will be represented as dark silhouettes with a padlock indicator, keeping their identity hidden until unlocked with stars.
>
> This approach will provide a clear sense of progression across the zoo while maintaining curiosity about future unlocks, balancing visibility with discovery.

---

**Q4. Is there a fail state or time pressure?**

The briefing does not specify how failure or time pressure should be handled, leaving room to define the level of challenge and pacing.

> **Answer:** Each animal will have its own time limit, represented by a continuously draining need. The timer will start when the animal becomes active and will reset after each successful delivery. If the player does not meet the requirement before time runs out, a fail state will be triggered.
>
> The fail moment will be communicated through light feedback such as a brief camera shake, followed by a playful, character-driven message aligned with the theme of caring for animals. A "Try Again" option will allow the player to retry from the current animal without restarting the full experience.

---

**Q5. What is the visual and technical direction?**

The briefing does not define a specific art style or technical approach.

> **Answer:** For playable ads, the most important goal is to convert the playable session into installs or clicks. To achieve this, we need to keep players engaged and amazed by the short game experience.
>
> The game will use a cute, stylized, low-poly 3D environment with a bright, saturated color palette and a light cartoon tone, aligned with the casual and accessible nature of playable ads. This approach will deliver a visually engaging 3D experience.

---

## 🎮 3. Game Overview

| Field | Value |
|---|---|
| **Platform** | Playable Ad (Web, HTML5) |
| **Target Duration** | 45–60 seconds |
| **Narrative Background** | You are a zoo manager. Take care of the animals to unlock new species. |
| **Art Style** | Stylized low-poly 3D with a bright and colorful tone |
| **Player Experience** | Engaging and satisfying from the first few seconds, with clear one-handed controls and a sense of discovery |

---

## 🕹️ 4. Gameplay

The gameplay is built around a simple loop of navigating the environment, collecting items, and delivering them to fulfill the animal's needs. The player interacts with the world through proximity-based actions, progressing by completing each objective in sequence.

- Items are collected automatically when the player approaches them
- Each animal requires specific items to be delivered in order to progress
- Progression unfolds across a series of targets with increasing complexity
- A time-based system applies pressure through draining needs tied to current animals
- The player fails if the current animal need is not fulfilled before its timer runs out

### Animals & Interactions

| Order | Animal | Need | Item | Unlock Cost |
|---|---|---|---|---|
| 1st | 🐒 Monkey | Hungry | 🍌 Banana | Free |
| 2nd | 🐘 Elephant | Thirsty | 🛢 Water Barrel | 25 ⭐ |
| 3rd | 🦁 Lion | Hungry + Dangerous | 🥎 Toy → 🍗 Food | 75 ⭐ |

The lion introduces a two-step interaction: after the toy is delivered, the food becomes available for a second delivery. This adds variety to the gameplay and prevents repetitive interactions, giving the player hints that the real game can scale the difficulty.

---

## 🔄 5. Core Loop
```
Spawn (needs draining)
    ↓
Walk near item → Auto-grab
    ↓
Walk into zone → Tap bubble → Deliver → Earn stars ⭐
(needs reset for next animal)
    ↓
[enclosure locked?] → Spend stars ⭐ → Unlock → Repeat
    ↓
Endcard with CTA
```

**Fail path:** needs reach 0 → camera shake → playful, character-driven fail message → TRY AGAIN → retry current animal

---

## 🎯 6. CTA Screen

The CTA screen should highlight the player's sense of progress and achievement, transitioning into a clear and compelling call to action.

A celebratory version of the zoo will reinforce growth and success, supporting the feeling that the player has built something meaningful. The main message will focus on expansion and reward, paired with a prominent "Play Now" button designed to drive immediate interaction.

A teaser of a new animal will suggest continued progression beyond the playable experience, encouraging curiosity and motivating the player to keep playing.

The CTA will remain visually prominent and active, guiding the player toward the next step.

---

## ⚙️ 7. Technical Notes

### Platform & Constraints

- **Build Size:** Max 5 MB
- **Platform:** Mobile browsers (primary)
- **Input:** Tap / drag only
- **Delivery:** Single self-contained HTML file

**Out of scope:** Persistent progression, multiplayer, narrative systems, account or external integrations.

### Stack

- **Engine:** Phaser 3 + enable3d (Three.js)
- **Language:** TypeScript
- **Resolution:** Portrait (540 × 960)

Phaser handles input, UI, audio, and timing. enable3d renders the 3D scene in the same WebGL context. This setup avoids editor dependency, keeps version control straightforward, and gives direct control over performance.

Physics is not used — the interaction model doesn't require it, and excluding it reduces build size.

TypeScript is used throughout for type safety, better refactoring confidence, and IDE tooling support.

### Data-Driven Configuration

Gameplay parameters are defined in JSON:

- Animal positions
- Phase rules
- Unlock costs
- Visual parameters

This allows content adjustments without touching code, and supports A/B testing different values or creating multiple variants from the same codebase.

### Asset Budget

The project has a hard limit of **5 MB**.

| Category | Size | Notes |
|---|---|---|
| Framework (Phaser + Three.js + enable3d) | ~2,218 KB | Vendors bundle. Drops to ~650 KB if gzip is supported |
| 3D models (GLBs) | ~784 KB | Player, 3 animals, food items, env props. Animations baked in |
| UI sprites | ~444 KB | Portraits, icons, buttons, logo |
| Audio | ~180 KB | ~10 SFX + 1 BGM loop |
| 3D textures | ~40 KB | Light atlas textures per model |
| Game code + HTML | ~50 KB | TypeScript, minified |
| Config files | ~10 KB | Level layout, game tuning, audio config |
| Base64 overhead | ~478 KB | +33% for single-file HTML delivery |
| **Total** | **4,200 KB (4.1 MB)** | ~800 KB under the 5 MB limit |

**Budget priorities:** Critical → Gameplay, SFX, core visuals. Flexible → Music, texture resolution. If the build approaches ~4.5 MB, music is removed first.