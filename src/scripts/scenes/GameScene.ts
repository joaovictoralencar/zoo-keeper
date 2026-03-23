import {Scene3D, JoyStick} from '@enable3d/phaser-extension'
import {
    AnimationAction, Box3, Color, CylinderGeometry, Group, MathUtils,
    Mesh, MeshBasicMaterial, MeshLambertMaterial,
    PerspectiveCamera, PlaneGeometry, SphereGeometry, Vector3,
} from 'three'
import {AnimalWander} from '../zoo/AnimalWander'
import type {LevelData, AnimalConfig, EnclosureConfig} from '../types/LevelData'

const GAME_W = 540
const GAME_H = 960
const FONT = '"Baloo 2", sans-serif'

function parseHex(s: string): number {
    return parseInt(s.replace('#', '0x'), 16)
}

interface Interactable {
    id: string
    getWorldPos: () => Vector3
    action: () => void
    isAvailable: () => boolean
    bubbleLabel: string
    bubbleIcon?: string
    bubbleSprite?: Phaser.GameObjects.Container
}

interface CarriedItem {
    type: string
    mesh: Group | Mesh
}

export default class GameScene extends Scene3D {
    // ── level data ────────────────────────────────────────────────────────
    private ld!: LevelData

    // ── movement ─────────────────────────────────────────────────────────
    private moveData = {top: 0, right: 0}
    private joystickEl: HTMLElement | null = null
    private player: any = null
    private mixer: any = null
    private idleAction: AnimationAction | null = null
    private walkAction: AnimationAction | null = null
    private isMoving = false
    private elapsedTime = 0

    // ── game state ────────────────────────────────────────────────────────
    private phase = 'monkey'
    private carriedItems: CarriedItem[] = []
    private interactables: Interactable[] = []
    private animalWanders: Map<string, AnimalWander> = new Map()

    // ── 3-D objects ───────────────────────────────────────────────────────
    private animalGroups = new Map<string, Group[]>()   // [0] = primary used for icons/effects
    private animalOriginalMats = new Map<Mesh, any>()
    private animalMixers = new Map<string, { staticAction: AnimationAction; walkAction: AnimationAction }>()
    private itemMeshes = new Map<string, Group | Mesh>()
    private itemPositions = new Map<string, Vector3>()
    private itemBaseY = new Map<string, number>()

    // ── Per-animal cage HUD ────────────────────────────────────────────────
    private animalHudItems = new Map<string, {
        container: Phaser.GameObjects.Container
        ring: Phaser.GameObjects.Graphics
        portrait: Phaser.GameObjects.Image
        padlockImg: Phaser.GameObjects.Image | null
        costLabel: Phaser.GameObjects.Container | null
        arrowCtr: Phaser.GameObjects.Container
    }>()
    private animalWasOffscreen = new Map<string, boolean>()

    // ── Needs (per-animal, proximity-based) ────────────────────────────────
    private animalNeeds = new Map<string, number>()   // 0–1 per animal
    private needsDrainActive = false
    private fedAnimals = new Set<string>()            // animals fed at least once → ring hidden

    // ── Pickup arrows (replaces tap bubbles for items) ─────────────────────
    private pickupArrows = new Map<string, Phaser.GameObjects.Image>()

    // ── Prestige bar ───────────────────────────────────────────────────────
    private prestigeBarGfx: Phaser.GameObjects.Graphics | null = null
    private prestigeFillRatio = 0.0
    private prestigeMilestones: { portrait: Phaser.GameObjects.Image; badge: Phaser.GameObjects.Image; ratio: number }[] = []
    private prestigeLevel = 0
    private completedAnimals = new Set<string>()

    // ── tutorial ──────────────────────────────────────────────────────────
    private tutorialContainer: Phaser.GameObjects.Container | null = null

    // ── star currency ──────────────────────────────────────────────────────
    private starCount = 0
    private starsCollected = 0
    private purchasedEnclosures = new Set<string>()
    private starHud: Phaser.GameObjects.Container | null = null
    private starHudText: Phaser.GameObjects.Text | null = null
    private bubbleWiggles = new Map<string, Phaser.Tweens.Tween>()
    private prevBubbleVisible = new Map<string, boolean>()

    constructor() {
        super({key: 'GameScene'})
    }

    init() {
        this.accessThirdDimension({usePhysics: false, antialias: true})
    }

    preload() {
        this.load.json('level', 'assets/level.json')
        // UI icons (individual 64×64 PNGs)
        this.load.image('ui-star',    'assets/ui/star.png')
        this.load.image('ui-padlock', 'assets/ui/padlock.png')
        this.load.image('ui-trophy',  'assets/ui/throphy.png')
        this.load.image('ui-pointer', 'assets/ui/pointer.png')
        this.load.image('ui-heart',   'assets/ui/heart.png')
        this.load.image('ui-gift',    'assets/ui/gift.png')
        this.load.image('ui-button',  'assets/ui/button.png')
        this.load.image('ui-arrow',   'assets/ui/arrow.png')
        // Animal UI portraits
        this.load.image('ui-monkey',   'assets/ui/animal-monkey.png')
        this.load.image('ui-elephant', 'assets/ui/animal-elephant.png')
        this.load.image('ui-lion',     'assets/ui/animal-lion.png')
        // CTA end-screen assets
        this.load.image('ui-game-logo',    'assets/ui/game-logo.png')
        this.load.image('ui-final-panel',  'assets/ui/final-panel.png')
        this.load.image('ui-cta-button',   'assets/ui/CTA-button.png')
        this.load.image('ui-giraffe',      'assets/ui/giraffe-unlocked.png')
        this.load.image('ui-cta-bg',       'assets/ui/cta-background.png')
        this.load.image('ui-broken-star',  'assets/ui/broken-star.png')
        this.load.image('ui-button-red',   'assets/ui/button-red.png')
    }

    // ── LIFECYCLE ────────────────────────────────────────────────────────

    async create() {
        this.ld = this.cache.json.get('level') as LevelData

        // Kick off font load (non-blocking — falls back to system font immediately)
        document.fonts.load(`700 16px "Baloo 2"`).catch(() => {})

        // Init purchased enclosures — free ones start open
        for (const enc of this.ld.enclosures) {
            if ((enc.unlockCost ?? 0) === 0) this.purchasedEnclosures.add(enc.id)
        }

        // Phase-2 load: icon images declared in items[]
        for (const item of this.ld.items) {
            if (item.iconAsset && item.bubbleIcon && !this.textures.exists(item.bubbleIcon)) {
                this.load.image(item.bubbleIcon, item.iconAsset)
            }
        }
        // Delivery icons declared in phases[]
        for (const phase of this.ld.phases) {
            if (phase.deliveryIconAsset && phase.deliveryIcon && !this.textures.exists(phase.deliveryIcon)) {
                this.load.image(phase.deliveryIcon, phase.deliveryIconAsset)
            }
        }
        if (this.load.list.size > 0) {
            await new Promise<void>(res => {
                this.load.once('complete', () => res());
                this.load.start()
            })
        }

        await this.third.warpSpeed('-ground', '-grid', '-orbitControls', '-fog', '-sky')
        this.third.scene.background = new Color(parseHex(this.ld.environment.skyColor))

        this.buildEnvironment()
        await this.loadFences()
        await this.loadPlayer()
        await this.loadAnimals()
        await this.loadItems()
        await this.loadProps()

        // Init per-animal needs to full for all animals
        for (const animal of this.ld.animals) {
            this.animalNeeds.set(animal.id, 1.0)
        }

        // Hide items that belong to still-locked enclosures
        for (const phase of this.ld.phases) {
            if (!this.purchasedEnclosures.has(phase.enclosureId)) {
                const mesh = this.itemMeshes.get(phase.requiredItem)
                if (mesh?.visible) mesh.visible = false
            }
        }

        this.setupInteractables()
        this.setupCamera()
        this.setupJoystick()
        this.setupUI()
        this.needsDrainActive = true
        this._showTutorial()
    }

    update(_time: number, delta: number) {
        if (!this.player) return
        const dt = delta / 1000
        this.elapsedTime += dt

        this.handleMovement(dt)
        this.updateCarryStack()
        this.updateItemBobbing(dt)
        this.updateCamera()
        this.updateAutoPickup()
        this.updatePickupArrows()
        this.updateBubbles()
        this.updateAnimalHud()
        this.updateNeeds(dt)

        for (const [id, w] of this.animalWanders) {
            w.update(dt)
            const anim = this.animalMixers.get(id)
            if (anim) {
                const target = w.isMoving ? 1 : 0
                const cur = anim.walkAction.getEffectiveWeight()
                const next = cur + (target - cur) * Math.min(1, dt * 6)
                anim.walkAction.setEffectiveWeight(next)
                anim.staticAction.setEffectiveWeight(1 - next)
            }
        }
    }

    // ── ENVIRONMENT ──────────────────────────────────────────────────────

    private buildEnvironment() {
        const env = this.ld.environment

        const ground = new Mesh(
            new PlaneGeometry(env.groundWidth, env.groundDepth),
            new MeshLambertMaterial({color: parseHex(env.groundColor)})
        )
        ground.rotation.x = -Math.PI / 2
        ground.receiveShadow = true
        this.third.scene.add(ground)

        const path = new Mesh(
            new PlaneGeometry(env.pathWidth, env.pathDepth),
            new MeshLambertMaterial({color: parseHex(env.pathColor)})
        )
        path.rotation.x = -Math.PI / 2
        path.position.set(0, 0.01, 0)
        this.third.scene.add(path)

        const sandMat = new MeshLambertMaterial({color: parseHex(env.enclosureFloorColor)})
        for (const enc of this.ld.enclosures) {
            const floor = new Mesh(
                new PlaneGeometry(env.enclosureFloorSize, env.enclosureFloorSize),
                sandMat.clone()
            )
            floor.rotation.x = -Math.PI / 2
            floor.position.set(enc.centerX, 0.01, -7)
            this.third.scene.add(floor)
        }
    }

    private async loadFences() {
        const f = this.ld.fence
        try {
            const gltf     = await this.third.load.gltf(f.model)
            const template = gltf.scene

            // Measure GLB pivot offset in Z — the mesh is NOT centered at Z=0.
            // For this iron-fence GLB: geometry sits at Z ∈ [-0.4, -0.25], pivot = -0.325.
            // For front/back rows: rot=0, local Z → world Z, correct with -pivZ.
            // For side cols rot +90°: local Z → world +X, correct placed X with -pivZ.
            // For side cols rot -90°: local Z → world -X, correct placed X with +pivZ.
            const bounds = new Box3().setFromObject(template)
            const pivZ   = (bounds.min.z + bounds.max.z) / 2

            const countW   = Math.round((f.halfWidth * 2) / f.segmentWidth)
            const countD   = Math.round(Math.abs(f.zBack - f.zFront) / f.segmentWidth)
            const midPanel = Math.floor(countW / 2)

            for (const enc of this.ld.enclosures) {
                const ex = enc.centerX
                const zF = f.zFront - pivZ
                const zB = f.zBack  - pivZ
                const xW = ex - f.halfWidth - pivZ
                const xE = ex + f.halfWidth + pivZ

                // South row — skip gate panels
                for (let i = 0; i < countW; i++) {
                    const isGate = i >= midPanel - f.gatePanels / 2 && i < midPanel + f.gatePanels / 2
                    if (isGate) continue
                    const s = template.clone(true)
                    s.position.set(ex - f.halfWidth + f.segmentWidth * 0.5 + i * f.segmentWidth, 0, zF)
                    this.third.scene.add(s)
                }
                // North row (full)
                for (let i = 0; i < countW; i++) {
                    const s = template.clone(true)
                    s.position.set(ex - f.halfWidth + f.segmentWidth * 0.5 + i * f.segmentWidth, 0, zB)
                    this.third.scene.add(s)
                }
                // Side columns — countD panels, starting half a segment inside the front row,
                // so panels fill exactly [zFront, zBack] with no protrusion past the fence rows.
                for (let i = 0; i < countD; i++) {
                    const z = f.zFront - f.segmentWidth / 2 - i * f.segmentWidth
                    const l = template.clone(true)
                    l.position.set(xW, 0, z)
                    l.rotation.y = Math.PI / 2
                    this.third.scene.add(l)

                    const r = template.clone(true)
                    r.position.set(xE, 0, z)
                    r.rotation.y = -Math.PI / 2
                    this.third.scene.add(r)
                }
            }
        } catch {
            console.warn('fence model not available:', f.model)
        }
    }

    // ── CHARACTER ────────────────────────────────────────────────────────

    private async loadPlayer() {
        const cfg = this.ld.player
        const gltf = await this.third.load.gltf(cfg.model)
        this.player = gltf.scene
        this.player.scale.setScalar(cfg.scale)
        this.player.position.set(cfg.startX, 0, cfg.startZ)
        this.player.traverse((c: any) => {
            if (c.isMesh) {
                c.castShadow = true;
                c.receiveShadow = true
            }
        })
        this.third.scene.add(this.player)

        this.mixer = this.third.animationMixers.create(this.player)
        const idleClip = gltf.animations.find((a: any) => a.name === 'idle')
        const walkClip = gltf.animations.find((a: any) => a.name === 'walk')
        if (idleClip) {
            this.idleAction = this.mixer.clipAction(idleClip);
            this.idleAction!.play()
        }
        if (walkClip) {
            this.walkAction = this.mixer.clipAction(walkClip)
        }
    }

    // ── ANIMALS ──────────────────────────────────────────────────────────

    private async loadAnimals() {
        const configs = this.ld.animals

        // Build a flat load queue so all instances load in parallel
        type QueueEntry = { cfg: AnimalConfig; enc: EnclosureConfig; idx: number }
        const queue: QueueEntry[] = []
        for (const cfg of configs) {
            const enc = this.ld.enclosures.find(e => e.id === cfg.enclosureId)!
            const n = cfg.count ?? 1
            for (let k = 0; k < n; k++) queue.push({ cfg, enc, idx: k })
        }

        const gltfs = await Promise.all(queue.map(q => this.third.load.gltf(q.cfg.model)))

        gltfs.forEach((gltf, qi) => {
            const { cfg, enc, idx } = queue[qi]
            const n = cfg.count ?? 1
            const group = gltf.scene

            // Spread X across enclosure width, alternate Z for visual variety
            const xMin = enc.zoneXMin + 2, xMax = enc.zoneXMax - 2
            const x = n <= 1 ? enc.centerX : xMin + (idx / Math.max(n - 1, 1)) * (xMax - xMin)
            const z = cfg.spawnZ + (idx % 2 === 0 ? 0 : -2.5)
            group.position.set(x, 0, z)

            // Locked animals start invisible — 2D silhouette shown instead
            if (cfg.startLocked) group.visible = false

            this.third.scene.add(group)
            this.normalizeAnimalHeight(group, cfg.targetHeight)
            if (cfg.spawnY !== undefined) group.position.y = cfg.spawnY
            if (cfg.scale !== undefined) group.scale.multiplyScalar(cfg.scale)

            // Wander + animation keyed by `id_idx` so all instances update independently
            const wanderKey = `${cfg.id}_${idx}`
            this.animalWanders.set(wanderKey, new AnimalWander(group, {
                wanderRadius: cfg.wanderRadius,
                moveSpeed: cfg.moveSpeed,
                xMin: enc.zoneXMin + 0.5,
                xMax: enc.zoneXMax - 0.5,
                zMin: -10.5,
                zMax: -3.5,
            }))

            const mixer = this.third.animationMixers.create(group)
            const staticClip = gltf.animations.find((a: any) => a.name === 'static')
            const walkClip = gltf.animations.find((a: any) => a.name === 'walk')
            if (staticClip && walkClip) {
                const staticAction = mixer.clipAction(staticClip)
                const walkAction = mixer.clipAction(walkClip)
                staticAction.play()
                walkAction.setEffectiveWeight(0).play()
                this.animalMixers.set(wanderKey, { staticAction, walkAction })
            }

            // Primary (idx 0) stored in animalGroups for icons/effects/delivery position
            if (idx === 0) this.animalGroups.set(cfg.id, [group])
            else this.animalGroups.get(cfg.id)!.push(group)
        })


    }

    private normalizeAnimalHeight(group: Group | Mesh, targetHeight: number) {
        group.scale.setScalar(1)
        group.updateMatrixWorld(true)
        const box = new Box3().setFromObject(group)
        const naturalHeight = box.max.y - box.min.y
        if (naturalHeight > 0) {
            const s = targetHeight / naturalHeight
            group.scale.setScalar(s)
            group.updateMatrixWorld(true)
            const box2 = new Box3().setFromObject(group)
            group.position.y = -box2.min.y
        }
    }

    private lockAnimal(group: Group) {
        const dark = new MeshBasicMaterial({color: 0x1a1a2e})
        group.traverse((c: any) => {
            if (c.isMesh) {
                this.animalOriginalMats.set(c, c.material);
                c.material = dark
            }
        })
    }

    private unlockAnimal(group: Group) {
        group.traverse((c: any) => {
            if (c.isMesh && this.animalOriginalMats.has(c)) {
                c.material = this.animalOriginalMats.get(c)
                this.animalOriginalMats.delete(c)
            }
        })
    }

    // ── ITEMS ────────────────────────────────────────────────────────────

    private async loadItems() {
        for (const cfg of this.ld.items) {
            const pos = new Vector3(cfg.position.x, cfg.position.y, cfg.position.z)
            this.itemPositions.set(cfg.type, pos)

            let mesh: Group | Mesh
            if (cfg.model) {
                try {
                    const g = await this.third.load.gltf(cfg.model)
                    g.scene.scale.setScalar(cfg.scale)
                    mesh = g.scene
                } catch {
                    mesh = this._fallbackMesh(cfg.type)
                }
            } else {
                mesh = this._fallbackMesh(cfg.type)
            }

            mesh.position.copy(pos)
            this.itemBaseY.set(cfg.type, pos.y)
            if (cfg.startVisible === false) mesh.visible = false
            this.third.scene.add(mesh)
            this.itemMeshes.set(cfg.type, mesh)
        }
    }

    private _fallbackMesh(type: string): Mesh {
        const colors: Record<string, number> = {
            banana: 0xffe135, water: 0x4fc3f7, toy: 0xff8a65, food: 0x8d6e63,
        }
        return new Mesh(
            new SphereGeometry(0.25, 8, 8),
            new MeshLambertMaterial({color: colors[type] ?? 0xcccccc})
        )
    }

    // ── PROPS ────────────────────────────────────────────────────────────

    private async loadProps() {
        const cache = new Map<string, Group | null>()
        for (const prop of this.ld.props) {
            if (!cache.has(prop.model)) {
                try {
                    const gltf = await this.third.load.gltf(prop.model)
                    cache.set(prop.model, gltf.scene)
                } catch {
                    console.warn('prop model not found:', prop.model)
                    cache.set(prop.model, null)
                }
            }
            const template = cache.get(prop.model)
            if (!template) continue

            const clone = template.clone(true)
            clone.position.set(prop.x, prop.y, prop.z)
            if (prop.rotY !== undefined) clone.rotation.y = prop.rotY
            if (prop.scale !== undefined) clone.scale.setScalar(prop.scale)
            this.third.scene.add(clone)
        }
    }

    // ── INTERACTION ──────────────────────────────────────────────────────

    private setupInteractables() {
        for (const phase of this.ld.phases) {
            const enc = this.ld.enclosures.find(e => e.id === phase.enclosureId)!

            // Delivery bubble — visible whenever player is anywhere inside the cage zone
            this.interactables.push({
                id: `${phase.id}_deliver`,
                getWorldPos: () => new Vector3(enc.centerX, 0, -3.5),
                action: () => this.deliver(phase.requiredItem, phase.id),
                isAvailable: () =>
                    this.phase === phase.id &&
                    this.purchasedEnclosures.has(phase.enclosureId) &&
                    this.carrying(phase.requiredItem),
                bubbleLabel: phase.deliveryLabel,
                bubbleIcon:  phase.deliveryIcon ?? undefined,
            })
        }

        // Cage purchase interactables for locked enclosures
        for (const enc of this.ld.enclosures) {
            const cost = enc.unlockCost ?? 0
            if (cost === 0) continue
            const gatePos = new Vector3(enc.centerX, 0, this.ld.fence.zFront)
            this.interactables.push({
                id: `${enc.id}_purchase`,
                getWorldPos: () => gatePos,
                action: () => this.purchaseEnclosure(enc.id),
                isAvailable: () => !this.purchasedEnclosures.has(enc.id)
                    && (!enc.unlockRequires || this.purchasedEnclosures.has(enc.unlockRequires)),
                bubbleLabel: `⭐${cost}`,
            })
        }

        // Build bubble sprites
        for (const item of this.interactables) {
            let c: Phaser.GameObjects.Container
            if (item.id.endsWith('_purchase')) {
                const cost = parseInt(item.bubbleLabel.replace('⭐', ''), 10)
                c = this._createPurchaseBubble(cost)
            } else {
                c = this._createActionBubble(item.bubbleLabel, item.bubbleIcon)
            }
            c.on('pointerdown', () => { if (c.visible) item.action() })
            item.bubbleSprite = c
        }
    }

    private carrying(t: string) {
        return this.carriedItems.some(i => i.type === t)
    }

    private pickup(type: string) {
        if (this.carriedItems.length >= 2) return
        const original = this.itemMeshes.get(type)
        let carryObj: Group | Mesh
        if (original instanceof Group) {
            carryObj = original.clone(true)
        } else if (original) {
            carryObj = (original as Mesh).clone()
        } else {
            carryObj = this._fallbackMesh(type)
        }
        this.third.scene.add(carryObj)
        this.normalizeAnimalHeight(carryObj, 0.35)
        carryObj.position.y = 0
        this.carriedItems.push({type, mesh: carryObj})
        if (original) original.visible = false
    }

    private deliver(type: string, phaseId: string) {
        const idx = this.carriedItems.findIndex(i => i.type === type)
        if (idx === -1) return
        const [item] = this.carriedItems.splice(idx, 1)
        this.third.scene.remove(item.mesh)
        this.onDelivery()
    }

    private onDelivery() {
        const phase = this.ld.phases.find(p => p.id === this.phase)
        if (!phase) return
        const {onComplete} = phase

        const enc = this.ld.enclosures.find(e => e.id === phase.enclosureId)
        const groups = this.animalGroups.get(phase.animalId) ?? []
        const group = groups[0]  // reference point for projection

        // Success bounce on every animal in the enclosure
        for (const g of groups) this.successEffect(g)

        // Hearts burst above the animal (deep in the cage — projects high on screen)
        if (group) {
            const sp = this.project(new Vector3(group.position.x, group.position.y + 2, group.position.z))
            this.spawnHearts(sp.x, sp.y)
        }

        // Stars fly from the delivery gate (near the fence — projects low on screen, away from hearts)
        if (onComplete.starsAwarded) {
            const gatePos = enc
                ? this.project(new Vector3(enc.centerX, 1.5, -3.5))
                : group
                    ? this.project(new Vector3(group.position.x, group.position.y + 2, group.position.z))
                    : {x: GAME_W / 2, y: GAME_H / 2}
            this.flyStars(onComplete.starsAwarded, gatePos.x, gatePos.y)
        }

        // Restore this animal's needs to full on delivery
        this.animalNeeds.set(phase.animalId, 1.0)
        // Once fed, ring is permanently removed for this animal
        this.fedAnimals.add(phase.animalId)

        // Advance prestige when an animal fully completes (not intermediate showItemType steps)
        if (!onComplete.showItemType && onComplete.starsAwarded) {
            this.completedAnimals.add(phase.animalId)
            this.prestigeLevel++
            this._advancePrestige()
        }

        if (onComplete.showItemType) {
            const shownMesh = this.itemMeshes.get(onComplete.showItemType)
            if (shownMesh) shownMesh.visible = true
            this.phase = onComplete.nextPhase
            this._activateTimerForCurrentPhase()

        } else if (onComplete.endGame) {
            this.phase = onComplete.nextPhase
            this.needsDrainActive = false
            this.time.delayedCall(1800, () => this.showEndcard(), [], this)

        } else {
            this.phase = onComplete.nextPhase
            this._activateTimerForCurrentPhase()
        }
    }

    /** Reset needs for the incoming phase's animal, unless it's still locked. */
    private _activateTimerForCurrentPhase() {
        const phaseCfg = this.ld.phases.find(p => p.id === this.phase)
        if (!phaseCfg) { this.needsDrainActive = false; return }
        const animalCfg = this.ld.animals.find(a => a.id === phaseCfg.animalId)
        const encCfg = this.ld.enclosures.find(e => e.id === phaseCfg.enclosureId)
        const isStillLocked = animalCfg?.startLocked && encCfg && !this.purchasedEnclosures.has(encCfg.id)
        if (!isStillLocked) {
            this.animalNeeds.set(phaseCfg.animalId, 1.0)
            this.needsDrainActive = true
        }
    }

    private successEffect(group: Group) {
        const base = group.scale.x
        this.tweens.add({
            targets: group.scale, x: base * 1.4, y: base * 1.4, z: base * 1.4,
            duration: 140, yoyo: true, repeat: 3, ease: 'Sine.easeInOut',
        })
    }

    private spawnHearts(fromX: number, fromY: number) {
        for (let i = 0; i < 5; i++) {
            this.time.delayedCall(i * 90, () => {
                const heart = this.add.image(
                    fromX + Phaser.Math.Between(-28, 28),
                    fromY + Phaser.Math.Between(-8, 8),
                    'ui-heart'
                ).setDisplaySize(22, 22).setOrigin(0.5).setDepth(52).setScale(0)
                this.tweens.add({
                    targets: heart, scaleX: 1, scaleY: 1,
                    duration: 150, ease: 'Back.easeOut',
                    onComplete: () => this.tweens.add({
                        targets: heart,
                        y: fromY - 70 - Phaser.Math.Between(0, 30),
                        alpha: 0, scaleX: 0.6, scaleY: 0.6,
                        duration: 900, ease: 'Quad.easeOut',
                        onComplete: () => heart.destroy(),
                    }),
                })
            }, [], this)
        }
    }

    // ── BUBBLE CREATION ──────────────────────────────────────────────────

    private _createActionBubble(label: string, iconKey?: string): Phaser.GameObjects.Container {
        const W = 74, H = 74, R = 16
        const shadow = this.add.graphics()
        shadow.fillStyle(0x000000, 0.28)
        shadow.fillRoundedRect(-W / 2 + 3, -H / 2 + 5, W, H, R)
        const bg = this.add.graphics()
        bg.fillStyle(0xffffff, 1)
        bg.fillRoundedRect(-W / 2, -H / 2, W, H, R)
        const icon: any = iconKey && this.textures.exists(iconKey)
            ? this.add.image(0, 0, iconKey).setDisplaySize(46, 46)
            : this.add.text(0, 2, label, {fontSize: '32px'}).setOrigin(0.5)
        // Pointer indicator above bubble — larger for legibility
        const tapPointer = this.add.image(0, -H / 2, 'ui-pointer')
            .setDisplaySize(48, 48).setOrigin(0.5).setAngle(180)
        this.tweens.add({
            targets: tapPointer, scaleX: 1.18, scaleY: 1.18,
            duration: 500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
        })
        const tapLabel = this.add.text(0, -H / 2 - 54, 'GIVE', {
            fontSize: '24px', color: '#ffffff', fontStyle: 'bold', fontFamily: FONT,
            stroke: '#000000', strokeThickness: 4,
        }).setOrigin(0.5)
        return this.add.container(0, 0, [shadow, bg, icon, tapPointer, tapLabel])
            .setVisible(false).setDepth(17).setScale(0).setSize(W, H).setInteractive()
    }

    private _createPurchaseBubble(cost: number): Phaser.GameObjects.Container {
        const W = 74, H = 88, R = 16
        const shadow = this.add.graphics()
        shadow.fillStyle(0x000000, 0.28)
        shadow.fillRoundedRect(-W / 2 + 3, -H / 2 + 5, W, H, R)
        const bg = this.add.graphics()
        bg.fillStyle(0xffe57a, 1)
        bg.fillRoundedRect(-W / 2, -H / 2, W, H, R)
        const starIcon = this.add.image(0, -14, 'ui-star').setDisplaySize(36, 36).setOrigin(0.5)
        const numText = this.add.text(0, 20, String(cost), {
            fontSize: '22px', color: '#7a4500', fontFamily: FONT, fontStyle: 'bold',
        }).setOrigin(0.5)
        // Pointer indicator above bubble
        const tapPointer = this.add.image(0, -H / 2 - 20, 'ui-pointer')
            .setDisplaySize(42, 42).setOrigin(0.5).setAngle(180)
        this.tweens.add({
            targets: tapPointer, scaleX: 1.18, scaleY: 1.18,
            duration: 500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
        })
        const tapLabel = this.add.text(0, -H / 2 - 40, 'UNLOCK', {
            fontSize: '13px', color: '#ffffff', fontStyle: 'bold', fontFamily: FONT,
            stroke: '#000000', strokeThickness: 3,
        }).setOrigin(0.5)
        return this.add.container(0, 0, [shadow, bg, starIcon, numText, tapPointer, tapLabel])
            .setVisible(false).setDepth(17).setScale(0).setSize(W, H).setInteractive()
    }

    // ── STAR CURRENCY ─────────────────────────────────────────────────────

    private setupStarHud() {
        const x = GAME_W - 76, y = 28
        const btnBg = this.add.image(0, 0, 'ui-button').setDisplaySize(138, 54).setOrigin(0.5)
        const starLabel = this.add.image(32, 1, 'ui-star').setDisplaySize(34, 34).setOrigin(0.5)
        this.starHudText = this.add.text(-18, 1, '0', {
            fontSize: '28px', color: '#ffffff', fontFamily: FONT, fontStyle: 'bold',
            stroke: '#1a5c0a', strokeThickness: 4,
        }).setOrigin(0.5)
        this.starHud = this.add.container(x, y, [btnBg, starLabel, this.starHudText]).setDepth(28)
    }

    private flyStars(count: number, fromX: number, fromY: number) {
        const toX = GAME_W - 68, toY = 26
        this.starsCollected += count

        // "+N" popup springs up from delivery point
        const plusText = this.add.text(fromX, fromY - 20, `+${count}`, {
            fontSize: '40px', color: '#ffd700', fontFamily: FONT, fontStyle: 'bold',
            stroke: '#7a4500', strokeThickness: 4,
        }).setOrigin(0.5).setDepth(51).setScale(0)
        this.tweens.add({
            targets: plusText, scaleX: 1.3, scaleY: 1.3,
            duration: 220, ease: 'Back.easeOut',
            onComplete: () => this.tweens.add({
                targets: plusText, y: fromY - 90, alpha: 0,
                duration: 900, delay: 200, ease: 'Quad.easeOut',
                onComplete: () => plusText.destroy(),
            }),
        })

        // 5 stars fly to the HUD; counter ticks up proportionally
        const visual = 5
        const oldCount = this.starCount
        for (let i = 0; i < visual; i++) {
            this.time.delayedCall(300 + i * 100, () => {
                const star = this.add.image(
                    fromX + Phaser.Math.Between(-25, 25),
                    fromY + Phaser.Math.Between(-15, 15),
                    'ui-star'
                ).setDisplaySize(10, 10).setOrigin(0.5).setDepth(50).setScale(0.5)
                this.tweens.add({
                    targets: star, x: toX, y: toY, scaleX: 1, scaleY: 1,
                    duration: 480, ease: 'Quad.easeIn',
                    onComplete: () => {
                        star.destroy()
                        this.starCount = oldCount + Math.round(count * (i + 1) / visual)
                        if (this.starHudText) this.starHudText.setText(String(this.starCount))
                        if (i === visual - 1) {
                            this.starCount = oldCount + count  // exact value
                            this.updateStarHud()
                        }
                    },
                })
            }, [], this)
        }
    }

    private updateStarHud() {
        if (!this.starHudText || !this.starHud) return
        this.starHudText.setText(String(this.starCount))
        this.tweens.killTweensOf(this.starHud)
        this.tweens.add({
            targets: this.starHud, scaleX: 1.65, scaleY: 1.65,
            duration: 150, yoyo: true, ease: 'Back.easeOut',
        })
    }

    // ── PRESTIGE BAR ─────────────────────────────────────────────────────

    private createPrestigeBar() {
        const bX = 10, bY = 8, bW = 358, bH = 30
        const barCenterY = bY + bH / 2

        this.prestigeBarGfx = this.add.graphics().setDepth(22)
        this._drawPrestigeBarFill()

        // Milestones: animal silhouettes sit ON the bar; star reward below
        const milestoneData = [
            {id: 'monkey',   ratio: 1 / 3, stars: 50,  icon: 'ui-monkey'},
            {id: 'elephant', ratio: 2 / 3, stars: 100, icon: 'ui-elephant'},
            {id: 'gift',     ratio: 1.0,   stars: 150, icon: 'ui-gift'},
        ]
        this.prestigeMilestones = []
        for (const m of milestoneData) {
            const mx = bX + bW * m.ratio
            // Portrait centered on bar — sticks slightly above & below
            const portrait = this.add.image(mx, barCenterY - 1, m.icon)
                .setDisplaySize(40, 40).setOrigin(0.5).setDepth(24).setTint(0x111111)
            // Gold star icon below bar
            const starIcon = this.add.image(mx, bY + bH + 14, 'ui-star')
                .setDisplaySize(22, 22).setOrigin(0.5).setDepth(24)
            // Star count text below star icon
            this.add.text(mx, bY + bH + 30, String(m.stars), {
                fontSize: '13px', color: '#ffffff', fontFamily: FONT, fontStyle: 'bold',
                stroke: '#000000', strokeThickness: 3,
            }).setOrigin(0.5).setDepth(24)

            this.prestigeMilestones.push({portrait, badge: starIcon, ratio: m.ratio})
        }
    }

    private _drawPrestigeBarFill() {
        if (!this.prestigeBarGfx) return
        const gfx = this.prestigeBarGfx
        gfx.clear()
        const bX = 10, bY = 8, bW = 358, bH = 30

        // Light gray track
        gfx.fillStyle(0xbbbbbb, 1)
        gfx.fillRoundedRect(bX, bY, bW, bH, bH / 2)
        // Subtle inner shadow
        gfx.fillStyle(0x999999, 0.4)
        gfx.fillRoundedRect(bX + 1, bY + bH / 2, bW - 2, bH / 2 - 1, bH / 2 - 1)

        // Green fill
        if (this.prestigeFillRatio > 0.01) {
            const fillW = Math.max(bH, bW * this.prestigeFillRatio)
            gfx.fillStyle(0x3ec93e, 1)
            gfx.fillRoundedRect(bX, bY, fillW, bH, bH / 2)
            // Highlight shine on fill
            gfx.fillStyle(0x80ff80, 0.3)
            gfx.fillRoundedRect(bX + 3, bY + 3, fillW - 6, bH / 2 - 4, bH / 4)
        }

        // Thin border
        gfx.lineStyle(1.5, 0x777777, 0.5)
        gfx.strokeRoundedRect(bX, bY, bW, bH, bH / 2)

        // Milestone tint — light up portrait + star when milestone is reached
        for (const m of this.prestigeMilestones) {
            if (this.prestigeFillRatio >= m.ratio - 0.02) {
                m.portrait.clearTint()
                m.badge.setAlpha(1)
            } else {
                m.portrait.setTint(0x111111)
                m.badge.setAlpha(0.45)
            }
        }
    }

    private _advancePrestige() {
        const targetRatio = Math.min(1.0, this.prestigeLevel / 3)
        this.tweens.add({
            targets: this,
            prestigeFillRatio: targetRatio,
            duration: 1200,
            ease: 'Cubic.easeOut',
            onUpdate: () => this._drawPrestigeBarFill(),
        })
    }

    // ── PER-ANIMAL CAGE HUD ───────────────────────────────────────────────

    private createAnimalHudItems() {
        for (const animal of this.ld.animals) {
            const iconKey = `ui-${animal.id}`
            const hasIcon = this.textures.exists(iconKey)
            const isLocked = animal.startLocked

            // Background circle — darker when locked
            const bgCircle = this.add.graphics()
            bgCircle.fillStyle(isLocked ? 0x444444 : 0xffffff, 1)
            bgCircle.fillCircle(0, 0, 24)

            // Portrait — dark tint when locked
            const portrait = this.add.image(0, 0, hasIcon ? iconKey : '__DEFAULT')
                .setDisplaySize(40, 40).setOrigin(0.5)
            if (isLocked) portrait.setTint(0x111111)

            // Padlock: centered on icon when locked, prominent
            let padlockImg: Phaser.GameObjects.Image | null = null
            if (isLocked) {
                padlockImg = this.add.image(0, 0, 'ui-padlock').setDisplaySize(28, 28).setOrigin(0.5)
            }

            // Star cost badge below portrait when locked
            const enc = this.ld.enclosures.find(e => e.id === animal.enclosureId)
            const unlockCost = enc?.unlockCost ?? 0
            let costLabel: Phaser.GameObjects.Container | null = null
            if (isLocked && unlockCost > 0) {
                const costBg = this.add.graphics()
                costBg.fillStyle(0x000000, 0.55)
                costBg.fillRoundedRect(-24, -11, 48, 22, 11)
                const starIco = this.add.image(-10, 0, 'ui-star').setDisplaySize(14, 14).setOrigin(0.5)
                const costTxt = this.add.text(5, 0, String(unlockCost), {
                    fontSize: '13px', color: '#ffd700', fontFamily: FONT, fontStyle: 'bold',
                    stroke: '#000000', strokeThickness: 3,
                }).setOrigin(0.5)
                costLabel = this.add.container(0, 38, [costBg, starIco, costTxt])
            }

            // Radial ring (redrawn each frame)
            const ring = this.add.graphics()

            // Off-screen arrow indicator — larger, more visible
            const arrowBg = this.add.graphics()
            arrowBg.fillStyle(0x000000, 0.45)
            arrowBg.fillCircle(0, 0, 14)
            const arrowGfx = this.add.graphics()
            arrowGfx.fillStyle(0xffffff, 1)
            arrowGfx.fillTriangle(0, -8, -6, 5, 6, 5)
            const arrowCtr = this.add.container(0, 36, [arrowBg, arrowGfx])
                .setDepth(27).setVisible(false)

            const children: any[] = [ring, bgCircle, portrait]
            if (padlockImg) children.push(padlockImg)
            if (costLabel) children.push(costLabel)
            const container = this.add.container(0, 0, children).setDepth(24)

            this.animalHudItems.set(animal.id, {container, ring, portrait, padlockImg, costLabel, arrowCtr})
        }
    }

    private _drawRadialRing(
        gfx: Phaser.GameObjects.Graphics, ratio: number,
        r: number, color: number, alpha: number
    ) {
        gfx.clear()
        // Track
        gfx.lineStyle(5, 0x333333, 0.55)
        gfx.beginPath()
        gfx.arc(0, 0, r, 0, Math.PI * 2, false)
        gfx.strokePath()
        if (ratio <= 0.01) return
        // Fill arc starting at top (-π/2)
        const start = -Math.PI / 2
        const end = start + ratio * Math.PI * 2
        gfx.lineStyle(5, color, alpha)
        gfx.beginPath()
        gfx.arc(0, 0, r, start, end, false)
        gfx.strokePath()
    }

    private _screenEdgeClamp(tx: number, ty: number, margin: number): {x: number; y: number; angle: number} {
        const cx = GAME_W / 2, cy = GAME_H / 2
        const dx = tx - cx, dy = ty - cy
        const angle = Math.atan2(dy, dx)
        const topMargin = 70  // below prestige bar
        const scaleX = Math.abs(dx) > 0.01 ? (GAME_W / 2 - margin) / Math.abs(dx) : Infinity
        const scaleY = Math.abs(dy) > 0.01 ? (GAME_H / 2 - margin) / Math.abs(dy) : Infinity
        const scale = Math.min(scaleX, scaleY, 1)
        const ex = Math.max(margin, Math.min(GAME_W - margin, cx + dx * scale))
        const ey = Math.max(topMargin, Math.min(GAME_H - margin, cy + dy * scale))
        return {x: ex, y: ey, angle}
    }

    private updateAnimalHud() {
        const RING_R = 32
        const MARGIN = 58
        const phaseCfg = this.ld.phases.find(p => p.id === this.phase)

        for (const [animalId, hud] of this.animalHudItems) {
            const animal = this.ld.animals.find(a => a.id === animalId)
            const enc = animal ? this.ld.enclosures.find(e => e.id === animal.enclosureId) : null
            if (!enc) continue

            const raw = this.project(new Vector3(enc.centerX, 4.5, -7))
            const isOffscreen = raw.x < MARGIN || raw.x > GAME_W - MARGIN
                              || raw.y < 80 || raw.y > GAME_H - MARGIN

            // Pop when transitioning onto screen edge
            const wasOffscreen = this.animalWasOffscreen.get(animalId) ?? false
            if (isOffscreen && !wasOffscreen) {
                this.tweens.killTweensOf(hud.container)
                this.tweens.add({
                    targets: hud.container, scaleX: 1.35, scaleY: 1.35,
                    duration: 180, yoyo: true, ease: 'Back.easeOut',
                })
            }
            this.animalWasOffscreen.set(animalId, isOffscreen)

            let px: number, py: number
            if (isOffscreen) {
                const clamped = this._screenEdgeClamp(raw.x, raw.y, MARGIN)
                px = clamped.x; py = clamped.y
                hud.arrowCtr.setPosition(px, py)
                hud.arrowCtr.setRotation(clamped.angle + Math.PI / 2)
                hud.arrowCtr.setVisible(true)
            } else {
                px = raw.x; py = raw.y
                hud.arrowCtr.setVisible(false)
            }
            hud.container.setPosition(px, py)

            // Fed animals: hide the whole icon — it served its purpose
            if (this.fedAnimals.has(animalId)) {
                hud.container.setVisible(false)
                hud.arrowCtr.setVisible(false)
                hud.ring.clear()
                continue
            }

            // Per-animal ring — use individual needs value
            const needs = this.animalNeeds.get(animalId) ?? 1.0
            const isCompleted = this.completedAnimals.has(animalId)
            const isLocked = hud.padlockImg !== null && hud.padlockImg.visible

            if (isLocked) {
                this._drawRadialRing(hud.ring, 0, RING_R, 0x555555, 0.4)
            } else if (isCompleted) {
                // Completed animals show green ring at their current needs level
                this._drawRadialRing(hud.ring, needs, RING_R, 0x4caf50, 1)
            } else {
                // Active or inactive unlocked — color reflects urgency
                const isActive = phaseCfg?.animalId === animalId
                const color = isActive
                    ? (needs > 0.5 ? 0x4caf50 : needs > 0.25 ? 0xffc107 : 0xf44336)
                    : 0x4caf50
                this._drawRadialRing(hud.ring, needs, RING_R, color, isActive ? 1 : 0.6)
            }
        }
    }

    private purchaseEnclosure(encId: string) {
        const enc = this.ld.enclosures.find(e => e.id === encId)
        if (!enc) return
        const cost = enc.unlockCost ?? 0
        if (this.starCount < cost) {
            if (this.starHud) {
                const ox = this.starHud.x
                this.tweens.killTweensOf(this.starHud)
                this.tweens.add({
                    targets: this.starHud, x: {from: ox - 8, to: ox + 8},
                    duration: 55, yoyo: true, repeat: 4,
                    onComplete: () => { if (this.starHud) this.starHud.x = ox }
                })
            }
            return
        }
        this.starCount -= cost
        this.purchasedEnclosures.add(encId)
        if (this.starHudText) this.starHudText.setText(String(this.starCount))

        const animalCfg = this.ld.animals.find(a => a.enclosureId === encId)
        if (animalCfg) {
            // Reveal 3D animals with stagger
            const groups = this.animalGroups.get(animalCfg.id) ?? []
            groups.forEach((g, i) => {
                this.time.delayedCall(i * 80, () => {
                    g.visible = true
                    this.successEffect(g)
                }, [], this)
            })

            // Unlock HUD item: clear tint, fade out padlock
            const hud = this.animalHudItems.get(animalCfg.id)
            if (hud) {
                hud.portrait.clearTint()
                if (hud.padlockImg) {
                    this.tweens.add({
                        targets: hud.padlockImg, scaleX: 0, scaleY: 0, alpha: 0,
                        duration: 350, ease: 'Back.easeIn',
                        onComplete: () => { hud.padlockImg?.setVisible(false) }
                    })
                }
                if (hud.costLabel) {
                    this.tweens.add({
                        targets: hud.costLabel, scaleX: 0, scaleY: 0, alpha: 0,
                        duration: 350, ease: 'Back.easeIn',
                        onComplete: () => { hud.costLabel?.setVisible(false) }
                    })
                }
            }

            // Activate needs for this animal if it's the current phase
            const phaseCfg = this.ld.phases.find(p => p.id === this.phase)
            if (phaseCfg?.animalId === animalCfg.id) {
                this.animalNeeds.set(animalCfg.id, 1.0)
                this.needsDrainActive = true
            }

            // Reveal items for this enclosure's phases (skip startVisible:false — those are revealed mid-game)
            for (const phase of this.ld.phases) {
                if (phase.enclosureId !== encId) continue
                const itemCfg = this.ld.items.find(i => i.type === phase.requiredItem)
                const mesh = this.itemMeshes.get(phase.requiredItem)
                if (mesh && itemCfg?.startVisible !== false) mesh.visible = true
            }
        }
    }

    // ── CAMERA & INPUT ───────────────────────────────────────────────────

    private setupCamera() {
        const cam = this.third.camera as PerspectiveCamera
        cam.fov = 75
        cam.updateProjectionMatrix()
        this.third.camera.position.set(-8, 5, 12)
        this.third.camera.lookAt(-12, 0, 0)
    }

    private setupJoystick() {
        this.time.delayedCall(100, () => {
            this.scale.updateBounds()
            const {x, bottom} = this.scale.canvasBounds
            const joystick: JoyStick = new (JoyStick as any)(document.body)
            const axis = joystick.add.axis({
                styles: {left: Math.round(x) + 40, bottom: Math.round(window.innerHeight - bottom) + 40, size: 130},
            })
            // The circle div is synchronously appended to body as its last child
            this.joystickEl = document.body.lastElementChild as HTMLElement
            axis.onMove((delta: any) => {
                this.moveData = {top: delta.top ?? 0, right: delta.right ?? 0}
            })
        }, [], this)
    }

    // ── UI ───────────────────────────────────────────────────────────────

    private setupUI() {
        this.createPrestigeBar()
        this.createAnimalHudItems()
        this.setupStarHud()
        this.createPickupArrows()
    }

    // ── TUTORIAL ─────────────────────────────────────────────────────────

    private _showTutorial() {
        const tut = this.ld.tutorial
        if (!tut?.steps?.length) return

        // Joystick sits at bottom-left; position hint just above and to the right of it
        const tx = 190, ty = GAME_H - 190

        const handIcon = this.add.image(0, 0, 'ui-pointer').setDisplaySize(40, 40).setOrigin(0.5)
        const label = this.add.text(0, 38, 'SWIPE', {
            fontSize: '30px', color: '#ffffff', fontStyle: 'bold', fontFamily: FONT,
            stroke: '#000000', strokeThickness: 5,
        }).setOrigin(0.5)

        this.tutorialContainer = this.add.container(tx, ty, [handIcon, label])
            .setDepth(30).setAlpha(0)

        this.tweens.add({
            targets: this.tutorialContainer, alpha: 1,
            duration: 350, ease: 'Sine.easeOut',
        })

        // Slide hand left-right; text stays fixed below it
        handIcon.setX(-20)
        this.tweens.add({
            targets: handIcon, x: 20,
            duration: 420, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
        })

        this.time.delayedCall(tut.autoDismissMs ?? 4000, () => this._dismissTutorial(), [], this)
    }

    private _dismissTutorial() {
        if (!this.tutorialContainer?.active) return
        this.tutorialContainer.each((child: any) => this.tweens.killTweensOf(child))
        this.tweens.add({
            targets: this.tutorialContainer, alpha: 0, duration: 400,
            onComplete: () => {
                this.tutorialContainer?.destroy();
                this.tutorialContainer = null
            },
        })
    }

    // ── PICKUP ARROWS (replaces tap bubbles for items) ────────────────────

    private createPickupArrows() {
        for (const phase of this.ld.phases) {
            const arrow = this.add.image(0, 0, 'ui-arrow')
                .setDisplaySize(44, 44)
                .setDepth(32)
                .setAlpha(0)
                .setOrigin(0.5)
            this.tweens.add({
                targets: arrow,
                scaleX: 1.3, scaleY: 1.3,
                duration: 450, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
            })
            this.pickupArrows.set(phase.requiredItem, arrow)
        }
    }

    private updateAutoPickup() {
        const phaseCfg = this.ld.phases.find(p => p.id === this.phase)
        if (!phaseCfg) return
        if (this.carrying(phaseCfg.requiredItem)) return
        if (!this.purchasedEnclosures.has(phaseCfg.enclosureId)) return
        const mesh = this.itemMeshes.get(phaseCfg.requiredItem)
        if (!mesh?.visible) return
        const pos = this.itemPositions.get(phaseCfg.requiredItem)
        if (!pos) return
        const px = this.player.position.x, pz = this.player.position.z
        if (Math.hypot(px - pos.x, pz - pos.z) < 1.8) {
            this.pickup(phaseCfg.requiredItem)
        }
    }

    private updatePickupArrows() {
        for (const phase of this.ld.phases) {
            const arrow = this.pickupArrows.get(phase.requiredItem)
            if (!arrow) continue
            const available =
                this.phase === phase.id &&
                this.purchasedEnclosures.has(phase.enclosureId) &&
                !this.carrying(phase.requiredItem) &&
                (this.itemMeshes.get(phase.requiredItem)?.visible ?? false)

            if (!available) { arrow.setAlpha(0); continue }

            const base = this.itemPositions.get(phase.requiredItem) ?? new Vector3()
            const bobY = Math.sin(this.elapsedTime * 3.5) * 0.12
            const {x, y} = this.project(new Vector3(base.x, base.y + 1.4 + bobY, base.z))
            arrow.setPosition(x, y).setAlpha(1)
        }
    }



    private updateItemBobbing(dt: number) {
        for (const [type, mesh] of this.itemMeshes) {
            if (!mesh.visible) continue
            if (this.carriedItems.some(c => c.type === type)) continue
            const baseY = this.itemBaseY.get(type) ?? 0.5
            mesh.position.y = baseY + Math.sin(this.elapsedTime * 2.2) * 0.18
            mesh.rotation.y += dt * 1.2
        }
    }

    private handleMovement(dt: number) {
        const {top, right} = this.moveData
        const {speed, bounds} = this.ld.world
        const moving = Math.abs(top) > 0.05 || Math.abs(right) > 0.05
        if (moving) {
            this.player.position.x += right * speed * dt
            this.player.position.z -= top * speed * dt
            this.player.rotation.y = Math.atan2(right, -top)
            if (!this.isMoving) {
                this._dismissTutorial()
                this.idleAction?.fadeOut(0.2);
                this.walkAction?.reset().fadeIn(0.2).play();
                this.isMoving = true
            }
        } else if (this.isMoving) {
            this.walkAction?.fadeOut(0.2);
            this.idleAction?.reset().fadeIn(0.2).play();
            this.isMoving = false
        }
        this.player.position.x = Math.max(bounds.xMin, Math.min(bounds.xMax, this.player.position.x))
        this.player.position.z = Math.max(bounds.zMin, Math.min(bounds.zMax, this.player.position.z))
    }

    private updateCarryStack() {
        const bob = (i: number) => Math.sin(this.elapsedTime * 3 + i) * 0.08
        this.carriedItems.forEach((item, i) => {
            item.mesh.position.set(
                this.player.position.x,
                this.player.position.y + 2 + i * 0.6 + bob(i),
                this.player.position.z,
            )
        })
    }

    private updateCamera() {
        const {x, y, z} = this.player.position
        this.third.camera.position.x = MathUtils.lerp(this.third.camera.position.x, x + 2, 0.1)
        this.third.camera.position.y = 5
        this.third.camera.position.z = MathUtils.lerp(this.third.camera.position.z, z + 10, 0.1)
        this.third.camera.lookAt(x + 2, y + 0.5, z)
    }

    private project(worldPos: Vector3): { x: number; y: number } {
        const v = worldPos.clone().project(this.third.camera)
        return {x: (v.x + 1) / 2 * GAME_W, y: (1 - v.y) / 2 * GAME_H}
    }

    private _showBubble(item: Interactable) {
        const c = item.bubbleSprite!
        const existingWiggle = this.bubbleWiggles.get(item.id)
        if (existingWiggle) existingWiggle.stop()
        this.tweens.killTweensOf(c)
        c.setVisible(true).setScale(0).setAngle(0)
        this.tweens.add({
            targets: c, scaleX: 1, scaleY: 1,
            duration: 300, ease: 'Back.easeOut',
            onComplete: () => {
                const wiggle = this.tweens.add({
                    targets: c, angle: {from: -8, to: 8},
                    duration: 380, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
                })
                this.bubbleWiggles.set(item.id, wiggle)
            }
        })
    }

    private _hideBubble(item: Interactable) {
        const c = item.bubbleSprite!
        const wiggle = this.bubbleWiggles.get(item.id)
        if (wiggle) { wiggle.stop(); this.bubbleWiggles.delete(item.id) }
        this.tweens.killTweensOf(c)
        c.setAngle(0)
        this.tweens.add({
            targets: c, scaleX: 0, scaleY: 0,
            duration: 160, ease: 'Quad.easeIn',
            onComplete: () => c.setVisible(false)
        })
    }

    private updateBubbles() {
        const px = this.player.position.x, pz = this.player.position.z
        const range = this.ld.world.interactRange
        for (const item of this.interactables) {
            if (!item.bubbleSprite) continue
            const available = item.isAvailable()
            const wp = item.getWorldPos()

            let show: boolean
            if (item.id.endsWith('_deliver')) {
                // Delivery: visible anywhere inside the enclosure zone
                const phaseId = item.id.slice(0, -8)
                const phase = this.ld.phases.find(p => p.id === phaseId)
                const enc = phase ? this.ld.enclosures.find(e => e.id === phase.enclosureId) : null
                const inZone = enc
                    ? (px >= enc.zoneXMin && px <= enc.zoneXMax && pz < this.ld.world.enclosureEntryZ)
                    : Math.hypot(px - wp.x, pz - wp.z) < range
                show = available && inZone
            } else {
                // Purchase bubbles: standard range check
                const inRange = Math.hypot(px - wp.x, pz - wp.z) < range
                show = available && inRange
            }

            const wasVisible = this.prevBubbleVisible.get(item.id) ?? false
            if (show !== wasVisible) {
                this.prevBubbleVisible.set(item.id, show)
                if (show) this._showBubble(item)
                else this._hideBubble(item)
            }
            if (item.bubbleSprite.visible) {
                const {x, y} = this.project(new Vector3(wp.x, wp.y + 2, wp.z))
                item.bubbleSprite.setPosition(x, y)
            }
        }
    }



    // ── PER-ANIMAL PROXIMITY-BASED NEEDS ────────────────────────────────

    private updateNeeds(dt: number) {
        if (!this.needsDrainActive || this.phase === 'done') return

        const phaseCfg = this.ld.phases.find(p => p.id === this.phase)
        const px = this.player.position.x
        const pz = this.player.position.z
        const activeDrainRate = 1 / this.ld.world.timerDuration
        const idleRate = 0.025
        for (const animal of this.ld.animals) {
            const enc = this.ld.enclosures.find(e => e.id === animal.enclosureId)!
            const isLocked = animal.startLocked && !this.purchasedEnclosures.has(animal.enclosureId)
            if (isLocked) continue
            if (this.fedAnimals.has(animal.id)) continue  // fed once → no more draining

            const needs = this.animalNeeds.get(animal.id) ?? 1.0
            const isActivePhasAnimal = phaseCfg?.animalId === animal.id
            const isCompleted = this.completedAnimals.has(animal.id)

            const rate = isActivePhasAnimal && !isCompleted ? activeDrainRate : idleRate
            const newNeeds = Math.max(0, needs - dt * rate)
            this.animalNeeds.set(animal.id, newNeeds)
            if (isActivePhasAnimal && !isCompleted && newNeeds <= 0) {
                this.needsDrainActive = false
                this.onTimerExpired()
            }
        }
    }



    // ── FAIL FLOW ────────────────────────────────────────────────────────

    private onTimerExpired() {
        this.cameras.main.shake(400, 0.015)

        const cx = GAME_W / 2
        const PANEL_W = 390, PANEL_H = 360
        const panelY  = GAME_H / 2 - 20   // slightly above center
        const D = 200

        // Dark overlay
        const overlay = this.add.rectangle(cx, GAME_H / 2, GAME_W, GAME_H, 0x000000, 0.65)
            .setDepth(D).setAlpha(0)

        // Panel card
        const panel = this.add.image(cx, panelY, 'ui-final-panel')
            .setDisplaySize(PANEL_W, PANEL_H).setOrigin(0.5).setDepth(D + 1).setAlpha(0)

        // Broken star — punches in above panel top
        const starY = panelY - PANEL_H / 2 + 10
        const brokenStar = this.add.image(cx, starY, 'ui-broken-star')
            .setDisplaySize(190, 190).setOrigin(0.5).setDepth(D + 3).setScale(0)

        // Title — red, punchy failure copy
        const title = this.add.text(cx, panelY - 40, "YOU'RE FIRED!", {
            fontSize: '40px', color: '#e53935', fontStyle: 'bold', fontFamily: FONT,
            stroke: '#ffffff', strokeThickness: 4,
        }).setOrigin(0.5).setDepth(D + 2).setAlpha(0)

        // Subtitle — white, shame-inducing
        const subtitle = this.add.text(cx, panelY + 50, "YOUR ANIMALS\nNEED YOU.", {
            fontSize: '24px', color: '#ffffff', fontStyle: 'bold', fontFamily: FONT,
            align: 'center', stroke: '#000000', strokeThickness: 4,
        }).setOrigin(0.5).setDepth(D + 2).setAlpha(0)

        // Try Again button
        const btnY = panelY + PANEL_H / 2 - 58
        const btnImg = this.add.image(cx, btnY, 'ui-button-red')
            .setDisplaySize(290, 70).setOrigin(0.5).setDepth(D + 2).setAlpha(0).setInteractive()
        const btnText = this.add.text(cx, btnY, 'TRY AGAIN', {
            fontSize: '28px', color: '#ffffff', fontStyle: 'bold', fontFamily: FONT,
            stroke: '#7a1500', strokeThickness: 4,
        }).setOrigin(0.5).setDepth(D + 3).setAlpha(0)

        // ── Animation chain ──────────────────────────────────────────────
        // 1. Overlay + panel fade in
        this.tweens.add({ targets: [overlay, panel], alpha: 1, duration: 250, ease: 'Sine.easeOut' })

        // 2. Broken star punches in with overshoot
        this.time.delayedCall(180, () => {
            this.tweens.add({ targets: brokenStar, scale: 1, duration: 320, ease: 'Back.easeOut' })
        })

        // 3. Text + button fade in
        this.time.delayedCall(400, () => {
            this.tweens.add({ targets: [title, subtitle, btnImg, btnText], alpha: 1, duration: 220 })
        })

        // ── Retry tap ────────────────────────────────────────────────────
        const destroyAll = () => {
            [overlay, panel, brokenStar, title, subtitle, btnImg, btnText].forEach(o => o.destroy())
            this.retryCurrentAnimal()
        }
        btnImg.on('pointerdown', destroyAll)
        btnText.setInteractive().on('pointerdown', destroyAll)
    }

    private retryCurrentAnimal() {
        for (const item of this.carriedItems) this.third.scene.remove(item.mesh)
        this.carriedItems = []

        // If current phase was preceded by a "showItemType" step (e.g. lion_food after lion_toy),
        // revert to that previous phase and hide the revealed item.
        const currentPhase = this.ld.phases.find(p => p.id === this.phase)
        if (currentPhase) {
            const idx = this.ld.phases.indexOf(currentPhase)
            const prevPhase = idx > 0 ? this.ld.phases[idx - 1] : null
            if (prevPhase?.animalId === currentPhase.animalId && prevPhase.onComplete.showItemType) {
                this.phase = prevPhase.id
                const shownMesh = this.itemMeshes.get(prevPhase.onComplete.showItemType)
                if (shownMesh) shownMesh.visible = false
            }
        }

        // Ensure the current phase's item is visible
        const activePhaseCfg = this.ld.phases.find(p => p.id === this.phase)
        if (activePhaseCfg) {
            const m = this.itemMeshes.get(activePhaseCfg.requiredItem)
            if (m) m.visible = true
        }

        // Reset needs for current animal to full
        const resetPhase = this.ld.phases.find(p => p.id === this.phase)
        if (resetPhase) this.animalNeeds.set(resetPhase.animalId, 1.0)
        this.needsDrainActive = true
    }

    // ── ENDCARD ──────────────────────────────────────────────────────────

    private showEndcard() {
        const cx = GAME_W / 2

        // Hide joystick DOM element
        if (this.joystickEl) this.joystickEl.style.display = 'none'

        // ── CTA background (full-screen illustration) ────────────────────
        this.add.image(0, 0, 'ui-cta-bg')
            .setOrigin(0).setDisplaySize(GAME_W, GAME_H).setDepth(99)

        // ── Panel card ───────────────────────────────────────────────────
        const PANEL_CY  = 590
        const PANEL_W   = 430
        const PANEL_H   = 540
        const panel = this.add.image(cx, PANEL_CY, 'ui-final-panel')
            .setDisplaySize(PANEL_W, PANEL_H).setOrigin(0.5).setDepth(101)

        // ── Logo — overlaps top edge of panel (depth above headline) ─────
        const LOGO_CY = PANEL_CY - PANEL_H / 2 - 50
        const logo = this.add.image(cx, LOGO_CY - 180, 'ui-game-logo')
            .setDisplaySize(330, 240).setOrigin(0.5).setDepth(104).setAlpha(0)

        // ── "YOUR ZOO IS BOOMING!" — pushed below logo bottom edge ───────
        const headline = this.add.text(cx, PANEL_CY - 110, 'YOUR ZOO IS\nBOOMING!', {
            fontSize: '44px', color: '#3E9D0B', fontStyle: 'bold', fontFamily: FONT,
            stroke: '#1a5c00', strokeThickness: 5,
            align: 'center', lineSpacing: 4,
        }).setOrigin(0.5).setDepth(102)

        // ── Giraffe + gift (punches in after panel lands) ─────────────────
        const giraffe = this.add.image(cx, PANEL_CY + 50, 'ui-giraffe')
            .setDisplaySize(210, 210).setOrigin(0.5).setDepth(102).setScale(0)

        // ── "NEW ANIMAL UNLOCKED" ─────────────────────────────────────────
        const sub = this.add.text(cx, PANEL_CY + 178, 'NEW ANIMAL\nUNLOCKED', {
            fontSize: '26px', color: '#4D4D4D', fontStyle: 'bold', fontFamily: FONT,
            align: 'center', lineSpacing: 4,
        }).setOrigin(0.5).setDepth(102)

        // ── CTA button — btn + text in one container so they pulse as one ─
        const btnImg  = this.add.image(0, 0, 'ui-cta-button').setDisplaySize(330, 74).setOrigin(0.5)
        const btnText = this.add.text(0, 0, 'PLAY NOW!', {
            fontSize: '32px', color: '#ffffff', fontStyle: 'bold', fontFamily: FONT,
            stroke: '#1a6600', strokeThickness: 5,
        }).setOrigin(0.5)
        const btnCtr = this.add.container(cx, PANEL_CY + 245, [btnImg, btnText])
            .setDepth(103).setSize(330, 74).setInteractive()
            .on('pointerdown', () => console.log('CTA → store redirect'))

        // ── Animations ───────────────────────────────────────────────────

        // 1) Panel + contents slide up from off-screen bottom
        const slideItems: any[] = [panel, headline, sub, btnCtr]
        slideItems.forEach(o => { o.y += GAME_H })
        this.tweens.add({
            targets: slideItems, y: `-=${GAME_H}`,
            duration: 650, ease: 'Back.easeOut',
            onComplete: () => {
                // 2) Logo drops in with spring after panel lands
                this.tweens.add({
                    targets: logo, y: LOGO_CY, alpha: 1,
                    duration: 520, ease: 'Back.easeOut',
                    onComplete: () => {
                        // 3) Giraffe punch — scale 0 → 1.35 → 1 (one shot)
                        this.tweens.add({
                            targets: giraffe,
                            scaleX: 1.35, scaleY: 1.35,
                            duration: 260, ease: 'Back.easeOut',
                            onComplete: () => this.tweens.add({
                                targets: giraffe,
                                scaleX: 1, scaleY: 1,
                                duration: 180, ease: 'Quad.easeOut',
                                onComplete: () => {
                                    // 4) Single container pulse — button + text move together
                                    this.tweens.add({
                                        targets: btnCtr,
                                        scaleX: 1.07, scaleY: 1.07,
                                        duration: 650, yoyo: true, repeat: -1,
                                        ease: 'Sine.easeInOut',
                                    })
                                },
                            }),
                        })
                    },
                })
            },
        })
    }
}
