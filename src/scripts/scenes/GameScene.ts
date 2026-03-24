import {Scene3D, JoyStick} from '@enable3d/phaser-extension'
import {
    AnimationAction, AnimationMixer, Box3, Color, CylinderGeometry, Group, MathUtils,
    Mesh, MeshBasicMaterial, MeshLambertMaterial,
    PerspectiveCamera, PlaneGeometry, SphereGeometry, Vector3,
} from 'three'
import {AnimalWander, AnimalAnimPair} from '../zoo/AnimalWander'
import type {LevelData, AnimalConfig, EnclosureConfig, PhaseConfig, BubbleConfig} from '../types/LevelData'
import {
    GAME_W, GAME_H, FONT,
} from '../EngineConstants'
import { projectToScreen, clampToScreenEdge } from '../utils/WorldUI'
import { createActionBubble, createPurchaseBubble } from '../ui/BubbleFactory'
import { AssetLoader } from '../utils/AssetLoader'
import { SoundManager } from '../managers/SoundManager'
import { PhaseManager } from '../managers/PhaseManager'
import { AudioConfig } from '../config/AudioConfig'

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

/** Payload emitted on the 'delivery:success' event. */
interface DeliveryPayload {
    /** The phase that was just completed (before advancing). */
    phase:  PhaseConfig
    /** Enclosure config for that phase (may be undefined if misconfigured). */
    enc:    EnclosureConfig | undefined
    /** All 3D animal groups in the enclosure. */
    groups: Group[]
    /** First group — used as the reference point for screen projections. */
    group:  Group | undefined
}

export default class GameScene extends Scene3D {
    // ── level data ────────────────────────────────────────────────────────
    private ld!: LevelData
    private assetLoader!: AssetLoader
    private sfx!: SoundManager
    private phaseManager!: PhaseManager

    // ── movement ─────────────────────────────────────────────────────────
    private moveData = {top: 0, right: 0}
    private joystickEl: HTMLElement | null = null
    private player: Group | null = null
    private mixer: AnimationMixer | null = null
    private idleAction: AnimationAction | null = null
    private walkAction: AnimationAction | null = null
    private isMoving = false
    private elapsedTime = 0
    // Pre-created looping footstep sounds — created once, played/stopped directly
    private footstepSounds: Phaser.Sound.BaseSound[] = []
    private footstepSound: Phaser.Sound.BaseSound | null = null

    // ── game state ────────────────────────────────────────────────────────
    private carriedItems: CarriedItem[] = []
    private interactables: Interactable[] = []
    private animalWanders: Map<string, AnimalWander> = new Map()

    // ── 3-D objects ───────────────────────────────────────────────────────
    private animalGroups = new Map<string, Group[]>()   // [0] = primary used for icons/effects
    private animalOriginalMats = new Map<Mesh, any>()
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
    private purchasedEnclosures = new Set<string>()
    private starHud: Phaser.GameObjects.Container | null = null
    private starHudText: Phaser.GameObjects.Text | null = null
    private bubbleWiggles = new Map<string, Phaser.Tweens.Tween>()
    private prevBubbleVisible = new Map<string, boolean>()

    // ── HUD layout ────────────────────────────────────────────────────────
    // Edit these values to reposition or resize every HUD element at once.
    // bar.x is derived automatically from logo.x + logo.w/2 + bar.gap.
    private readonly HUD = {
        logo:  { x: 70,  y: 44, w: 123, h: 87  },
        btn:   { offsetY: 64, w: 135, h: 42, fontSize: '20px' },
        bar:   { gap: 8, y: 35, w: 265, h: 24 },
        stars: { marginRight: 70, y: 48, w: 80, h: 36 },
    }

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
        // Audio
        this.load.audio('bgm',            'assets/audios/bgm.mp3')
        this.load.audio('sfx-whoosh',     'assets/audios/Whoosh.mp3')
        this.load.audio('sfx-unlock',     'assets/audios/purchase.mp3')
        this.load.audio('sfx-coin',       'assets/audios/Coin Bag 3-1.mp3')
        this.load.audio('sfx-win',        'assets/audios/win-sound.mp3')
        this.load.audio('sfx-monkey',     'assets/audios/monkey.mp3')
        this.load.audio('sfx-elephant',   'assets/audios/elephant.mp3')
        this.load.audio('sfx-lion',       'assets/audios/lion.mp3')
        this.load.audio('sfx-footstep-1', 'assets/audios/Footsteps_Sand_Walk_01.mp3')
        this.load.audio('sfx-footstep-2', 'assets/audios/Footsteps_Sand_Walk_10.mp3')
        this.load.audio('sfx-footstep-3', 'assets/audios/Footsteps_Sand_Walk_17.mp3')
    }

    // ── LIFECYCLE ────────────────────────────────────────────────────────

    async create() {
        this.ld = this.cache.json.get('level') as LevelData
        this.assetLoader = new AssetLoader(this.third)
        this.phaseManager = new PhaseManager(this.ld.phases)
        this.sfx = new SoundManager(this, { musicVolume: AudioConfig.master.music, sfxVolume: AudioConfig.master.sfx })
        this.sfx.playMusic('bgm', { fadeIn: AudioConfig.timing.musicFadeIn })
        // Pre-create looping footstep sounds so we always hold a reliable reference
        this.footstepSounds = [
            this.sound.add('sfx-footstep-1', { loop: true, volume: AudioConfig.sfx.footstep }),
            this.sound.add('sfx-footstep-2', { loop: true, volume: AudioConfig.sfx.footstep }),
            this.sound.add('sfx-footstep-3', { loop: true, volume: AudioConfig.sfx.footstep }),
        ]

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

        // Load all 3D assets in parallel
        await Promise.all([
            this.loadFences(),
            this.loadPlayer(),
            this.loadAnimals(),
            this.loadItems(),
            this.loadProps(),
        ])

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
        this._setupDeliveryListeners()
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

        for (const [, w] of this.animalWanders) {
            w.update(dt)
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
        const f    = this.ld.fence
        const gltf = await this.assetLoader.loadGltf(f.model)
        if (!gltf) return

        const template = gltf.scene

        // Measure GLB pivot offset in Z — the mesh is NOT centered at Z=0.
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
            // Side columns
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
    }

    // ── CHARACTER ────────────────────────────────────────────────────────

    private async loadPlayer() {
        const cfg  = this.ld.player
        const gltf = await this.assetLoader.loadGltf(cfg.model)
        if (!gltf) return
        const player = gltf.scene
        this.player  = player
        player.scale.setScalar(cfg.scale)
        player.position.set(cfg.startX, 0, cfg.startZ)
        player.traverse((c: any) => {
            if (c.isMesh) {
                c.castShadow = true;
                c.receiveShadow = true
            }
        })
        this.third.scene.add(player)

        const mixer = this.third.animationMixers.create(player)
        this.mixer = mixer
        const idleClip = gltf.animations.find((a: any) => a.name === 'idle')
        const walkClip = gltf.animations.find((a: any) => a.name === 'walk')
        if (idleClip) {
            this.idleAction = mixer.clipAction(idleClip);
            this.idleAction!.play()
        }
        if (walkClip) {
            this.walkAction = mixer.clipAction(walkClip)
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

        const gltfs = await this.assetLoader.loadManyGltf(queue.map(q => q.cfg.model))

        gltfs.forEach((gltf, qi) => {
            if (!gltf) return
            const { cfg, enc, idx } = queue[qi]
            const n = cfg.count ?? 1
            // Clone so each animal instance is an independent scene graph node
            const group = gltf.scene.clone(true)

            // Spread X across enclosure width, alternate Z for visual variety
            const xMin = enc.centerX - enc.width / 2 + 2, xMax = enc.centerX + enc.width / 2 - 2
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

            let animPair: AnimalAnimPair | undefined
            const mixer = this.third.animationMixers.create(group)
            const staticClip = gltf.animations.find((a: any) => a.name === 'static')
            const walkClip   = gltf.animations.find((a: any) => a.name === 'walk')
            if (staticClip && walkClip) {
                animPair = {
                    staticAction: mixer.clipAction(staticClip),
                    walkAction:   mixer.clipAction(walkClip),
                }
            }

            this.animalWanders.set(wanderKey, new AnimalWander(group, {
                wanderRadius: cfg.wanderRadius,
                moveSpeed: cfg.moveSpeed,
                xMin: enc.centerX - enc.width / 2 + 0.5,
                xMax: enc.centerX + enc.width / 2 - 0.5,
                zMin: -10.5,
                zMax: -3.5,
            }, animPair))

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

    /** Returns a random position inside `enc` that is at least `minDist` units
     *  from the player. Falls back to the back-centre of the enclosure. */
    private safeItemSpawnPos(enc: EnclosureConfig, baseY: number, minDist = 4): Vector3 {
        const playerPos = this.player?.position ?? new Vector3(enc.centerX, 0, -8)
        const halfW = enc.width * 0.4
        for (let i = 0; i < 20; i++) {
            const x = enc.centerX + (Math.random() - 0.5) * 2 * halfW
            const z = -4 - Math.random() * 5   // Z ∈ [−4, −9], well inside enclosure
            const pos = new Vector3(x, baseY, z)
            if (Math.hypot(pos.x - playerPos.x, pos.z - playerPos.z) >= minDist) return pos
        }
        return new Vector3(enc.centerX, baseY, -8)
    }

    /** Move an item to `pos`, keeping positions map and bobbing baseline in sync. */
    private placeItem(type: string, pos: Vector3) {
        this.itemPositions.set(type, pos)
        this.itemBaseY.set(type, pos.y)
        const mesh = this.itemMeshes.get(type)
        if (mesh) mesh.position.copy(pos)
    }

    private async loadItems() {
        await Promise.all(this.ld.items.map(async cfg => {
            const enc = this.ld.enclosures.find(e => e.id === cfg.enclosureId)
            const x = enc ? enc.centerX : 0
            const pos = new Vector3(x, cfg.positionY, cfg.positionZ)
            this.itemPositions.set(cfg.type, pos)

            let mesh: Group | Mesh
            if (cfg.model) {
                const gltf = await this.assetLoader.loadGltf(cfg.model)
                if (gltf) {
                    const scene = gltf.scene.clone(true)
                    scene.scale.setScalar(cfg.scale)
                    mesh = scene
                } else {
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
        }))
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
        await Promise.all(this.ld.props.map(async prop => {
            const gltf = await this.assetLoader.loadGltf(prop.model)
            if (!gltf) return
            const clone = gltf.scene.clone(true)
            clone.position.set(prop.x, prop.y, prop.z)
            if (prop.rotY  !== undefined) clone.rotation.y = prop.rotY
            if (prop.scale !== undefined) clone.scale.setScalar(prop.scale)
            this.third.scene.add(clone)
        }))
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
                    this.phaseManager.currentId === phase.id &&
                    this.purchasedEnclosures.has(phase.enclosureId) &&
                    this.carrying(phase.requiredItem),
                bubbleLabel: phase.deliveryLabel,
                bubbleIcon:  phase.deliveryIcon,
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
                const bc = this.ld.bubbles
                c = createPurchaseBubble(this, cost, { w: bc.purchaseW, h: bc.purchaseH, r: bc.radius })
            } else {
                const bc = this.ld.bubbles
                c = createActionBubble(this, item.bubbleLabel, { iconKey: item.bubbleIcon, w: bc.actionW, h: bc.actionH, r: bc.radius })
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
        const phase = this.phaseManager.current
        if (!phase) return
        const enc    = this.ld.enclosures.find(e => e.id === phase.enclosureId)
        const groups = this.animalGroups.get(phase.animalId) ?? []
        const group  = groups[0]

        // Advance phase state BEFORE emitting so listeners that call
        // _activateTimerForCurrentPhase() already see the new phase.
        this.phaseManager.advance(phase.onComplete.nextPhase)

        this.events.emit('delivery:success', { phase, enc, groups, group } as DeliveryPayload)
    }

    /** Register all delivery:success listeners. Called once from create(). */
    private _setupDeliveryListeners() {
        // 1. Animal reaction sound
        this.events.on('delivery:success', ({ phase }: DeliveryPayload) => {
            this.sfx.playSfx(`sfx-${phase.animalId}`, { volume: AudioConfig.sfx.animal })
        }, this)

        // 2. Visual FX — success bounce + hearts burst
        this.events.on('delivery:success', ({ groups, group }: DeliveryPayload) => {
            for (const g of groups) this.successEffect(g)
            if (group) {
                const sp = this.project(new Vector3(group.position.x, group.position.y + 2, group.position.z))
                this.spawnHearts(sp.x, sp.y)
            }
        }, this)

        // 3. Star reward
        this.events.on('delivery:success', ({ phase, enc, group }: DeliveryPayload) => {
            if (!phase.onComplete.starsAwarded) return
            const gatePos = enc
                ? this.project(new Vector3(enc.centerX, 1.5, -3.5))
                : group
                    ? this.project(new Vector3(group.position.x, group.position.y + 2, group.position.z))
                    : { x: GAME_W / 2, y: GAME_H / 2 }
            this.flyStars(phase.onComplete.starsAwarded, gatePos.x, gatePos.y)
        }, this)

        // 4. Needs + prestige state updates
        this.events.on('delivery:success', ({ phase }: DeliveryPayload) => {
            this.animalNeeds.set(phase.animalId, 1.0)
            this.fedAnimals.add(phase.animalId)
            if (!phase.onComplete.showItemType && phase.onComplete.starsAwarded) {
                this.completedAnimals.add(phase.animalId)
                this.prestigeLevel++
                this._advancePrestige()
            }
        }, this)

        // 5. Phase transition — reveal items / start next timer / end game
        this.events.on('delivery:success', ({ phase }: DeliveryPayload) => {
            const { onComplete } = phase
            if (onComplete.showItemType) {
                const shownMesh = this.itemMeshes.get(onComplete.showItemType)
                if (shownMesh) {
                    const itemCfg = this.ld.items.find(i => i.type === onComplete.showItemType)
                    const enc = itemCfg && this.ld.enclosures.find(e => e.id === itemCfg.enclosureId)
                    if (enc && itemCfg) this.placeItem(onComplete.showItemType, this.safeItemSpawnPos(enc, itemCfg.positionY))
                    shownMesh.visible = true
                }
                this._activateTimerForCurrentPhase()
            } else if (onComplete.endGame) {
                this.needsDrainActive = false
                this.time.delayedCall(1800, () => this.showEndcard(), [], this)
            } else {
                this._activateTimerForCurrentPhase()
            }
        }, this)
    }

    /** Reset needs for the incoming phase's animal, unless it's still locked. */
    private _activateTimerForCurrentPhase() {
        const phaseCfg = this.phaseManager.current
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

    // ── STAR CURRENCY ─────────────────────────────────────────────────────

    private setupStarHud() {
        const { stars } = this.HUD
        const x = GAME_W - stars.marginRight, y = stars.y
        const btnBg = this.add.image(0, 0, 'ui-button').setDisplaySize(stars.w, stars.h).setOrigin(0.5)
        const iconSize = stars.h * 0.65
        const starLabel = this.add.image(stars.w * 0.22, 1, 'ui-star').setDisplaySize(iconSize, iconSize).setOrigin(0.5)
        this.starHudText = this.add.text(-stars.w * 0.13, 1, '0', {
            fontSize: `${Math.round(stars.h * 0.52)}px`, color: '#ffffff', fontFamily: FONT, fontStyle: 'bold',
            stroke: '#1a5c0a', strokeThickness: 4,
        }).setOrigin(0.5)
        this.starHud = this.add.container(x, y, [btnBg, starLabel, this.starHudText]).setDepth(28)
    }

    private flyStars(count: number, fromX: number, fromY: number) {
        const toX = GAME_W - this.HUD.stars.marginRight, toY = this.HUD.stars.y

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
                        // Coin ding per star — pitch rises slightly each hit
                        const rate = 0.9 + (i / Math.max(visual - 1, 1)) * 0.2
                        this.sfx.playSfx('sfx-coin', { volume: AudioConfig.sfx.coinStar, rate })                        
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
        const { logo, bar } = this.HUD
        const bX = logo.x + logo.w / 2 + bar.gap
        const bY = bar.y, bW = bar.w, bH = bar.h
        const barCenterY = bY + bH / 2

        this.prestigeBarGfx = this.add.graphics().setDepth(22)
        this._drawPrestigeBarFill()

        // Milestones: animal silhouettes sit ON the bar; star reward below
        const milestoneData = [
            {id: 'monkey',   ratio: 1 / 3, stars: 50,  icon: 'ui-monkey'},
            {id: 'elephant', ratio: 2 / 3, stars: 100, icon: 'ui-elephant'},
            {id: 'gift',     ratio: 1.0,   stars: 150, icon: 'ui-gift'},
        ]
        const iconSize  = Math.round(bH * 2)
        const starSize  = Math.round(bH * 1.5)
        const starOffY  = bH + Math.round(bH * 0.7)
        const labelOffY = bH + Math.round(bH * 2)
        this.prestigeMilestones = []
        for (const m of milestoneData) {
            const mx = bX + bW * m.ratio
            const portrait = this.add.image(mx, barCenterY - 4, m.icon)
                .setDisplaySize(iconSize, iconSize).setOrigin(0.5).setDepth(24).setTint(0x111111)
            const starIcon = this.add.image(mx, bY + starOffY, 'ui-star')
                .setDisplaySize(starSize, starSize).setOrigin(0.5).setDepth(24)
            this.add.text(mx, bY + labelOffY, String(m.stars), {
                fontSize: `${Math.max(9, Math.round(bH))}px`, color: '#ffffff', fontFamily: FONT, fontStyle: 'bold',
                stroke: '#000000', strokeThickness: 3,
            }).setOrigin(0.5).setDepth(24)

            this.prestigeMilestones.push({portrait, badge: starIcon, ratio: m.ratio})
        }
    }

    private _drawPrestigeBarFill() {
        if (!this.prestigeBarGfx) return
        const gfx = this.prestigeBarGfx
        gfx.clear()
        const { logo, bar } = this.HUD
        const bX = logo.x + logo.w / 2 + bar.gap
        const bY = bar.y, bW = bar.w, bH = bar.h

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
        return clampToScreenEdge(tx, ty, margin, GAME_W, GAME_H, this.ld.hud.topMargin)
    }

    private updateAnimalHud() {
        const RING_R = this.ld.hud.ringRadius
        const MARGIN = this.ld.hud.edgeMargin
        const phaseCfg = this.phaseManager.current

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
        // Guard first — prevents double-purchase from rapid taps
        if (this.purchasedEnclosures.has(encId)) return
        this.purchasedEnclosures.add(encId)
        this.sfx.playSfx('sfx-unlock', { volume: AudioConfig.sfx.unlock })

        const cost = enc.unlockCost ?? 0
        if (this.starCount < cost) {
            // Not enough stars — roll back the reservation and shake the HUD
            this.purchasedEnclosures.delete(encId)
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
        this.sfx.playSfx('sfx-coin', { volume: AudioConfig.sfx.coin })
        if (this.starHudText) this.starHudText.setText(String(this.starCount))

        const animalCfg = this.ld.animals.find(a => a.enclosureId === encId)
        const phaseCfg = this.phaseManager.current
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
            if (phaseCfg?.animalId === animalCfg.id) {
                this.animalNeeds.set(animalCfg.id, 1.0)
                this.needsDrainActive = true
            }

            // Reveal items for this enclosure's phases (skip startVisible:false — those are revealed mid-game)
            for (const phase of this.ld.phases) {
                if (phase.enclosureId !== encId) continue
                const itemCfg = this.ld.items.find(i => i.type === phase.requiredItem)
                const mesh = this.itemMeshes.get(phase.requiredItem)
                if (mesh && itemCfg?.startVisible !== false) {
                    const enc = itemCfg && this.ld.enclosures.find(e => e.id === itemCfg.enclosureId)
                    if (enc && itemCfg) this.placeItem(phase.requiredItem, this.safeItemSpawnPos(enc, itemCfg.positionY))
                    mesh.visible = true
                }
            }
        }
    }

    // ── CAMERA & INPUT ───────────────────────────────────────────────────

    private setupCamera() {
        const cam = this.third.camera as PerspectiveCamera
        cam.fov = 75
        cam.updateProjectionMatrix()
    }

    private setupJoystick() {
        this.time.delayedCall(100, () => {
            this.scale.updateBounds()
            const {x, bottom} = this.scale.canvasBounds
            const joystick: JoyStick = new (JoyStick as any)(document.body)
            const axis = joystick.add.axis({
                styles: {right: Math.round(x) + 40, bottom: Math.round(window.innerHeight - bottom) + 40, size: 130},
            })
            // The circle div is synchronously appended to body as its last child
            this.joystickEl = document.body.lastElementChild as HTMLElement
            axis.onMove((delta: any) => {
                this.moveData = {top: delta.top ?? 0, right: delta.right ?? 0}
            })
        }, [], this)
    }

    // ── UI ───────────────────────────────────────────────────────────────

    private createGameplayLogoHud() {
        const { logo, btn } = this.HUD
        this.add.image(logo.x, logo.y, 'ui-game-logo')
            .setDisplaySize(logo.w, logo.h).setOrigin(0.5).setDepth(25)

        const btnBg   = this.add.image(0, 0, 'ui-cta-button').setDisplaySize(btn.w, btn.h).setOrigin(0.5)
        const btnText = this.add.text(0, 0, 'PLAY NOW', {
            fontSize: btn.fontSize, color: '#ffffff', fontStyle: 'bold', fontFamily: FONT,
            stroke: '#1a6600', strokeThickness: 3,
        }).setOrigin(0.5)
        this.add.container(logo.x, logo.y + btn.offsetY, [btnBg, btnText])
            .setDepth(26).setSize(btn.w, btn.h).setInteractive()
            .on('pointerdown', () => {
                if (typeof (window as any).onCTATapped === 'function') {
                    (window as any).onCTATapped()
                } else {
                    window.open('https://play.google.com/store/apps/details?id=com.zookeeper.game', '_blank')
                }
            })
    }

    private setupUI() {
        this.createGameplayLogoHud()
        this.createPrestigeBar()
        this.createAnimalHudItems()
        this.setupStarHud()
        this.createPickupArrows()
    }

    // ── TUTORIAL ─────────────────────────────────────────────────────────

    private _showTutorial() {
        const tut = this.ld.tutorial
        if (!tut) return

        // Joystick sits at bottom-left; position hint just above and to the right of it
        const tx = 435, ty = GAME_H - 250

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
        const phaseCfg = this.phaseManager.current
        if (!phaseCfg) return
        if (this.carrying(phaseCfg.requiredItem)) return
        if (!this.purchasedEnclosures.has(phaseCfg.enclosureId)) return
        const mesh = this.itemMeshes.get(phaseCfg.requiredItem)
        if (!mesh?.visible) return
        const pos = this.itemPositions.get(phaseCfg.requiredItem)
        if (!pos) return
        const px = this.player!.position.x, pz = this.player!.position.z
        if (Math.hypot(px - pos.x, pz - pos.z) < this.ld.player.autoPickupRadius) {
            this.pickup(phaseCfg.requiredItem)
        }
    }

    private updatePickupArrows() {
        for (const phase of this.ld.phases) {
            const arrow = this.pickupArrows.get(phase.requiredItem)
            if (!arrow) continue
            const available =
                this.phaseManager.currentId === phase.id &&
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
        if (!this.player) return
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
                const idx = Math.floor(Math.random() * this.footstepSounds.length)
                this.footstepSound = this.footstepSounds[idx]
                this.footstepSound.play()
            }
        } else if (this.isMoving) {
            this.walkAction?.fadeOut(0.2);
            this.idleAction?.reset().fadeIn(0.2).play();
            this.isMoving = false
            this.footstepSound?.stop()
            this.footstepSound = null
        }
        this.player.position.x = Math.max(bounds.xMin, Math.min(bounds.xMax, this.player.position.x))
        this.player.position.z = Math.max(bounds.zMin, Math.min(bounds.zMax, this.player.position.z))
    }

    private updateCarryStack() {
        if (!this.player) return
        const playerPos = this.player.position
        const bob = (i: number) => Math.sin(this.elapsedTime * 3 + i) * 0.08
        this.carriedItems.forEach((item, i) => {
            item.mesh.position.set(
                playerPos.x,
                playerPos.y + 2 + i * 0.6 + bob(i),
                playerPos.z,
            )
        })
    }

    private updateCamera() {
        if (!this.player) return
        const {x, y, z} = this.player.position
        const { lerp, offsetX, offsetZ, positionY, lookAtY } = this.ld.camera
        this.third.camera.position.x = MathUtils.lerp(this.third.camera.position.x, x + offsetX, lerp)
        this.third.camera.position.y = positionY
        this.third.camera.position.z = MathUtils.lerp(this.third.camera.position.z, z + offsetZ, lerp)
        this.third.camera.lookAt(x + offsetX, y + lookAtY, z)
    }

    private project(worldPos: Vector3): { x: number; y: number } {
        return projectToScreen(worldPos, this.third.camera)
    }

    private _showBubble(item: Interactable) {
        const c = item.bubbleSprite!
        const existingWiggle = this.bubbleWiggles.get(item.id)
        if (existingWiggle) existingWiggle.stop()
        this.tweens.killTweensOf(c)
        c.setVisible(true).setScale(0).setAngle(0)
        this.sfx.playSfx('sfx-whoosh', { volume: AudioConfig.sfx.whoosh })
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
        if (!this.player) return
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
                    ? (px >= enc.centerX - enc.width / 2 && px <= enc.centerX + enc.width / 2 && pz < this.ld.world.enclosureEntryZ)
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
        if (!this.player) return
        if (!this.needsDrainActive || this.phaseManager.isDone) return

        const phaseCfg = this.phaseManager.current
        const px = this.player.position.x
        const pz = this.player.position.z
        const activeDrainRate = 1 / this.ld.world.timerDuration
        const idleRate = this.ld.needs.idleRate
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

        // Hide joystick while lose screen is shown
        if (this.joystickEl) this.joystickEl.style.display = 'none'

        // Dark overlay
        const overlay = this.add.rectangle(cx, GAME_H / 2, GAME_W, GAME_H, 0x000000, 0.65)
            .setDepth(D).setAlpha(0)

        // Panel card
        const panel = this.add.image(cx, panelY, 'ui-final-panel')
            .setDisplaySize(PANEL_W, PANEL_H).setOrigin(0.5).setDepth(D + 1).setAlpha(0)

        // Broken star — punches in above panel top
        const starY = panelY - PANEL_H / 2 + 10
        const brokenStar = this.add.image(cx, starY, 'ui-broken-star')
            .setDisplaySize(260, 260).setOrigin(0.5).setDepth(D + 3).setScale(0)

        // Title — red, punchy failure copy
        const title = this.add.text(cx, panelY-80, "YOU'RE FIRED!", {
            fontSize: '40px', color: '#e53935', fontStyle: 'bold', fontFamily: FONT,
            stroke: '#ffffff', strokeThickness: 4,
        }).setOrigin(0.5).setDepth(D + 2).setAlpha(0)

        // Subtitle — white, shame-inducing
        const subtitle = this.add.text(cx, panelY, "YOUR ANIMALS\nNEED YOU.", {
            fontSize: '24px', color: '#ffffff', fontStyle: 'bold', fontFamily: FONT,
            align: 'center', stroke: '#000000', strokeThickness: 4,
        }).setOrigin(0.5).setDepth(D + 2).setAlpha(0)

        // Try Again button
        const btnY = panelY + PANEL_H / 2 - 70
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
            if (this.joystickEl) this.joystickEl.style.display = ''
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
        const currentPhase = this.phaseManager.current
        if (currentPhase) {
            const idx = this.phaseManager.indexOf(currentPhase.id)
            const prevPhase = idx > 0 ? this.ld.phases[idx - 1] : null
            if (prevPhase?.animalId === currentPhase.animalId && prevPhase.onComplete.showItemType) {
                this.phaseManager.advance(prevPhase.id)
                const shownMesh = this.itemMeshes.get(prevPhase.onComplete.showItemType)
                if (shownMesh) shownMesh.visible = false
            }
        }

        // Ensure the current phase's item is visible
        const activePhaseCfg = this.phaseManager.current
        if (activePhaseCfg) {
            const itemCfg = this.ld.items.find(i => i.type === activePhaseCfg.requiredItem)
            const enc = itemCfg && this.ld.enclosures.find(e => e.id === itemCfg.enclosureId)
            const m = this.itemMeshes.get(activePhaseCfg.requiredItem)
            if (m) {
                if (enc && itemCfg) this.placeItem(activePhaseCfg.requiredItem, this.safeItemSpawnPos(enc, itemCfg.positionY))
                m.visible = true
            }
        }

        // Reset needs for current animal to full
        const resetPhase = this.phaseManager.current
        if (resetPhase) this.animalNeeds.set(resetPhase.animalId, 1.0)
        this.needsDrainActive = true
    }

    // ── ENDCARD ──────────────────────────────────────────────────────────

    private showEndcard() {
        const cx = GAME_W / 2

        // Fade out music and play win fanfare
        this.sfx.stopMusic(AudioConfig.timing.musicFadeOut)
        this.sfx.playSfx('sfx-win', { volume: AudioConfig.sfx.win })

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
            .on('pointerdown', () => {
                if (typeof (window as any).onCTATapped === 'function') {
                    (window as any).onCTATapped()
                } else {
                    window.open('https://play.google.com/store/apps/details?id=com.zookeeper.game', '_blank')
                }
            })

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

    // ── TEARDOWN ─────────────────────────────────────────────────────────

    shutdown() {
        // Remove joystick DOM element
        if (this.joystickEl) {
            this.joystickEl.remove()
            this.joystickEl = null
        }

        // Stop audio
        this.footstepSound?.stop()
        this.footstepSound = null
        this.sfx.destroy()

        // Stop all tweens
        this.tweens.killAll()

        // Clear AI instances
        this.animalWanders.clear()

        // Dispose Three.js geometry and materials
        this.third.scene.traverse((obj: any) => {
            if (obj.geometry) obj.geometry.dispose()
            if (Array.isArray(obj.material)) {
                obj.material.forEach((m: any) => m.dispose())
            } else if (obj.material) {
                obj.material.dispose()
            }
        })

        // Clear scene object references
        this.animalGroups.clear()
        this.animalOriginalMats.clear()
        this.itemMeshes.clear()
        this.itemPositions.clear()
        this.itemBaseY.clear()
        this.animalHudItems.clear()
        this.pickupArrows.clear()
        this.bubbleWiggles.clear()
        this.prevBubbleVisible.clear()
        this.animalNeeds.clear()
        this.animalWasOffscreen.clear()
        this.interactables = []
        this.carriedItems = []
    }
}
