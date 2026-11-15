// 「走查里裸写生成框宽度」的判定逻辑（check-walkthroughs.mjs 的 bare-composer-width 规则）。
//
// 为什么（2026-11-14，#1525 独立验收条件 4）：生成框（画布节点下面那张参数卡）的屏幕宽只有一个家——
// src/workbench/generationCanvas/nodes/nodeSizing.ts 的 NODE_COMPOSER_WIDTH。11-14 从 560 加宽到 600 时，三条走查各写死过一份，
// composer-b3 的 `card.width === 560` 一直红到验收才被看见。读法的唯一出口是 tests/ux/_composerWidth.mjs。
//
// 判据故意窄（宁可漏报不误报）：只看**碰到生成框锚点的文件**里，「宽度 === / == / toBe( 某个数」且这个数是生成框现在或
// 以前用过的宽。别的 600（Agent 面板宽、waitForTimeout(600)、截字 slice(0, 600)）都不碰。
const COMPOSER_ANCHOR = /__composer-card|data-node-composer|NODE_COMPOSER/
/** 生成框以前用过的宽（加宽一次就往这里补一个旧值；现值由调用方从 nodeSizing.ts 读来传进来）。 */
export const PAST_COMPOSER_WIDTHS = Object.freeze([560])

/**
 * @param {string} code 走查源码（已剥注释）
 * @param {number} currentWidth nodeSizing.ts 里 NODE_COMPOSER_WIDTH 的现值
 * @returns {{ line: number, text: string }[]}
 */
export function findBareComposerWidths(code, currentWidth) {
  if (!COMPOSER_ANCHOR.test(code)) return []
  const widths = new Set([currentWidth, ...PAST_COMPOSER_WIDTHS])
  const hits = []
  code.split('\n').forEach((text, index) => {
    const compare = /(?:width|\.w)\s*\)?\s*(?:===|!==|==|!=)\s*(\d+)\b|(\d+)\s*(?:===|!==|==|!=)\s*[\w.]*(?:width|\.w)\b|(?:width|\.w)[^\n]*?\.toBe\((\d+)\)/gi
    for (const match of text.matchAll(compare)) {
      const value = Number(match[1] ?? match[2] ?? match[3])
      if (widths.has(value)) { hits.push({ line: index + 1, text: text.trim().slice(0, 120) }); break }
    }
  })
  return hits
}

/** 从 nodeSizing.ts 读生成框现宽（和 tests/ux/_composerWidth.mjs 同一个读法）。 */
export function readComposerWidth(source) {
  const match = /export const NODE_COMPOSER_WIDTH = (\d+)/.exec(source)
  if (!match) throw new Error('nodeSizing.ts 里找不到 NODE_COMPOSER_WIDTH')
  return Number(match[1])
}
