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
  id:               string
  centerX:          number
  width:            number
  unlockCost:       number   // stars needed to unlock; 0 = starts purchased
  unlockRequires?:  string   // enclosure id that must be purchased first
}

export interface AnimalConfig {
  id:          string
  enclosureId: string
  model:       string
  spawnZ:      number
  spawnY?:     number     // override Y after normalisation; 0 = force ground level
  targetHeight: number
  startLocked: boolean
  wanderRadius: number
  moveSpeed:   number
  count?:      number     // how many instances to spawn (default 1)
  scale?:      number     // extra uniform scale multiplier applied after normalisation
}

export interface ItemConfig {
  type:          string
  enclosureId:   string          // item spawns at this enclosure's centerX
  model:         string | null
  scale:         number
  positionY:     number
  positionZ:     number
  bubbleIcon:    string | null   // texture key; null = show no icon
  iconAsset:     string | null
  startVisible?: boolean
}

export interface PhaseOnComplete {
  starsAwarded?: number
  showItemType?: string
  nextPhase:     string
  endGame?:      boolean
}

export interface PhaseConfig {
  id:                  string
  enclosureId:         string
  animalId:            string
  requiredItem:        string
  deliveryLabel:       string
  deliveryIcon?:       string
  deliveryIconAsset?:  string
  onComplete:          PhaseOnComplete
}

export interface PropConfig {
  model: string
  x:     number
  y:     number
  z:     number
  rotY?: number
  scale?: number
}

export interface TutorialConfig {
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
