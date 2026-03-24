/**
 * AudioConfig — single source of truth for all audio volumes and timings.
 *
 * Tweak anything here; no other file needs to be touched.
 *
 * Volumes are 0 → 1.
 *   master.music  multiplies every music track
 *   master.sfx    multiplies every individual sfx value below
 *   sfx.*         per-sound relative volume (1.0 = full sfxVolume)
 */
export const AudioConfig = {
    /** Master volumes fed into SoundManager */
    master: {
        music: 0.3,  // BGM overall level  — raise for louder music
        sfx:   0.85,  // SFX overall level  — raise/lower all SFX together
    },

    /** Per-sound relative volumes (0–1, scaled by master.sfx) */
    sfx: {
        footstep: 0.7,  // looping walk sound — lower = quieter footsteps
        whoosh:   1.0,   // bubble pop-in
        animal:   0.75,  // monkey / elephant / lion delivery cheer
        coin:     1.0,   // enclosure purchase
        coinStar: 1.0,   // per-star coin ding during delivery animation
        win:      1.0,   // end-card fanfare
        unlock: 0.8,   // new enclosure unlocked
    },

    /** Timing in milliseconds */
    timing: {
        musicFadeIn:  1500,  // BGM fade-in duration at game start
        musicFadeOut:  800,  // BGM fade-out duration on win
    },
}
