export interface Vec3 { x: number; y: number; z: number }

export interface WorldConfig {
  bounds:           { xMin: number; xMax: number; zMin: number; zMax: number }
  enclosureEntryZ:  number
  timerDuration:    number
  interactRange:    number
  speed:            number
}

export interface EnvironmentConfig {
  skyColor:             string
  groundColor:          string
  groundWidth:          number
  groundDepth:          number
  pathColor:            string
  pathWidth:            number
  pathDepth:            number
  enclosureFloorColor:  string
  enclosureFloorSize:   number
}

export interface FenceConfig {
  model:        string
  segmentWidth: number
  halfWidth:    number
  zFront:       number
  zBack:        number
  gatePanels:   number
}

export interface PlayerConfig {
  model:  string
  startX: number
  startZ: number
  scale:  number
}

export interface EnclosureConfig {
  id:        string
  phase:     string   // first phase that uses this enclosure
  centerX:   number
  zoneXMin:  number
  zoneXMax:  number
}

export interface AnimalConfig {
  id:          string
  enclosureId: string
  model:       string
  spawnZ:      number
  targetHeight: number
  startLocked: boolean
  wanderRadius: number
  moveSpeed:   number
  emoji:       string
}

export interface ItemConfig {
  type:          string
  model:         string | null
  scale:         number
  position:      Vec3
  bubbleIcon:    string | null   // texture key; null = use bubbleEmoji fallback
  bubbleEmoji?:  string          // emoji fallback when bubbleIcon is null
  iconAsset:     string | null
  startVisible?: boolean
}

export interface PhaseOnComplete {
  unlockAnimalId?: string
  showItemType?:   string
  nextPhase:       string
  endGame?:        boolean
}

export interface PhaseConfig {
  id:            string
  enclosureId:   string
  animalId:      string
  requiredItem:  string
  deliveryLabel: string
  onComplete:    PhaseOnComplete
}

export interface PropConfig {
  model: string
  x:     number
  y:     number
  z:     number
  rotY?: number
  scale?: number
}

export interface TutorialStep {
  gesture:  'tap' | 'swipe'
  verb:     string
  desc:     string
}

export interface TutorialConfig {
  steps:         TutorialStep[]
  autoDismissMs: number
}

export interface LevelData {
  world:       WorldConfig
  environment: EnvironmentConfig
  fence:       FenceConfig
  player:      PlayerConfig
  enclosures:  EnclosureConfig[]
  animals:     AnimalConfig[]
  items:       ItemConfig[]
  phases:      PhaseConfig[]
  props:       PropConfig[]
  tutorial:    TutorialConfig
}
