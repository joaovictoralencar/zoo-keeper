import { Camera, Vector3 } from 'three'
import { GAME_W, GAME_H } from '../EngineConstants'

/**
 * Projects a Three.js world position to Phaser 2D screen coordinates.
 * Uses the camera's NDC projection then scales to pixel space.
 */
export function projectToScreen(
    worldPos: Vector3,
    camera: Camera,
    w = GAME_W,
    h = GAME_H,
): { x: number; y: number } {
    const v = worldPos.clone().project(camera)
    return { x: (v.x + 1) / 2 * w, y: (1 - v.y) / 2 * h }
}

/**
 * Clamps a projected screen point to the visible screen edge,
 * returning the clamped position and the angle toward the original point.
 * Useful for off-screen HUD indicators.
 */
export function clampToScreenEdge(
    tx: number,
    ty: number,
    margin: number,
    w = GAME_W,
    h = GAME_H,
    topMargin = margin,
): { x: number; y: number; angle: number } {
    const cx = w / 2, cy = h / 2
    const dx = tx - cx, dy = ty - cy
    const angle = Math.atan2(dy, dx)
    const scaleX = Math.abs(dx) > 0.01 ? (w / 2 - margin) / Math.abs(dx) : Infinity
    const scaleY = Math.abs(dy) > 0.01 ? (h / 2 - margin) / Math.abs(dy) : Infinity
    const scale  = Math.min(scaleX, scaleY, 1)
    const ex = Math.max(margin,    Math.min(w - margin, cx + dx * scale))
    const ey = Math.max(topMargin, Math.min(h - margin, cy + dy * scale))
    return { x: ex, y: ey, angle }
}
