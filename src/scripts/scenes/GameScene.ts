import {Scene3D, JoyStick} from '@enable3d/phaser-extension'
import {
    AnimationAction, Box3, Color, CylinderGeometry, Group, MathUtils,
    Mesh, MeshBasicMaterial, MeshLambertMaterial,
    PerspectiveCamera, PlaneGeometry, SphereGeometry, Vector3,
} from 'three'
import {AnimalWander} from '../zoo/AnimalWander'
import type {LevelData} from '../types/LevelData'

const GAME_W = 540
const GAME_H = 960

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
    private animalGroups = new Map<string, Group>()
    private animalOriginalMats = new Map<Mesh, any>()
    private animalMixers = new Map<string, { staticAction: AnimationAction; walkAction: AnimationAction }>()
    private itemMeshes = new Map<string, Group | Mesh>()
    private itemPositions = new Map<string, Vector3>()
    private itemBaseY = new Map<string, number>()

    // ── 2-D UI ────────────────────────────────────────────────────────────
    private timerBar: Phaser.GameObjects.Graphics | null = null
    private timerText: Phaser.GameObjects.Text | null = null
    private animalTimerLabel: Phaser.GameObjects.Text | null = null

    private timerValue = 20
    private timerActive = false
    private timerStarted = false

    private needIcons: Map<string, any> = new Map()
    private padlockIcons: Map<string, any> = new Map()

    // ── tutorial ──────────────────────────────────────────────────────────
    private tutorialContainer: Phaser.GameObjects.Container | null = null

    constructor() {
        super({key: 'GameScene'})
    }

    init() {
        this.accessThirdDimension({usePhysics: false, antialias: true})
    }

    preload() {
        this.load.json('level', 'assets/level.json')
        this.load.image('bubble', 'assets/circle.png')
    }

    // ── LIFECYCLE ────────────────────────────────────────────────────────

    async create() {
        this.ld = this.cache.json.get('level') as LevelData
        this.timerValue = this.ld.world.timerDuration

        // Phase-2 load: icon images declared in items[]
        for (const item of this.ld.items) {
            if (item.iconAsset && item.bubbleIcon && !this.textures.exists(item.bubbleIcon)) {
                this.load.image(item.bubbleIcon, item.iconAsset)
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
        this.setupInteractables()
        this.setupCamera()
        this.setupJoystick()
        this.setupUI()
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
        this.updateBubbles()
        this.updateNeedIcons()
        this.updateTimer(dt)
        this.updateTimerUI()

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
        const models = await Promise.all(configs.map(a => this.third.load.gltf(a.model)))

        models.forEach((gltf, i) => {
            const cfg = configs[i]
            const enc = this.ld.enclosures.find(e => e.id === cfg.enclosureId)!
            const group = gltf.scene

            group.position.set(enc.centerX, 0, cfg.spawnZ)
            if (cfg.startLocked) this.lockAnimal(group)
            this.third.scene.add(group)
            this.normalizeAnimalHeight(group, cfg.targetHeight)
            this.animalGroups.set(cfg.id, group)
            this.animalWanders.set(cfg.id, new AnimalWander(group, {
                wanderRadius: cfg.wanderRadius,
                moveSpeed: cfg.moveSpeed,
            }))

            // Wire up walk/static animations
            const mixer = this.third.animationMixers.create(group)
            const staticClip = gltf.animations.find((a: any) => a.name === 'static')
            const walkClip = gltf.animations.find((a: any) => a.name === 'walk')
            if (staticClip && walkClip) {
                const staticAction = mixer.clipAction(staticClip)
                const walkAction = mixer.clipAction(walkClip)
                staticAction.play()
                walkAction.setEffectiveWeight(0).play()
                this.animalMixers.set(cfg.id, {staticAction, walkAction})
            }
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
            const itemCfg = this.ld.items.find(i => i.type === phase.requiredItem)!

            // Pickup bubble
            this.interactables.push({
                id: `${phase.requiredItem}_pickup`,
                getWorldPos: () => this.itemPositions.get(phase.requiredItem) ?? new Vector3(),
                action: () => {
                    this._dismissTutorial();
                    this.pickup(phase.requiredItem)
                },
                isAvailable: () => this.phase === phase.id && !this.carrying(phase.requiredItem),
                bubbleLabel: itemCfg?.bubbleEmoji ?? '📦',
                bubbleIcon: itemCfg?.bubbleIcon ?? undefined,
            })

            // Delivery bubble
            this.interactables.push({
                id: `${phase.id}_deliver`,
                getWorldPos: () => {
                    const v = new Vector3()
                    this.animalGroups.get(phase.animalId)?.getWorldPosition(v)
                    return v
                },
                action: () => this.deliver(phase.requiredItem, phase.id),
                isAvailable: () => this.phase === phase.id && this.carrying(phase.requiredItem),
                bubbleLabel: phase.deliveryLabel,
            })
        }

        for (const item of this.interactables) {
            const size = 70
            const bg = this.add.image(0, 0, 'bubble').setDisplaySize(size, size)
            const iconEl: Phaser.GameObjects.Image | Phaser.GameObjects.Text =
                item.bubbleIcon && this.textures.exists(item.bubbleIcon)
                    ? this.add.image(0, 0, item.bubbleIcon).setDisplaySize(44, 44)
                    : this.add.text(0, 0, item.bubbleLabel, {fontSize: '30px'}).setOrigin(0.5)
            const c = this.add.container(0, 0, [bg, iconEl])
                .setVisible(false).setDepth(10).setSize(size, size).setInteractive()
            c.on('pointerdown', () => {
                if (c.visible) item.action()
            })
            item.bubbleSprite = c as Phaser.GameObjects.Container
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
        this.onDelivery(type, phaseId)
    }

    private onDelivery(type: string, phaseId: string) {
        const phase = this.ld.phases.find(p => p.id === phaseId && p.requiredItem === type)
        if (!phase) return
        const {onComplete} = phase

        this.timerActive = false
        this.timerStarted = false

        const group = this.animalGroups.get(phase.animalId)

        if (onComplete.unlockAnimalId) {
            if (group) this.successEffect(group)
            const needIcon = this.needIcons.get(phase.animalId)
            if (needIcon) {
                needIcon.destroy();
                this.needIcons.delete(phase.animalId)
            }

            this.time.delayedCall(900, () => {
                const target = this.animalGroups.get(onComplete.unlockAnimalId!)
                if (target) this.unlockAnimal(target)
                const padlock = this.padlockIcons.get(onComplete.unlockAnimalId!)
                if (padlock) {
                    padlock.destroy();
                    this.padlockIcons.delete(onComplete.unlockAnimalId!)
                }
                this.phase = onComplete.nextPhase
                this.timerStarted = false
                this.timerValue = this.ld.world.timerDuration
            }, [], this)

        } else if (onComplete.showItemType) {
            // Intermediate step (e.g. lion_toy → reveal food)
            const shownMesh = this.itemMeshes.get(onComplete.showItemType)
            if (shownMesh) shownMesh.visible = true
            this.phase = onComplete.nextPhase
            this.timerStarted = false
            this.timerValue = this.ld.world.timerDuration

        } else if (onComplete.endGame) {
            if (group) this.successEffect(group)
            const needIcon = this.needIcons.get(phase.animalId)
            if (needIcon) {
                needIcon.destroy();
                this.needIcons.delete(phase.animalId)
            }
            this.phase = onComplete.nextPhase
            this.time.delayedCall(1500, () => this.showEndcard(), [], this)

        } else {
            this.phase = onComplete.nextPhase
            this.timerStarted = false
            this.timerValue = this.ld.world.timerDuration
        }
    }

    private successEffect(group: Group) {
        const base = group.scale.x
        this.tweens.add({
            targets: group.scale, x: base * 1.4, y: base * 1.4, z: base * 1.4,
            duration: 140, yoyo: true, repeat: 3, ease: 'Sine.easeInOut',
        })
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
            axis.onMove((delta: any) => {
                this.moveData = {top: delta.top ?? 0, right: delta.right ?? 0}
            })
        }, [], this)
    }

    // ── UI ───────────────────────────────────────────────────────────────

    private setupUI() {
        this.timerBar = this.add.graphics().setDepth(19)

        this.animalTimerLabel = this.add.text(
            (GAME_W - 320) / 2 - 32, 22, '',
            {fontSize: '24px'}
        ).setOrigin(0.5, 0.5).setDepth(20)

        this.timerText = this.add.text(GAME_W / 2 + 10, 20, '', {
            fontSize: '18px', color: '#fff', fontStyle: 'bold', stroke: '#000', strokeThickness: 3,
        }).setOrigin(0.5).setDepth(20)

        const mkNeedIcon = (iconKey: string | null, fallback: string) => {
            const shadow = this.add.ellipse(2, 5, 50, 18, 0x000000, 0.22)
            const circle = this.add.graphics().fillStyle(0xffffff, 1).fillCircle(0, 0, 27)
            const content = iconKey && this.textures.exists(iconKey)
                ? this.add.image(0, -1, iconKey).setDisplaySize(34, 34).setOrigin(0.5) as any
                : this.add.text(0, -3, fallback, {fontSize: '26px'}).setOrigin(0.5) as any
            const ctr = this.add.container(0, 0, [shadow, circle, content]).setDepth(15)
            this.tweens.add({
                targets: ctr,
                scaleX: 1.12,
                scaleY: 1.12,
                duration: 700,
                yoyo: true,
                repeat: -1,
                ease: 'Sine.easeInOut'
            })
            return ctr
        }

        // One need icon per animal — use the last phase for that animal (final item needed)
        for (const animal of this.ld.animals) {
            const lastPhase = this.ld.phases.filter(p => p.animalId === animal.id).pop()
            if (!lastPhase) continue
            const itemCfg = this.ld.items.find(i => i.type === lastPhase.requiredItem)
            this.needIcons.set(animal.id, mkNeedIcon(
                itemCfg?.bubbleIcon ?? null,
                lastPhase.deliveryLabel
            ))
        }

        // Padlock icons for initially-locked animals
        for (const animal of this.ld.animals) {
            if (animal.startLocked) {
                this.padlockIcons.set(
                    animal.id,
                    this.add.text(0, 0, '��', {fontSize: '34px'}).setOrigin(0.5).setDepth(16)
                )
            }
        }
    }

    // ── TUTORIAL ─────────────────────────────────────────────────────────

    private _showTutorial() {
        const tut = this.ld.tutorial
        const steps = tut.steps
        if (!steps?.length) return

        const cx = GAME_W / 2, cy = 210
        const bg = this.add.rectangle(cx, cy, 300, 108, 0x000000, 0.82).setDepth(30)
        const handText = this.add.text(cx - 90, cy, '👆', {fontSize: '48px'}).setOrigin(0.5).setDepth(31)
        const verbText = this.add.text(cx + 55, cy - 22, '', {
            fontSize: '26px',
            color: '#ffffff',
            fontStyle: 'bold'
        }).setOrigin(0.5).setDepth(31)
        const descText = this.add.text(cx + 55, cy + 20, '', {
            fontSize: '15px',
            color: '#ffdd77'
        }).setOrigin(0.5).setDepth(31)
        this.tutorialContainer = this.add.container(0, 0, [bg, handText, verbText, descText]).setDepth(30)

        const origX = cx - 90
        const showStep = (idx: number) => {
            if (!this.tutorialContainer?.active) return
            const step = steps[idx]
            this.tweens.killTweensOf(handText)
            handText.setPosition(origX, cy).setScale(1, 1)
                .setText(step.gesture === 'tap' ? '👆' : '✋')
            verbText.setText(step.verb)
            descText.setText(step.desc)
            if (step.gesture === 'tap') {
                this.tweens.add({
                    targets: handText,
                    scaleY: 0.6,
                    duration: 130,
                    yoyo: true,
                    repeat: -1,
                    repeatDelay: 800,
                    ease: 'Quad.easeIn'
                })
            } else {
                this.tweens.add({
                    targets: handText,
                    x: origX + 55,
                    duration: 400,
                    yoyo: true,
                    repeat: -1,
                    ease: 'Sine.easeInOut'
                })
            }
        }

        showStep(0)
        const perStep = Math.round(tut.autoDismissMs / steps.length)
        for (let i = 1; i < steps.length; i++) {
            this.time.delayedCall(perStep * i, () => showStep(i), [], this)
        }
        this.time.delayedCall(tut.autoDismissMs, () => this._dismissTutorial(), [], this)
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

    // ── UPDATE HELPERS ───────────────────────────────────────────────────

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

    private updateBubbles() {
        const px = this.player.position.x, pz = this.player.position.z
        const range = this.ld.world.interactRange
        for (const item of this.interactables) {
            if (!item.bubbleSprite) continue
            const available = item.isAvailable()
            const wp = item.getWorldPos()
            const inRange = Math.hypot(px - wp.x, pz - wp.z) < range
            const show = available && inRange
            item.bubbleSprite.setVisible(show)
            if (show) {
                const {x, y} = this.project(new Vector3(wp.x, wp.y + 2, wp.z))
                item.bubbleSprite.setPosition(x, y)
            }
        }
    }

    private updateNeedIcons() {
        const t = Math.sin(this.elapsedTime * 2.5) * 6
        for (const [animalId, icon] of this.needIcons) {
            const group = this.animalGroups.get(animalId)
            if (!icon || !group) continue
            const p = new Vector3();
            group.getWorldPosition(p)
            const s = this.project(new Vector3(p.x, p.y + 3, p.z))
            icon.setPosition(s.x, s.y + t)
        }
        for (const [animalId, icon] of this.padlockIcons) {
            const group = this.animalGroups.get(animalId)
            if (!icon || !group) continue
            const p = new Vector3();
            group.getWorldPosition(p)
            const s = this.project(new Vector3(p.x, p.y + 4.5, p.z))
            icon.setPosition(s.x, s.y)
        }
    }

    // ── PER-ANIMAL ZONE-BASED TIMER ──────────────────────────────────────

    private _playerInEnclosure(): boolean {
        const {x, z} = this.player.position
        if (z > this.ld.world.enclosureEntryZ) return false
        const phaseCfg = this.ld.phases.find(p => p.id === this.phase)
        if (!phaseCfg) return false
        const enc = this.ld.enclosures.find(e => e.id === phaseCfg.enclosureId)
        if (!enc) return false
        return x > enc.zoneXMin && x < enc.zoneXMax
    }

    private _currentAnimalEmoji(): string {
        if (this.phase === 'done') return '✅'
        const phaseCfg = this.ld.phases.find(p => p.id === this.phase)
        if (!phaseCfg) return ''
        return this.ld.animals.find(a => a.id === phaseCfg.animalId)?.emoji ?? ''
    }

    private updateTimer(dt: number) {
        if (this.phase === 'done') return
        const inZone = this._playerInEnclosure()

        if (inZone && !this.timerStarted) {
            this.timerStarted = true
            this.timerActive = true
            this.timerValue = this.ld.world.timerDuration
        }

        if (!this.timerActive || !inZone) return

        this.timerValue -= dt
        if (this.timerValue <= 0) {
            this.timerActive = false
            this.timerStarted = false
            this.onTimerExpired()
        }
    }

    private updateTimerUI() {
        if (!this.timerBar || !this.timerText || !this.animalTimerLabel) return
        this.timerBar.clear()

        this.animalTimerLabel.setText(this._currentAnimalEmoji())

        if (this.phase === 'done') {
            this.timerText.setText('All safe! ✅');
            return
        }

        const inZone = this._playerInEnclosure()
        const duration = this.ld.world.timerDuration
        const ratio = this.timerActive ? Math.max(0, this.timerValue / duration) : 1

        const bW = 320, bH = 20
        const bX = (GAME_W - bW) / 2 + 20
        const bY = 12

        this.timerBar.fillStyle(0x222222, 0.8)
        this.timerBar.fillRoundedRect(bX - 2, bY - 2, bW + 4, bH + 4, 6)

        const barColor = !this.timerActive ? 0x555555 : ratio > 0.4 ? 0x4caf50 : 0xf44336
        this.timerBar.fillStyle(barColor, this.timerActive ? 1 : 0.45)
        this.timerBar.fillRoundedRect(bX, bY, bW * ratio, bH, 5)

        if (!this.timerActive) {
            this.timerText.setText(inZone ? 'Starting…' : 'Enter enclosure →')
        } else {
            this.timerText.setText(`${Math.ceil(this.timerValue)}s`)
        }
    }

    // ── FAIL FLOW ────────────────────────────────────────────────────────

    private onTimerExpired() {
        this.cameras.main.shake(400, 0.015)
        const bg = this.add.rectangle(GAME_W / 2, GAME_H / 2, 340, 210, 0x111111, 0.92).setDepth(200)
        const msg = this.add.text(GAME_W / 2, GAME_H / 2 - 45, "⏰ Time's up!\nOh no — try again?", {
            fontSize: '28px', color: '#fff', fontStyle: 'bold', align: 'center',
        }).setOrigin(0.5).setDepth(201)
        const btn = this.add.text(GAME_W / 2, GAME_H / 2 + 60, '  Retry  ', {
            fontSize: '26px', color: '#fff', backgroundColor: '#e53935', padding: {x: 24, y: 12},
        }).setOrigin(0.5).setDepth(202).setInteractive()
        btn.on('pointerdown', () => {
            bg.destroy();
            msg.destroy();
            btn.destroy();
            this.retryCurrentAnimal()
        })
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

        this.timerActive = false
        this.timerStarted = false
        this.timerValue = this.ld.world.timerDuration
    }

    // ── ENDCARD ──────────────────────────────────────────────────────────

    private showEndcard() {
        const overlay = this.add.rectangle(0, 0, GAME_W, GAME_H, 0x000000, 0.75).setOrigin(0).setDepth(100)
        const title = this.add.text(GAME_W / 2, GAME_H / 2 - 150, '🦁 Zoo Keeper 🐘', {
            fontSize: '42px', color: '#fff', fontStyle: 'bold',
        }).setOrigin(0.5).setDepth(101)
        const sub = this.add.text(GAME_W / 2, GAME_H / 2 - 70, 'Your animals need you!', {
            fontSize: '26px', color: '#ffeb3b',
        }).setOrigin(0.5).setDepth(101)
        const btnBg = this.add.rectangle(GAME_W / 2, GAME_H / 2 + 80, 290, 72, 0x43a047).setDepth(101)
        const btnText = this.add.text(GAME_W / 2, GAME_H / 2 + 80, '🎮  Download Free', {
            fontSize: '26px', color: '#fff', fontStyle: 'bold',
        }).setOrigin(0.5).setDepth(102)

        this.tweens.add({
            targets: [btnBg, btnText], scaleX: 1.1, scaleY: 1.1,
            duration: 600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
        })

        const ui = [title, sub, btnBg, btnText]
        ui.forEach(o => {
            o.y += GAME_H
        })
        this.tweens.add({targets: ui, y: `-=${GAME_H}`, duration: 700, ease: 'Back.easeOut'})

        btnBg.setInteractive().on('pointerdown', () => console.log('CTA → store redirect'))
        overlay
    }
}
