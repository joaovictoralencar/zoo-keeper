import { Group, Vector3 } from 'three'

/**
 * Kinematic wander behaviour for animals that have no idle animation.
 * Ported from the PlayCanvas AnimalWander script.
 *
 * Usage:
 *   const wander = new AnimalWander(mesh, { wanderRadius: 3, moveSpeed: 1.5 })
 *   // in update loop:
 *   wander.update(delta / 1000)
 */
export interface AnimalWanderConfig {
  wanderRadius?: number  // world-units radius around spawn point
  moveSpeed?: number     // units per second while walking
  waitTime?: number      // seconds to wait at each waypoint
  jumpHeight?: number    // peak of idle bounce (world units)
  jumpSpeed?: number     // frequency of idle bounce
  // Rectangular hard bounds — animals cannot step outside these
  xMin?: number
  xMax?: number
  zMin?: number
  zMax?: number
}

export class AnimalWander {
  private readonly entity: Group
  private readonly origin: Vector3
  private baseY: number

  private target: Vector3 | null = null
  private waiting = false
  private waitTimer = 0
  private jumpTime = 0

  private readonly wanderRadius: number
  private readonly moveSpeed: number
  private readonly waitTime: number
  private readonly jumpHeight: number
  private readonly jumpSpeed: number
  private readonly xMin: number
  private readonly xMax: number
  private readonly zMin: number
  private readonly zMax: number

  constructor(entity: Group, config: AnimalWanderConfig = {}) {
    this.entity = entity
    this.origin = entity.position.clone()
    this.baseY = this.origin.y

    this.wanderRadius = config.wanderRadius ?? 3
    this.moveSpeed    = config.moveSpeed    ?? 1.5
    this.waitTime     = config.waitTime     ?? 2
    this.jumpHeight   = config.jumpHeight   ?? 0.25
    this.jumpSpeed    = config.jumpSpeed    ?? 4
    this.xMin = config.xMin ?? -Infinity
    this.xMax = config.xMax ??  Infinity
    this.zMin = config.zMin ?? -Infinity
    this.zMax = config.zMax ??  Infinity

    this.pickNewTarget()
  }

  private clampTarget(v: Vector3): Vector3 {
    v.x = Math.max(this.xMin, Math.min(this.xMax, v.x))
    v.z = Math.max(this.zMin, Math.min(this.zMax, v.z))
    return v
  }

  private pickNewTarget(towardOrigin?: Vector3) {
    let angle: number

    if (towardOrigin && towardOrigin.lengthSq() > 0.001) {
      // Boundary hit — bounce back toward origin with some randomness
      const baseAngle = Math.atan2(towardOrigin.x, towardOrigin.z)
      angle = baseAngle + (Math.random() - 0.5) * Math.PI
    } else {
      angle = Math.random() * Math.PI * 2
    }

    const dist = (0.3 + Math.random() * 0.7) * this.wanderRadius

    this.target = this.clampTarget(new Vector3(
      this.origin.x + Math.sin(angle) * dist,
      this.baseY,
      this.origin.z + Math.cos(angle) * dist
    ))
    this.waiting = false
  }

  get isMoving(): boolean { return !this.waiting && !!this.target }

  update(dt: number) {
    const pos = this.entity.position

    // ── IDLE: waiting at waypoint, playing bounce ────────────────────────────
    if (this.waiting) {
      this.waitTimer -= dt
      this.jumpTime  += dt * this.jumpSpeed

      const bounce = Math.abs(Math.sin(this.jumpTime)) * this.jumpHeight
      this.entity.position.set(pos.x, this.baseY + bounce, pos.z)

      if (this.waitTimer <= 0) this.pickNewTarget()
      return
    }

    // ── MOVING: walk toward target ───────────────────────────────────────────
    if (!this.target) { this.pickNewTarget(); return }

    // Radius boundary check (replaces physics wall detection)
    const distFromOrigin = new Vector3(
      pos.x - this.origin.x,
      0,
      pos.z - this.origin.z
    )
    if (distFromOrigin.length() > this.wanderRadius) {
      this.pickNewTarget(new Vector3(
        this.origin.x - pos.x,
        0,
        this.origin.z - pos.z
      ))
      return
    }

    const dir = new Vector3(
      this.target.x - pos.x,
      0,
      this.target.z - pos.z
    )
    const dist = dir.length()

    if (dist < 0.2) {
      // Reached waypoint — enter wait state
      this.waiting    = true
      this.waitTimer  = this.waitTime + Math.random() * 1.5
      this.jumpTime   = 0
      this.baseY      = pos.y
      return
    }

    dir.normalize()

    const nx = Math.max(this.xMin, Math.min(this.xMax, pos.x + dir.x * this.moveSpeed * dt))
    const nz = Math.max(this.zMin, Math.min(this.zMax, pos.z + dir.z * this.moveSpeed * dt))
    this.entity.position.set(nx, this.baseY, nz)

    // Rotate to face movement direction
    this.entity.rotation.y = Math.atan2(dir.x, dir.z)
  }
}
