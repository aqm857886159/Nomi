// 生成框（画布节点下面那张参数卡）的屏幕宽只有一个家：nodeSizing.ts 的 NODE_COMPOSER_WIDTH。
// 走查从源文件读，不再各抄一份数——11-14 从 560 加宽到 600 时三条走查都写死过。
import fs from 'node:fs'

export const NODE_COMPOSER_WIDTH = (() => {
  const source = fs.readFileSync(new URL('../../src/workbench/generationCanvas/nodes/nodeSizing.ts', import.meta.url), 'utf8')
  const match = /export const NODE_COMPOSER_WIDTH = (\d+)/.exec(source)
  if (!match) throw new Error('nodeSizing.ts 里找不到 NODE_COMPOSER_WIDTH')
  return Number(match[1])
})()
