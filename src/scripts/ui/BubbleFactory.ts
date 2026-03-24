import {
    ACTION_BUBBLE_W, ACTION_BUBBLE_H,
    PURCHASE_BUBBLE_W, PURCHASE_BUBBLE_H,
    BUBBLE_RADIUS, FONT,
} from '../constants'

export interface ActionBubbleOptions {
    /** Phaser texture key for the icon image. Falls back to `label` as emoji text if absent. */
    iconKey?: string
    /** Texture key for the tap-pointer sprite. Defaults to `'ui-pointer'`. */
    pointerKey?: string
    /** Call-to-action text shown above the pointer. Defaults to `'GIVE'`. */
    ctaText?: string
}

export interface PurchaseBubbleOptions {
    /** Texture key for the currency/star icon. Defaults to `'ui-star'`. */
    starKey?: string
    /** Texture key for the tap-pointer sprite. Defaults to `'ui-pointer'`. */
    pointerKey?: string
    /** Call-to-action text shown above the pointer. Defaults to `'UNLOCK'`. */
    ctaText?: string
}

/**
 * Creates the standard white action bubble used for item delivery.
 * Contains an icon (or emoji fallback), a pulsing tap-pointer, and a CTA label.
 */
export function createActionBubble(
    scene: Phaser.Scene,
    label: string,
    options: ActionBubbleOptions = {},
): Phaser.GameObjects.Container {
    const { iconKey, pointerKey = 'ui-pointer', ctaText = 'GIVE' } = options
    const W = ACTION_BUBBLE_W, H = ACTION_BUBBLE_H, R = BUBBLE_RADIUS

    const shadow = scene.add.graphics()
    shadow.fillStyle(0x000000, 0.28)
    shadow.fillRoundedRect(-W / 2 + 3, -H / 2 + 5, W, H, R)

    const bg = scene.add.graphics()
    bg.fillStyle(0xffffff, 1)
    bg.fillRoundedRect(-W / 2, -H / 2, W, H, R)

    const icon: any = iconKey && scene.textures.exists(iconKey)
        ? scene.add.image(0, 0, iconKey).setDisplaySize(46, 46)
        : scene.add.text(0, 2, label, { fontSize: '32px' }).setOrigin(0.5)

    const tapPointer = scene.add.image(0, -H / 2, pointerKey)
        .setDisplaySize(48, 48).setOrigin(0.5).setAngle(180)
    scene.tweens.add({
        targets: tapPointer, scaleX: 1.18, scaleY: 1.18,
        duration: 500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    })

    const tapLabel = scene.add.text(0, -H / 2 - 54, ctaText, {
        fontSize: '24px', color: '#ffffff', fontStyle: 'bold', fontFamily: FONT,
        stroke: '#000000', strokeThickness: 4,
    }).setOrigin(0.5)

    return scene.add.container(0, 0, [shadow, bg, icon, tapPointer, tapLabel])
        .setVisible(false).setDepth(17).setScale(0).setSize(W, H).setInteractive()
}

/**
 * Creates the gold purchase bubble used to unlock enclosures.
 * Shows a currency icon and the cost, with a pulsing tap-pointer and a CTA label.
 */
export function createPurchaseBubble(
    scene: Phaser.Scene,
    cost: number,
    options: PurchaseBubbleOptions = {},
): Phaser.GameObjects.Container {
    const { starKey = 'ui-star', pointerKey = 'ui-pointer', ctaText = 'UNLOCK' } = options
    const W = PURCHASE_BUBBLE_W, H = PURCHASE_BUBBLE_H, R = BUBBLE_RADIUS

    const shadow = scene.add.graphics()
    shadow.fillStyle(0x000000, 0.28)
    shadow.fillRoundedRect(-W / 2 + 3, -H / 2 + 5, W, H, R)

    const bg = scene.add.graphics()
    bg.fillStyle(0xffe57a, 1)
    bg.fillRoundedRect(-W / 2, -H / 2, W, H, R)

    const starIcon = scene.add.image(0, -14, starKey).setDisplaySize(36, 36).setOrigin(0.5)
    const numText  = scene.add.text(0, 20, String(cost), {
        fontSize: '22px', color: '#7a4500', fontFamily: FONT, fontStyle: 'bold',
    }).setOrigin(0.5)

    const tapPointer = scene.add.image(0, -H / 2 - 20, pointerKey)
        .setDisplaySize(42, 42).setOrigin(0.5).setAngle(180)
    scene.tweens.add({
        targets: tapPointer, scaleX: 1.18, scaleY: 1.18,
        duration: 500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    })

    const tapLabel = scene.add.text(0, -H / 2 - 40, ctaText, {
        fontSize: '13px', color: '#ffffff', fontStyle: 'bold', fontFamily: FONT,
        stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5)

    return scene.add.container(0, 0, [shadow, bg, starIcon, numText, tapPointer, tapLabel])
        .setVisible(false).setDepth(17).setScale(0).setSize(W, H).setInteractive()
}
