// ── Canvas ────────────────────────────────────────────────────────────────────
export const GAME_W = 540
export const GAME_H = 960
export const FONT   = '"Baloo 2", sans-serif'

// ── Bubbles ───────────────────────────────────────────────────────────────────
export const ACTION_BUBBLE_W   = 74
export const ACTION_BUBBLE_H   = 74
export const PURCHASE_BUBBLE_W = 74
export const PURCHASE_BUBBLE_H = 88
export const BUBBLE_RADIUS     = 16

// ── Camera ────────────────────────────────────────────────────────────────────
export const CAMERA_LERP     = 0.1
export const CAMERA_OFFSET_X = 2    // camera looks this many units ahead of player on X
export const CAMERA_OFFSET_Z = 10   // camera sits this many units behind player on Z

// ── Player / items ────────────────────────────────────────────────────────────
export const AUTO_PICKUP_RADIUS = 1.8
export const CARRY_ITEM_HEIGHT  = 0.35

// ── Animal AI / animations ────────────────────────────────────────────────────
export const ANIM_BLEND_RATE = 6   // convergence multiplier (× dt) for walk↔idle blend

// ── HUD ───────────────────────────────────────────────────────────────────────
export const HUD_RING_RADIUS = 32
export const HUD_EDGE_MARGIN = 58
export const HUD_TOP_MARGIN  = 70  // pixels below prestige bar reserved for off-screen clamp

// ── Needs / timer ─────────────────────────────────────────────────────────────
export const NEEDS_IDLE_RATE = 0.025  // drain per second for unlocked non-active animals
