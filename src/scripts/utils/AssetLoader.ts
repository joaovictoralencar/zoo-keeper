import { Group } from 'three'

/**
 * Thin GLTF asset loader with an in-memory cache.
 * Deduplicates loads across the scene:
 *  - Each unique path is fetched only once, even if requested concurrently.
 *  - Cached full gltf objects (including animations) are returned for repeat calls.
 *  - Failed paths are remembered and return null immediately on subsequent calls.
 *
 * Usage:
 *   const loader = new AssetLoader(this.third)
 *   const gltf   = await loader.loadGltf('assets/pets/animal-monkey.glb')
 *   const gltfs  = await loader.loadManyGltf(['assets/a.glb', 'assets/b.glb'])
 */
export class AssetLoader {
    private readonly third: any
    /** Resolved gltf objects for successfully loaded paths */
    private readonly cache = new Map<string, any>()
    /** In-flight promises — prevents duplicate fetches for concurrent requests */
    private readonly inflight = new Map<string, Promise<any | null>>()
    /** Paths that have already failed — skip without re-trying */
    private readonly failed = new Set<string>()

    constructor(third: any) {
        this.third = third
    }

    /**
     * Loads a GLTF and returns the raw gltf object (including animations).
     * Repeated calls for the same path return the cached result immediately.
     * Returns null if the file could not be loaded.
     */
    async loadGltf(path: string): Promise<any | null> {
        if (this.cache.has(path))   return this.cache.get(path)
        if (this.failed.has(path))  return null
        if (this.inflight.has(path)) return this.inflight.get(path)!

        const promise = this.third.load.gltf(path)
            .then((gltf: any) => {
                this.cache.set(path, gltf)
                this.inflight.delete(path)
                return gltf
            })
            .catch(() => {
                console.warn(`[AssetLoader] Failed to load: ${path}`)
                this.failed.add(path)
                this.inflight.delete(path)
                return null
            })

        this.inflight.set(path, promise)
        return promise
    }

    /**
     * Loads multiple GLTFs in parallel and returns their raw gltf objects.
     * Null entries indicate a failed load.
     */
    async loadManyGltf(paths: string[]): Promise<(any | null)[]> {
        return Promise.all(paths.map(p => this.loadGltf(p)))
    }

    clear() {
        this.cache.clear()
        this.inflight.clear()
        this.failed.clear()
    }
}
