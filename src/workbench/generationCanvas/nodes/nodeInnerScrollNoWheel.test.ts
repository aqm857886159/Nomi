// 不变量：节点内部的每一处滚动区/文本输入区都必须挡住画布的滚轮缩放。
// 根因见 nodeScrollRegionClassName.ts 头注释——d3-zoom 的 wheel 监听器原生挂在
// `.react-flow__pane` 上，比 React 合成事件更早处理事件；节点内 onWheel 里
// `event.stopPropagation()` 拦不住它，只有 React Flow 自己认的 `nowheel`
// （事件源头 closest 检测，不依赖冒泡顺序）才管用。
// 这条测试红了两次才收敛（真实事故）：ProductionShotPlaceholder.tsx 与
// NodeErrorReport.tsx 都曾用 `onWheel stopPropagation` 这个不生效的手法，用户仍能复现
// 「提示词框一滚画布就跑」（2026-09-11 触发本次修复）。
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const NODES_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)))

// director/ 是独立的全屏 3D 导演台：小节点卡片本身没有滚动区（只有 overflow-hidden/-visible），
// 打开后的编辑器整个走 `全屏壳（portal + FULLSCREEN_Z_INDEX）`（见 director/CLAUDE.md），
// portal 目标不在 `.react-flow__pane` 的 DOM 子树内——wheel 原生冒泡够不到 pane 的监听器，
// 不属于这一类问题，扫描直接跳过整个目录。
const EXCLUDED_DIRS = new Set(['director'])

// 已核实确实不共享 pane DOM 子树、天然免疫，不必也不该硬套 nowheel：
//   - NodeEffectChips.tsx：`WorkbenchMenu` 内部用 Radix `DropdownMenuPrimitive.Portal`，
//     默认 portal 到 `document.body`，不是 pane 的 DOM 后代。
//   - NodeShotCutPanel.tsx：`createPortal` 到 `.workbench-generation__canvas`——那是
//     `<ReactFlow>` 外层的宿主 div（GenerationWorkspace.tsx），portal 内容是它的**同级**
//     节点而非 `.react-flow__pane` 的后代，wheel 原生冒泡到不了 pane。
const ALLOWED = new Set(['NodeEffectChips.tsx', 'NodeShotCutPanel.tsx'])

const SCROLL_PATTERN = /overflow-(?:y-|x-)?(?:auto|scroll)\b/
// 字面量 class 名，或本文件推荐的共享常量——两者都算「贴了」。React Flow 的
// `closest('.nowheel')` 沿 DOM 祖先链找，贴在自己身上或贴在外层包裹元素上都生效，
// 所以窗口式扫描（而不是要求同一个 JSX 元素）是正确的宽松度，不是漏洞。
const NOWHEEL_MARKERS = ['nowheel', 'NODE_SCROLL_REGION_CLASS_NAME']

function collectTsx(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (EXCLUDED_DIRS.has(entry)) continue
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) collectTsx(full, out)
    else if (full.endsWith('.tsx') && !full.endsWith('.test.tsx')) out.push(full)
  }
  return out
}

/**
 * 逐行扫，而不是整份文件找一次——Tailwind className 常年用 `cn(...)` 拆多行，但同一个
 * JSX 属性块里各行紧挨着；找到 overflow 那一行后，往前后各看几行找 nowheel 标记，覆盖
 * `cn(\n  NODE_SCROLL_REGION_CLASS_NAME,\n  'overflow-y-auto ...',\n)` 这种常见写法，
 * 又不至于把隔壁完全不相关的 JSX 元素误判进来。
 */
/**
 * 注释天然会提到 nowheel（本文件、nodeScrollRegionClassName.ts 头注释、以及每处修复旁边
 * 解释「为什么不是 stopPropagation」的中文注释都这么写）——标记必须出现在**代码**里才算数，
 * 否则一句解释性注释就能让检测对真正没贴 class 的元素视而不见。这条在收敛过程里真实
 * 复现过一次：`{/* ... *\/}` 这种 JSX 块注释跨多行且每行不带前导 `*`，逐行前缀判断
 * （只看 trim 后是否以 `//`/`*` 开头）会漏掉中间续行，`nowheel` 三个字就这样从注释里
 * 「泄漏」进窗口，把紧挨着的、真正缺 class 的 `<div>` 骗成了绿的。改成整份文件先挖掉所有
 * 块注释/行注释再逐行扫，从根上不依赖「注释长什么样」的假设。
 */
function stripComments(source: string): string {
  const withoutBlocks = source.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '))
  // 保守起见只吃真正的行注释：前面不能是 `:`（放过 `https://xyz` 这类 URL）。
  return withoutBlocks.replace(/(?<!:)\/\/[^\n]*/g, (match) => ' '.repeat(match.length))
}

function hasNowheelNearby(lines: string[], index: number, window = 5): boolean {
  const start = Math.max(0, index - window)
  const end = Math.min(lines.length, index + window + 1)
  return lines.slice(start, end).some((line) => NOWHEEL_MARKERS.some((marker) => line.includes(marker)))
}

describe('节点内滚动区必须挡住画布滚轮缩放（nowheel）', () => {
  it('nodes/** 下每个 overflow-auto/-scroll 区域都贴了 nowheel（豁免名单以外）', () => {
    const offenders: string[] = []
    for (const file of collectTsx(NODES_ROOT)) {
      const rel = path.relative(NODES_ROOT, file).split(path.sep).join('/')
      const base = path.basename(file)
      if (ALLOWED.has(base)) continue
      const lines = stripComments(readFileSync(file, 'utf8')).split('\n')
      lines.forEach((line, index) => {
        if (!SCROLL_PATTERN.test(line)) return
        if (!hasNowheelNearby(lines, index)) offenders.push(`${rel}:${index + 1}`)
      })
    }
    expect(
      offenders,
      '节点内 overflow-auto/-scroll 区域缺 nowheel：鼠标滚轮会被画布当缩放吃掉，' +
        '不是漏 stopPropagation（那个拦不住 d3-zoom 的原生监听器）——补 nowheel（推荐用 ' +
        'NODE_SCROLL_REGION_CLASS_NAME），确认天然免疫（portal 到 pane 子树外）再进 ALLOWED。',
    ).toEqual([])
  })

  it('<textarea> 同理——没有 overflow 也会把滚轮交给画布', () => {
    const offenders: string[] = []
    for (const file of collectTsx(NODES_ROOT)) {
      const rel = path.relative(NODES_ROOT, file).split(path.sep).join('/')
      const base = path.basename(file)
      if (ALLOWED.has(base)) continue
      const lines = stripComments(readFileSync(file, 'utf8')).split('\n')
      lines.forEach((line, index) => {
        if (!/<textarea[\s>]/.test(line)) return
        if (!hasNowheelNearby(lines, index, 6)) offenders.push(`${rel}:${index + 1}`)
      })
    }
    expect(offenders, '节点内 <textarea> 缺 nowheel：在框里滚轮会先经过它再冒泡到画布').toEqual([])
  })

  it('已知的关键场景确实覆盖了（红一次才知道测试本身没写死）', () => {
    const composer = readFileSync(path.join(NODES_ROOT, 'NodeGenerationComposer.tsx'), 'utf8')
    // 用户报的「提示词框一滚画布就跑」——就是这个 data-node-composer-prompt 容器。
    expect(composer).toMatch(/data-node-composer-prompt[^>]*NODE_SCROLL_REGION_CLASS_NAME/s)
    const select = readFileSync(
      path.resolve(NODES_ROOT, '../../../design/NomiSelect.tsx'),
      'utf8',
    )
    expect(select).toContain('nowheel')
  })
})
