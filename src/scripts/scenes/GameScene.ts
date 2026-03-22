import { Scene3D, JoyStick } from '@enable3d/phaser-extension'
import {
  AnimationAction, Box3, Color, CylinderGeometry, Group, MathUtils,
  Mesh, MeshBasicMaterial, MeshLambertMaterial,
  PerspectiveCamera, PlaneGeometry, SphereGeometry, Vector3,
} from 'three'
import { AnimalWander } from '../zoo/AnimalWander'

const GAME_W = 540
const GAME_H = 960
const SPEED = 5
const INTERACT_RANGE = 3.5
const TIMER_DURATION = 20

type ItemType = 'banana' | 'water' | 'toy' | 'food'
type GamePhase = 'monkey' | 'elephant' | 'lion_toy' | 'lion_food' | 'done'

interface Interactable {
  id: string
  getWorldPos: () => Vector3
  action: () => void
  isAvailable: () => boolean
  bubbleLabel: string          // emoji fallback
  bubbleIcon?: string          // Phaser texture key for a PNG icon (preferred over emoji)
  bubbleSprite?: Phaser.GameObjects.Container
}

interface CarriedItem {
  type: ItemType
  mesh: Group | Mesh
}

export default class GameScene extends Scene3D {
  // ── movement ────────────────────────────────────────────────────────────────
  private moveData = { top: 0, right: 0 }
  private player: any = null
  private mixer: any = null
  private idleAction: AnimationAction | null = null
  private walkAction: AnimationAction | null = null
  private isMoving = false
  private elapsedTime = 0

  // ── game state ───────────────────────────────────────────────────────────────
  private phase: GamePhase = 'monkey'
  private carriedItems: CarriedItem[] = []
  private interactables: Interactable[] = []
  private animalWanders: AnimalWander[] = []

  // ── 3-D objects ───────────────────────────────────────────────────────────────
  private monkeyGroup: Group | null = null
  private elephantGroup: Group | null = null
  private lionGroup: Group | null = null
  private animalOriginalMats = new Map<Mesh, any>()
  private itemMeshes = new Map<ItemType, Group | Mesh>()

  // Fixed world positions for each pickup item — items sit on the path (Z=−1)
  //   in front of their respective enclosures
  private readonly itemPos: Record<ItemType, Vector3> = {
    banana: new Vector3(-8,  0.5, -1.5),
    water:  new Vector3( 0,  0.5, -1.5),
    toy:    new Vector3( 8,  0.5, -1.5),
    food:   new Vector3(13,  0.5, -4),    // inside lion enclosure, revealed in phase 2
  }

  // ── 2-D UI ───────────────────────────────────────────────────────────────────
  private timerBar: Phaser.GameObjects.Graphics | null = null
  private timerText: Phaser.GameObjects.Text | null = null
  private timerValue = TIMER_DURATION
  private timerActive = false

  private needIcons: Partial<Record<'monkey' | 'elephant' | 'lion', any>> = {}
  private padlockIcons: Partial<Record<'elephant' | 'lion', Phaser.GameObjects.Text>> = {}

  constructor() { super({ key: 'GameScene' }) }

  init() { this.accessThirdDimension({ usePhysics: false, antialias: true }) }

  preload() {
    this.load.image('bubble',      'assets/circle.png')
    // Food item icons — PNG previews from kenney_food-kit/Previews
    this.load.image('icon-banana', 'assets/food/icons/banana.png')
    this.load.image('icon-barrel', 'assets/food/icons/barrel.png')
    this.load.image('icon-turkey', 'assets/food/icons/turkey.png')
  }

  // ── LIFECYCLE ────────────────────────────────────────────────────────────────

  async create() {
    await this.third.warpSpeed('-ground', '-grid', '-orbitControls', '-fog', '-sky')
    this.third.scene.background = new Color(0x87ceeb)

    this.buildEnvironment()
    await this.loadFences()
    await this.loadPlayer()
    await this.loadAnimals()
    await this.loadItems()
    this.setupInteractables()
    this.setupCamera()
    this.setupJoystick()
    this.setupUI()

    // Start the monkey timer after a short orientation delay
    this.time.delayedCall(1500, () => {
      if (this.phase === 'monkey') { this.timerValue = TIMER_DURATION; this.timerActive = true }
    }, [], this)
  }

  update(_time: number, delta: number) {
    if (!this.player) return
    const dt = delta / 1000
    this.elapsedTime += dt

    this.handleMovement(dt)
    this.updateCarryStack()
    this.updateCamera()
    this.updateBubbles()
    this.updateNeedIcons()
    this.updateTimer(dt)
    this.updateTimerUI()

    for (const w of this.animalWanders) w.update(dt)
  }

  // ── ENVIRONMENT ─────────────────────────────────────────────────────────────

  private buildEnvironment() {
    // Grass
    const ground = new Mesh(new PlaneGeometry(80, 50), new MeshLambertMaterial({ color: 0x5a9e3a }))
    ground.rotation.x = -Math.PI / 2
    ground.receiveShadow = true
    this.third.scene.add(ground)

    // Dirt path — narrower strip (6 units wide) centred at Z=0
    const path = new Mesh(new PlaneGeometry(80, 6), new MeshLambertMaterial({ color: 0xc8a46e }))
    path.rotation.x = -Math.PI / 2
    path.position.set(0, 0.01, 0)
    this.third.scene.add(path)

    // Sandy enclosure floors — 8×8, centred at Z=−7 (between z=−3 and z=−11)
    const sandMat = new MeshLambertMaterial({ color: 0xe8d5a0 })
    for (const ex of [-9, 0, 11]) {
      const floor = new Mesh(new PlaneGeometry(8, 8), sandMat.clone())
      floor.rotation.x = -Math.PI / 2
      floor.position.set(ex, 0.01, -7)
      this.third.scene.add(floor)
    }
  }

  private async loadFences() {
    try {
      const gltf = await this.third.load.gltf('assets/graveyard/iron-fence-border.glb')
      const template = gltf.scene

      // ── FENCE TUNING ─────────────────────────────────────────────────────────
      // Adjust these constants to visually fit fence panels around the enclosures.
      // GLB panel is 1 unit wide (X: −0.5 → +0.5) so SEG_W=1 tiles with no gaps.
      const SEG_W    = 1     // panel width — matches the GLB's X extent exactly
      const HALF_W   = 4     // half-width of each enclosure (total width = HALF_W * 2)
      const Z_FRONT  = -3    // south fence line (flush with path north edge)
      const Z_BACK   = -11   // north fence line
      const FENCE_Y  = 0     // raise/lower all panels (0 = ground level)
      // ─────────────────────────────────────────────────────────────────────────

      const countW = (HALF_W * 2) / SEG_W           // panels across south/north rows
      const countD = Math.abs(Z_BACK - Z_FRONT) / SEG_W  // panels on east/west columns

      for (const ex of [-9, 0, 11]) {
        // South row
        for (let i = 0; i < countW; i++) {
          const s = template.clone(true)
          s.position.set(ex - HALF_W + SEG_W * 0.5 + i * SEG_W, FENCE_Y, Z_FRONT)
          this.third.scene.add(s)
        }
        // North row
        for (let i = 0; i < countW; i++) {
          const s = template.clone(true)
          s.position.set(ex - HALF_W + SEG_W * 0.5 + i * SEG_W, FENCE_Y, Z_BACK)
          this.third.scene.add(s)
        }
        // West column (faces east — rotation +π/2)
        for (let i = 0; i < countD; i++) {
          const l = template.clone(true)
          l.position.set(ex - HALF_W, FENCE_Y, Z_FRONT - SEG_W * 0.5 - i * SEG_W)
          l.rotation.y = Math.PI / 2
          this.third.scene.add(l)
        }
        // East column (faces west — rotation −π/2 so panels face inward)
        for (let i = 0; i < countD; i++) {
          const r = template.clone(true)
          r.position.set(ex + HALF_W, FENCE_Y, Z_FRONT - SEG_W * 0.5 - i * SEG_W)
          r.rotation.y = -Math.PI / 2
          this.third.scene.add(r)
        }
      }
    } catch { console.warn('iron-fence-border.glb not available') }
  }

  // ── CHARACTER ────────────────────────────────────────────────────────────────

  private async loadPlayer() {
    const gltf = await this.third.load.gltf('assets/character-male-e.glb')
    this.player = gltf.scene
    this.player.scale.setScalar(1.5)
    this.player.position.set(-12, 0, 0)   // start closer to first enclosure
    this.player.traverse((c: any) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true } })
    this.third.scene.add(this.player)

    this.mixer = this.third.animationMixers.create(this.player)
    const idleClip = gltf.animations.find((a: any) => a.name === 'idle')
    const walkClip = gltf.animations.find((a: any) => a.name === 'walk')
    if (idleClip) { this.idleAction = this.mixer.clipAction(idleClip); this.idleAction!.play() }
    if (walkClip) { this.walkAction = this.mixer.clipAction(walkClip) }
  }

  // ── ANIMALS ──────────────────────────────────────────────────────────────────

  private async loadAnimals() {
    const [mg, eg, lg] = await Promise.all([
      this.third.load.gltf('assets/pets/animal-monkey.glb'),
      this.third.load.gltf('assets/pets/animal-elephant.glb'),
      this.third.load.gltf('assets/pets/animal-lion.glb'),
    ])

    const place = (group: Group, x: number, locked: boolean, targetHeight: number) => {
      group.position.set(x, 0, -7)    // enclosure centre Z=−7
      if (locked) this.lockAnimal(group)
      this.third.scene.add(group)
      this.normalizeAnimalHeight(group, targetHeight)
      this.animalWanders.push(new AnimalWander(group, { wanderRadius: 2, moveSpeed: 1.2 }))
    }

    this.monkeyGroup   = mg.scene; place(this.monkeyGroup,    -9, false, 0.7)
    this.elephantGroup = eg.scene; place(this.elephantGroup,   0, true,  1.7)
    this.lionGroup     = lg.scene; place(this.lionGroup,      11, true,  1.0)
  }

  /** Normalize a GLB group so its tallest axis (Y) equals targetHeight, feet at Y=0. */
  private normalizeAnimalHeight(group: Group, targetHeight: number) {
    group.scale.setScalar(1)
    group.updateMatrixWorld(true)
    const box = new Box3().setFromObject(group)
    const naturalHeight = box.max.y - box.min.y
    if (naturalHeight > 0) {
      const s = targetHeight / naturalHeight
      group.scale.setScalar(s)
      group.updateMatrixWorld(true)
      const box2 = new Box3().setFromObject(group)
      group.position.y = -box2.min.y   // lift so feet touch ground
    }
  }

  private lockAnimal(group: Group) {
    const dark = new MeshBasicMaterial({ color: 0x1a1a2e })
    group.traverse((c: any) => {
      if (c.isMesh) { this.animalOriginalMats.set(c, c.material); c.material = dark }
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

  // ── ITEM VISUALS ─────────────────────────────────────────────────────────────

  private async loadItems() {
    const loadGLB = async (path: string, scale: number, fallbackMesh: () => Mesh): Promise<Group | Mesh> => {
      try {
        const g = await this.third.load.gltf(path)
        g.scene.scale.setScalar(scale)
        return g.scene
      } catch { return fallbackMesh() }
    }

    // Banana (banana.glb — natural H≈0.20, scale 2 → ~0.40 tall)
    const banana = await loadGLB('assets/food/banana.glb', 2,
      () => new Mesh(new SphereGeometry(0.5, 8, 8), new MeshLambertMaterial({ color: 0xffe135 })))
    banana.position.copy(this.itemPos.banana)
    this.third.scene.add(banana)
    this.itemMeshes.set('banana', banana)

    // Water barrel (barrel.glb — natural H≈0.68, scale 0.65 → ~0.44 tall)
    const water = await loadGLB('assets/food/barrel.glb', 0.65,
      () => new Mesh(new CylinderGeometry(0.4, 0.4, 0.7, 8), new MeshLambertMaterial({ color: 0x4fc3f7 })))
    water.position.copy(this.itemPos.water)
    this.third.scene.add(water)
    this.itemMeshes.set('water', water)

    // Toy ball — no food-kit match, keep geometry
    const toy = new Mesh(new SphereGeometry(0.45, 8, 8), new MeshLambertMaterial({ color: 0xff8a65 }))
    toy.position.copy(this.itemPos.toy)
    this.third.scene.add(toy)
    this.itemMeshes.set('toy', toy)

    // Turkey leg (turkey.glb — natural H≈0.29, scale 1.6 → ~0.46 tall)
    const food = await loadGLB('assets/food/turkey.glb', 1.6,
      () => new Mesh(new CylinderGeometry(0.4, 0.35, 0.55, 8), new MeshLambertMaterial({ color: 0x8d6e63 })))
    food.position.copy(this.itemPos.food)
    food.visible = false   // revealed when lion is distracted with toy
    this.third.scene.add(food)
    this.itemMeshes.set('food', food)
  }

  // ── INTERACTION SYSTEM ───────────────────────────────────────────────────────

  private setupInteractables() {
    const wp  = (t: ItemType)   => () => this.itemPos[t]
    const gp  = (g: () => Group | null) => () => {
      const v = new Vector3(); g()?.getWorldPosition(v); return v
    }

    this.interactables = [
      // ── Monkey challenge ───────────────────────────────────────────────────
      { id: 'banana_pickup', getWorldPos: wp('banana'),
        action: () => this.pickup('banana'),
        isAvailable: () => this.phase === 'monkey' && !this.carrying('banana'),
        bubbleLabel: '🍌', bubbleIcon: 'icon-banana' },
      { id: 'monkey_deliver', getWorldPos: gp(() => this.monkeyGroup),
        action: () => this.deliver('banana', 'monkey'),
        isAvailable: () => this.phase === 'monkey' && this.carrying('banana'),
        bubbleLabel: '🎁' },

      // ── Elephant challenge ─────────────────────────────────────────────────
      { id: 'water_pickup', getWorldPos: wp('water'),
        action: () => this.pickup('water'),
        isAvailable: () => this.phase === 'elephant' && !this.carrying('water'),
        bubbleLabel: '🛢️', bubbleIcon: 'icon-barrel' },
      { id: 'elephant_deliver', getWorldPos: gp(() => this.elephantGroup),
        action: () => this.deliver('water', 'elephant'),
        isAvailable: () => this.phase === 'elephant' && this.carrying('water'),
        bubbleLabel: '🎁' },

      // ── Lion challenge (two-step) ──────────────────────────────────────────
      { id: 'toy_pickup', getWorldPos: wp('toy'),
        action: () => this.pickup('toy'),
        isAvailable: () => this.phase === 'lion_toy' && !this.carrying('toy'),
        bubbleLabel: '🎾' },    // no food-kit match → emoji fallback
      { id: 'lion_toy_deliver', getWorldPos: gp(() => this.lionGroup),
        action: () => this.deliver('toy', 'lion'),
        isAvailable: () => this.phase === 'lion_toy' && this.carrying('toy'),
        bubbleLabel: '🎁' },
      { id: 'food_pickup', getWorldPos: wp('food'),
        action: () => this.pickup('food'),
        isAvailable: () => this.phase === 'lion_food' && !this.carrying('food'),
        bubbleLabel: '🍗', bubbleIcon: 'icon-turkey' },
      { id: 'lion_food_deliver', getWorldPos: gp(() => this.lionGroup),
        action: () => this.deliver('food', 'lion'),
        isAvailable: () => this.phase === 'lion_food' && this.carrying('food'),
        bubbleLabel: '🎁' },
    ]

    // Attach a Phaser Container bubble to each interactable
    for (const item of this.interactables) {
      const size = 70
      const bg = this.add.image(0, 0, 'bubble').setDisplaySize(size, size)
      // Use PNG icon if available, fall back to emoji text
      const iconEl: Phaser.GameObjects.Image | Phaser.GameObjects.Text = item.bubbleIcon
        ? this.add.image(0, 0, item.bubbleIcon).setDisplaySize(44, 44)
        : this.add.text(0, 0, item.bubbleLabel, { fontSize: '30px' }).setOrigin(0.5)
      const c = this.add.container(0, 0, [bg, iconEl])
        .setVisible(false).setDepth(10).setSize(size, size).setInteractive()
      c.on('pointerdown', () => { if (c.visible) item.action() })
      item.bubbleSprite = c as Phaser.GameObjects.Container
    }
  }

  private carrying(t: ItemType) { return this.carriedItems.some(i => i.type === t) }

  private pickup(type: ItemType) {
    if (this.carriedItems.length >= 2) return
    const original = this.itemMeshes.get(type)
    let carryObj: Group | Mesh
    if (original instanceof Group) {
      carryObj = original.clone(true)
    } else if (original) {
      carryObj = (original as Mesh).clone()
    } else {
      // fallback: colored sphere
      const colors: Record<ItemType, number> = { banana: 0xffe135, water: 0x4fc3f7, toy: 0xff8a65, food: 0x8d6e63 }
      carryObj = new Mesh(new SphereGeometry(0.25, 8, 8), new MeshLambertMaterial({ color: colors[type] }))
    }
    this.third.scene.add(carryObj)
    this.normalizeAnimalHeight(carryObj, 0.35)  // uniform carry size
    carryObj.position.y = 0                     // reset Y; updateCarryStack drives it each frame
    this.carriedItems.push({ type, mesh: carryObj })
    if (original) original.visible = false
  }

  private deliver(type: ItemType, animal: string) {
    const idx = this.carriedItems.findIndex(i => i.type === type)
    if (idx === -1) return
    const [item] = this.carriedItems.splice(idx, 1)
    this.third.scene.remove(item.mesh)
    this.onDelivery(type, animal)
  }

  private onDelivery(type: ItemType, animal: string) {
    if (type === 'banana' && animal === 'monkey') {
      this.successEffect(this.monkeyGroup!)
      this.timerActive = false
      this.needIcons.monkey?.destroy(); delete this.needIcons.monkey
      this.time.delayedCall(900, () => {
        this.unlockAnimal(this.elephantGroup!)
        this.padlockIcons.elephant?.destroy(); delete this.padlockIcons.elephant
        this.phase = 'elephant'
        this.timerValue = TIMER_DURATION; this.timerActive = true
      }, [], this)

    } else if (type === 'water' && animal === 'elephant') {
      this.successEffect(this.elephantGroup!)
      this.timerActive = false
      this.needIcons.elephant?.destroy(); delete this.needIcons.elephant
      this.time.delayedCall(900, () => {
        this.unlockAnimal(this.lionGroup!)
        this.padlockIcons.lion?.destroy(); delete this.padlockIcons.lion
        this.phase = 'lion_toy'
        this.timerValue = TIMER_DURATION; this.timerActive = true
      }, [], this)

    } else if (type === 'toy' && animal === 'lion') {
      // Lion distracted — reveal the food pot for step 2
      this.phase = 'lion_food'
      const f = this.itemMeshes.get('food'); if (f) f.visible = true

    } else if (type === 'food' && animal === 'lion') {
      this.successEffect(this.lionGroup!)
      this.timerActive = false
      this.needIcons.lion?.destroy(); delete this.needIcons.lion
      this.phase = 'done'
      this.time.delayedCall(1500, () => this.showEndcard(), [], this)
    }
  }

  private successEffect(group: Group) {
    const base = group.scale.x   // uses the normalized scale set by normalizeAnimalHeight
    this.tweens.add({
      targets: group.scale, x: base * 1.4, y: base * 1.4, z: base * 1.4,
      duration: 140, yoyo: true, repeat: 3, ease: 'Sine.easeInOut',
    })
  }

  // ── CAMERA & INPUT ───────────────────────────────────────────────────────────

  private setupCamera() {
    const cam = this.third.camera as PerspectiveCamera
    // Portrait canvas is 9:16 — horizontal FOV = vertical × 0.5625.
    // FOV 75° → ~42° horizontal, enough to see the enclosures.
    cam.fov = 75
    cam.updateProjectionMatrix()
    this.third.camera.position.set(-8, 5, 12)
    this.third.camera.lookAt(-12, 0, 0)
  }

  private setupJoystick() {
    this.time.delayedCall(100, () => {
      this.scale.updateBounds()
      const { x, bottom } = this.scale.canvasBounds
      const joystick: JoyStick = new (JoyStick as any)(document.body)
      const axis = joystick.add.axis({
        styles: { left: Math.round(x) + 40, bottom: Math.round(window.innerHeight - bottom) + 40, size: 130 },
      })
      axis.onMove((delta: any) => { this.moveData = { top: delta.top ?? 0, right: delta.right ?? 0 } })
    }, [], this)
  }

  // ── UI SETUP ─────────────────────────────────────────────────────────────────

  private setupUI() {
    this.timerBar  = this.add.graphics().setDepth(19)
    this.timerText = this.add.text(GAME_W / 2, 20, '', {
      fontSize: '18px', color: '#fff', fontStyle: 'bold', stroke: '#000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(20)

    // Floating need icons above animals — use PNG where available, emoji as fallback
    const mkNeedIcon = (key: string, fallback: string) =>
      this.textures.exists(key)
        ? this.add.image(0, 0, key).setDisplaySize(40, 40).setOrigin(0.5).setDepth(15) as any
        : this.add.text(0, 0, fallback, { fontSize: '34px' }).setOrigin(0.5).setDepth(15) as any

    this.needIcons.monkey   = mkNeedIcon('icon-banana', '🍌')
    this.needIcons.elephant = mkNeedIcon('icon-barrel', '🛢️')
    this.needIcons.lion     = mkNeedIcon('icon-turkey', '🍗')

    // Padlock icons above locked animals
    this.padlockIcons.elephant = this.add.text(0, 0, '🔒', { fontSize: '34px' }).setOrigin(0.5).setDepth(16)
    this.padlockIcons.lion     = this.add.text(0, 0, '🔒', { fontSize: '34px' }).setOrigin(0.5).setDepth(16)
  }

  // ── UPDATE HELPERS ───────────────────────────────────────────────────────────

  private handleMovement(dt: number) {
    const { top, right } = this.moveData
    const moving = Math.abs(top) > 0.05 || Math.abs(right) > 0.05
    if (moving) {
      this.player.position.x += right * SPEED * dt
      this.player.position.z -= top   * SPEED * dt
      this.player.rotation.y  = Math.atan2(right, -top)
      if (!this.isMoving) { this.idleAction?.fadeOut(0.2); this.walkAction?.reset().fadeIn(0.2).play(); this.isMoving = true }
    } else if (this.isMoving) {
      this.walkAction?.fadeOut(0.2); this.idleAction?.reset().fadeIn(0.2).play(); this.isMoving = false
    }
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
    const { x, y, z } = this.player.position
    this.third.camera.position.x = MathUtils.lerp(this.third.camera.position.x, x + 2, 0.1)
    this.third.camera.position.y = 5
    this.third.camera.position.z = MathUtils.lerp(this.third.camera.position.z, z + 10, 0.1)
    this.third.camera.lookAt(x + 2, y + 0.5, z)
  }

  private project(worldPos: Vector3): { x: number; y: number } {
    const v = worldPos.clone().project(this.third.camera)
    return { x: (v.x + 1) / 2 * GAME_W, y: (1 - v.y) / 2 * GAME_H }
  }

  private updateBubbles() {
    const px = this.player.position.x, pz = this.player.position.z
    for (const item of this.interactables) {
      if (!item.bubbleSprite) continue
      const available = item.isAvailable()
      const wp = item.getWorldPos()
      const inRange = Math.hypot(px - wp.x, pz - wp.z) < INTERACT_RANGE
      const show = available && inRange
      item.bubbleSprite.setVisible(show)
      if (show) {
        const { x, y } = this.project(new Vector3(wp.x, wp.y + 2, wp.z))
        item.bubbleSprite.setPosition(x, y)
      }
    }
  }

  private updateNeedIcons() {
    const t = Math.sin(this.elapsedTime * 2.5) * 6  // gentle bob in screen-Y
    const entries: [keyof typeof this.needIcons, Group | null][] = [
      ['monkey', this.monkeyGroup], ['elephant', this.elephantGroup], ['lion', this.lionGroup],
    ]
    for (const [key, group] of entries) {
      const icon = this.needIcons[key]
      if (!icon || !group) continue
      const p = new Vector3(); group.getWorldPosition(p)
      const s = this.project(new Vector3(p.x, p.y + 3, p.z))
      icon.setPosition(s.x, s.y + t)
    }

    // Padlocks sit slightly higher than need icons
    for (const key of ['elephant', 'lion'] as const) {
      const icon  = this.padlockIcons[key]
      const group = key === 'elephant' ? this.elephantGroup : this.lionGroup
      if (!icon || !group) continue
      const p = new Vector3(); group.getWorldPosition(p)
      const s = this.project(new Vector3(p.x, p.y + 4.5, p.z))
      icon.setPosition(s.x, s.y)
    }
  }

  private updateTimer(dt: number) {
    if (!this.timerActive || this.phase === 'done') return
    this.timerValue -= dt
    if (this.timerValue <= 0) { this.timerActive = false; this.onTimerExpired() }
  }

  private updateTimerUI() {
    if (!this.timerBar || !this.timerText) return
    this.timerBar.clear()
    if (!this.timerActive) { this.timerText.setText(''); return }

    const ratio = Math.max(0, this.timerValue / TIMER_DURATION)
    const [bW, bH, bX, bY] = [360, 20, (GAME_W - 360) / 2, 12]
    this.timerBar.fillStyle(0x222222, 0.8)
    this.timerBar.fillRoundedRect(bX - 2, bY - 2, bW + 4, bH + 4, 6)
    this.timerBar.fillStyle(ratio > 0.4 ? 0x4caf50 : 0xf44336)
    this.timerBar.fillRoundedRect(bX, bY, bW * ratio, bH, 5)
    this.timerText.setText(`${Math.ceil(this.timerValue)}s`)
  }

  // ── FAIL FLOW ────────────────────────────────────────────────────────────────

  private onTimerExpired() {
    this.cameras.main.shake(400, 0.015)
    const bg  = this.add.rectangle(GAME_W / 2, GAME_H / 2, 340, 210, 0x111111, 0.92).setDepth(200)
    const msg = this.add.text(GAME_W / 2, GAME_H / 2 - 45, "⏰ Time's up!\nOh no — try again?", {
      fontSize: '28px', color: '#fff', fontStyle: 'bold', align: 'center',
    }).setOrigin(0.5).setDepth(201)
    const btn = this.add.text(GAME_W / 2, GAME_H / 2 + 60, '  Retry  ', {
      fontSize: '26px', color: '#fff', backgroundColor: '#e53935', padding: { x: 24, y: 12 },
    }).setOrigin(0.5).setDepth(202).setInteractive()
    btn.on('pointerdown', () => { bg.destroy(); msg.destroy(); btn.destroy(); this.retryCurrentAnimal() })
  }

  private retryCurrentAnimal() {
    // Drop carried items
    for (const item of this.carriedItems) this.third.scene.remove(item.mesh)
    this.carriedItems = []

    // Go back a step if mid lion challenge
    if (this.phase === 'lion_food') { this.phase = 'lion_toy'; this.itemMeshes.get('food')!.visible = false }

    // Restore the item that belongs to the current phase
    const phaseItem: Record<GamePhase, ItemType | null> = {
      monkey: 'banana', elephant: 'water', lion_toy: 'toy', lion_food: 'food', done: null,
    }
    const t = phaseItem[this.phase]
    if (t) { const m = this.itemMeshes.get(t); if (m) m.visible = true }

    this.timerValue = TIMER_DURATION
    this.timerActive = true
  }

  // ── ENDCARD ──────────────────────────────────────────────────────────────────

  private showEndcard() {
    const overlay = this.add.rectangle(0, 0, GAME_W, GAME_H, 0x000000, 0.75).setOrigin(0).setDepth(100)
    const title   = this.add.text(GAME_W / 2, GAME_H / 2 - 150, '🦁 Zoo Keeper 🐘', {
      fontSize: '42px', color: '#fff', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(101)
    const sub     = this.add.text(GAME_W / 2, GAME_H / 2 - 70, 'Your animals need you!', {
      fontSize: '26px', color: '#ffeb3b',
    }).setOrigin(0.5).setDepth(101)
    const btnBg   = this.add.rectangle(GAME_W / 2, GAME_H / 2 + 80, 290, 72, 0x43a047).setDepth(101)
    const btnText = this.add.text(GAME_W / 2, GAME_H / 2 + 80, '🎮  Download Free', {
      fontSize: '26px', color: '#fff', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(102)

    // CTA pulse
    this.tweens.add({
      targets: [btnBg, btnText], scaleX: 1.1, scaleY: 1.1,
      duration: 600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    })

    // Slide in from bottom
    const ui = [title, sub, btnBg, btnText]
    ui.forEach(o => { o.y += GAME_H })
    this.tweens.add({ targets: ui, y: `-=${GAME_H}`, duration: 700, ease: 'Back.easeOut' })

    btnBg.setInteractive().on('pointerdown', () => console.log('CTA → store redirect'))
    overlay  // keep reference alive (not destroyed)
  }
}
