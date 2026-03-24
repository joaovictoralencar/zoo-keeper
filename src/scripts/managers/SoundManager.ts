/**
 * SoundManager — reusable audio service for Phaser 3 games.
 *
 * Wraps Phaser's sound system with two independent categories:
 *   • sfx   — fire-and-forget effects (footsteps, pickups, UI clicks)
 *   • music — one background track at a time, with optional fade in/out
 *
 * Usage:
 *   // In create():
 *   this.sfx = new SoundManager(this, { musicVolume: 0.5, sfxVolume: 0.8 })
 *
 *   // Play a sound effect:
 *   this.sfx.playSfx('pickup')
 *
 *   // Start background music with a 1-second fade in:
 *   this.sfx.playMusic('bgm-loop', { fadeIn: 1000 })
 *
 *   // Cross-fade to a different track:
 *   this.sfx.playMusic('boss-theme', { fadeIn: 800, fadeOut: 500 })
 *
 *   // Mute everything (e.g., user taps mute button):
 *   this.sfx.toggleMute()
 *
 *   // Clean up when scene shuts down:
 *   this.sfx.destroy()
 */

export interface SoundManagerConfig {
    /** Master volume for the background music track. 0–1. Default: 0.6 */
    musicVolume?: number
    /** Master volume applied to all SFX calls. 0–1. Default: 1.0 */
    sfxVolume?: number
}

export interface PlayMusicOptions {
    /** Target volume for this track, multiplied by musicVolume. 0–1. Default: 1 */
    volume?: number
    /** Whether the track loops. Default: true */
    loop?: boolean
    /** Duration in ms to fade in from silence. Default: 0 (instant) */
    fadeIn?: number
    /** Duration in ms to fade out the current track before switching. Default: 0 (instant) */
    fadeOut?: number
}

export interface PlaySfxOptions {
    /** Volume multiplier on top of sfxVolume. 0–1. Default: 1 */
    volume?: number
    /** Playback rate (1 = normal, 2 = double speed). Default: 1 */
    rate?: number
    /** Whether to loop the sfx. Default: false */
    loop?: boolean
}

export class SoundManager {
    private readonly scene: Phaser.Scene

    private _musicVolume: number
    private _sfxVolume: number
    private _muted = false

    private currentMusic: Phaser.Sound.BaseSound | null = null
    private currentMusicKey = ''

    constructor(scene: Phaser.Scene, config: SoundManagerConfig = {}) {
        this.scene = scene
        this._musicVolume = Math.max(0, Math.min(1, config.musicVolume ?? 0.6))
        this._sfxVolume   = Math.max(0, Math.min(1, config.sfxVolume   ?? 1.0))
    }

    // ── SFX ──────────────────────────────────────────────────────────────────

    /**
     * Plays a fire-and-forget sound effect.
     * Returns the sound instance (useful for looping SFX you want to stop later),
     * or null if the key is not loaded.
     */
    playSfx(key: string, options: PlaySfxOptions = {}): Phaser.Sound.BaseSound | null {
        if (!this.scene.cache.audio.exists(key)) {
            console.warn(`[SoundManager] Audio key not loaded: "${key}"`)
            return null
        }
        const effectiveVolume = this._muted ? 0 : (options.volume ?? 1) * this._sfxVolume
        const result = this.scene.sound.play(key, {
            volume: effectiveVolume,
            rate:   options.rate ?? 1,
            loop:   options.loop ?? false,
        })
        // scene.sound.play() returns false when the AudioContext is locked or
        // the sound manager is a NoAudioSoundManager — guard before returning
        if (!result || typeof result === 'boolean') return null
        return result as Phaser.Sound.BaseSound
    }

    // ── MUSIC ─────────────────────────────────────────────────────────────────

    /**
     * Plays a background music track.
     * If the same key is already playing, this is a no-op.
     * Optionally fades out the current track before starting the new one.
     */
    playMusic(key: string, options: PlayMusicOptions = {}): void {
        const { volume = 1, loop = true, fadeIn = 0, fadeOut = 0 } = options

        if (this.currentMusicKey === key && this.currentMusic?.isPlaying) return

        const startNewTrack = () => {
            if (!this.scene.cache.audio.exists(key)) {
                console.warn(`[SoundManager] Music key not loaded: "${key}"`)
                return
            }
            const targetVol = this._muted ? 0 : volume * this._musicVolume
            const sound = this.scene.sound.add(key, {
                loop,
                volume: fadeIn > 0 ? 0 : targetVol,
            })
            sound.play()
            this.currentMusic    = sound
            this.currentMusicKey = key

            if (fadeIn > 0 && !this._muted) {
                this.scene.tweens.add({
                    targets:  sound,
                    volume:   targetVol,
                    duration: fadeIn,
                    ease:     'Linear',
                })
            }
        }

        if (this.currentMusic && fadeOut > 0) {
            this._fadeOutAndStop(this.currentMusic, fadeOut, startNewTrack)
            this.currentMusic    = null
            this.currentMusicKey = ''
        } else {
            this._stopCurrentMusic()
            startNewTrack()
        }
    }

    /**
     * Stops background music, optionally fading it out first.
     * @param fadeOut Duration in ms for the fade. Default: 0 (instant)
     */
    stopMusic(fadeOut = 0): void {
        if (!this.currentMusic) return
        if (fadeOut > 0) {
            this._fadeOutAndStop(this.currentMusic, fadeOut)
        } else {
            this._stopCurrentMusic()
        }
        this.currentMusic    = null
        this.currentMusicKey = ''
    }

    pauseMusic(): void  { this.currentMusic?.pause() }
    resumeMusic(): void { this.currentMusic?.resume() }

    // ── VOLUME ────────────────────────────────────────────────────────────────

    setMusicVolume(v: number): void {
        this._musicVolume = Math.max(0, Math.min(1, v))
        if (this.currentMusic && !this._muted) {
            (this.currentMusic as any).setVolume(this._musicVolume)
        }
    }

    setSfxVolume(v: number): void {
        this._sfxVolume = Math.max(0, Math.min(1, v))
    }

    get musicVolume(): number { return this._musicVolume }
    get sfxVolume():   number { return this._sfxVolume }

    // ── MUTE ──────────────────────────────────────────────────────────────────

    mute(): void {
        if (this._muted) return
        this._muted = true
        if (this.currentMusic) (this.currentMusic as any).setVolume(0)
    }

    unmute(): void {
        if (!this._muted) return
        this._muted = false
        if (this.currentMusic) (this.currentMusic as any).setVolume(this._musicVolume)
    }

    /** Toggles mute and returns the new muted state. */
    toggleMute(): boolean {
        this._muted ? this.unmute() : this.mute()
        return this._muted
    }

    get isMuted(): boolean { return this._muted }

    // ── LIFECYCLE ─────────────────────────────────────────────────────────────

    /** Stop music and release resources. Call from scene shutdown(). */
    destroy(): void {
        this.stopMusic()
    }

    // ── PRIVATE ───────────────────────────────────────────────────────────────

    private _stopCurrentMusic(): void {
        if (!this.currentMusic) return
        this.currentMusic.stop()
        this.currentMusic.destroy()
        this.currentMusic    = null
        this.currentMusicKey = ''
    }

    private _fadeOutAndStop(
        sound: Phaser.Sound.BaseSound,
        duration: number,
        onComplete?: () => void,
    ): void {
        this.scene.tweens.add({
            targets:    sound,
            volume:     0,
            duration,
            ease:       'Linear',
            onComplete: () => {
                sound.stop()
                sound.destroy()
                onComplete?.()
            },
        })
    }
}
