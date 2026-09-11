/**
 * [INPUT]: 零依赖
 * [OUTPUT]: 对外提供 SplatRevealEffect / SPLAT_REVEAL_EFFECT_ID / SPLAT_REVEAL_DEFAULT_POOL / SPLAT_REVEAL_SPEED / SPLAT_REVEAL_HOLD_SECONDS、
 *           pickRevealEffect、revealShaderDuration、revealEaseOut
 * [POS]: director/model 的泼溅「显现」纯参数层（默认随机 Magic|Spread，×2 倍速，尾部再停 1s）：
 *        效果 id 对应 GLSL 里的 effectType 分支，时长按场景半径 / 最低点推得，让大场景边缘粒子也扫得到；着色器本身住 scene/environment/splatRevealDyno。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export type SplatRevealEffect = 'Magic' | 'Spread' | 'Unroll' | 'Twister' | 'Rain'

export const SPLAT_REVEAL_EFFECT_ID: Record<SplatRevealEffect, number> = { Magic: 1, Spread: 2, Unroll: 3, Twister: 4, Rain: 5 }
export const SPLAT_REVEAL_EFFECTS = Object.keys(SPLAT_REVEAL_EFFECT_ID) as SplatRevealEffect[]
// 默认只在这两种里随机（另外三种视觉过强，留给显式选择）
export const SPLAT_REVEAL_DEFAULT_POOL: readonly SplatRevealEffect[] = ['Magic', 'Spread']
export const SPLAT_REVEAL_SPEED = 2
export const SPLAT_REVEAL_HOLD_SECONDS = 1

export type SplatRevealBounds = { maxRadiusXZ: number; minY: number }

export function pickRevealEffect(random: () => number = Math.random, pool: readonly SplatRevealEffect[] = SPLAT_REVEAL_DEFAULT_POOL): SplatRevealEffect {
  if (pool.length === 0) return 'Magic'
  const index = Math.min(pool.length - 1, Math.max(0, Math.floor(random() * pool.length)))
  return pool[index]
}

// 着色器内的 t 走到「全部粒子归位」需要多少秒：Magic 固定 14.5；其余按 XZ 半径 / 最低点反推
export function revealShaderDuration(effect: SplatRevealEffect, bounds: SplatRevealBounds): number {
  const radius = Math.max(bounds.maxRadiusXZ, 0.5)
  switch (effect) {
    case 'Spread': {
      const tt = radius * 2.5 + 8
      return Math.sqrt(Math.max(0, (tt - 0.5) / 0.4))
    }
    case 'Magic':
      return 14.5
    case 'Unroll': {
      const byMin = Math.max(0, (0.5 - bounds.minY) * 2)
      const byTop = Math.max(0, 2.7 - bounds.minY)
      return Math.max(5, byMin, byTop)
    }
    case 'Twister':
      return Math.sqrt(Math.max(0, (6 + radius * 2) / 0.1))
    case 'Rain':
      return Math.sqrt(Math.max(0, (4 + radius * 2) / 0.1))
    default:
      return 10
  }
}

// 全景球淡入用的三次缓出（1 - (1-e)^3）
export function revealEaseOut(progress: number): number {
  const clamped = Math.min(1, Math.max(0, progress))
  return 1 - Math.pow(1 - clamped, 3)
}
