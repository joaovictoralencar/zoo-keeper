import type { PhaseConfig } from '../types/LevelData'

/**
 * PhaseManager — owns the game's phase state machine.
 *
 * Wraps the phases array from level.json and exposes a clean API so the
 * rest of the codebase never has to do `phases.find(p => p.id === this.phase)`.
 *
 * Usage:
 *   const pm = new PhaseManager(ld.phases)
 *   pm.current     // PhaseConfig | null — the active phase definition
 *   pm.currentId   // string            — e.g. 'monkey', 'elephant', 'done'
 *   pm.isDone      // true after the last phase completes
 *   pm.advance('elephant')
 */
export class PhaseManager {
    private readonly phases: PhaseConfig[]
    private _currentId: string

    constructor(phases: PhaseConfig[]) {
        if (phases.length === 0) throw new Error('[PhaseManager] phases array is empty')
        this.phases = phases
        this._currentId = phases[0].id
    }

    // ── Reads ─────────────────────────────────────────────────────────────────

    get currentId(): string { return this._currentId }

    get current(): PhaseConfig | null {
        return this.phases.find(p => p.id === this._currentId) ?? null
    }

    /** True when currentId is 'done' (no matching phase in the array). */
    get isDone(): boolean {
        return this.current === null
    }

    findById(id: string): PhaseConfig | null {
        return this.phases.find(p => p.id === id) ?? null
    }

    indexOf(id: string): number {
        return this.phases.findIndex(p => p.id === id)
    }

    // ── Writes ────────────────────────────────────────────────────────────────

    /** Move to a new phase by id. Pass 'done' (or any unknown id) to end the game. */
    advance(nextId: string): void {
        this._currentId = nextId
    }
}
