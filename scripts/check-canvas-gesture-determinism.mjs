#!/usr/bin/env node
// 画布 benchmark 手势确定性门岗（2026-09-05）。
// 抓的是一整类**本机偶尔红、CI 经常红，但两边都不是回归**的写法：
// 让拖拽手势跑进 React Flow 的自动平移带，然后拿一个写死的数去判它扫出来的结果。
//
// 起因（完整根因见 docs/fixes/2026-09-05-canvas-perf-marquee-autopan.root-cause.json）：
// marquee-select 场景把框选终点钉在「stage 边缘 - 10px」，而 React Flow 的
// `calcAutoPan(pos, bounds, speed = 15, distance = 40)` 在指针进入边缘 40px 带内时
// 会**按 requestAnimationFrame 每帧平移一点视口**。于是这一笔扫过多大区域，取决于
// 这台机器在手势期间画了多少帧：darwin 上实测同一份代码在 9 和 12 之间跳，
// Linux CI 上在 8 和 12 之间跳。而判据写的是「必须 ≥ 12」——一个在 darwin 上调出来的常数。
// 结果是 main 上不碰画布的提交也能红（run 33967545326 / 33956782546），
// 每次都要有人重新查一遍才敢说「这不是回归」。
//
// 两条规矩，都是硬零（没有棘轮基线，新增当场红）：
//   ① 拖拽手势的坐标不许自己贴着 stage 边缘算，必须过 clampIntoAutoPanSafeArea；
//   ② 框选这种「扫过一片区域」的判据不许和数字字面量比，必须和从那块区域 derive 出来的期望值比。
// 缺一不可：只做 ② 的话扫过的区域还在随帧率变，derive 出来的期望值一样在跳。
//
// **边界说明（诚实标注，别把这门岗当成比它实际更宽的保险）**：
// 自动平移只在「选框进行中」或「拖节点进行中」才跑，光挪鼠标不按键**不触发**——
// 所以规则 ① 只认拖拽手势的坐标（dragPath 调用里的、或先算进变量再传出去的），
// 不认 video-hover 结尾那种把指针挪开的裸 mouse.move。
// 规则 ② 只认框选这一族：multi-node-drag 的选中数来自逐个点击、不是扫出来的，
// 它和帧率无关，不在这个类里，所以这里不动它。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { AUTO_PAN_SAFE_MARGIN_PX } from '../tests/ux/canvas-perf/gestureGeometry.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// 只看画布性能 benchmark 这一族：它们是唯一「用合成指针手势跑真实画布、再拿结果当判据」的地方。
const SCAN_TARGETS = ['tests/ux/canvas-performance-benchmark.e2e.mjs', 'tests/ux/canvas-perf']

function collectFiles() {
  const files = []
  const walk = (full) => {
    if (!fs.existsSync(full)) return
    if (fs.statSync(full).isFile()) {
      if (/\.mjs$/.test(full) && !/\.test\.mjs$/.test(full)) files.push(full)
      return
    }
    for (const entry of fs.readdirSync(full, { withFileTypes: true })) walk(path.join(full, entry.name))
  }
  for (const target of SCAN_TARGETS) walk(path.join(repoRoot, target))
  return files.sort()
}

// 注释里必然会出现被禁的写法（这个文件自己就是例子），所以先把注释抹成等长空白：
// 抹成等长而不是删掉，是为了让后面算出来的偏移量仍然对得上原文的行号。
function blankComments(source) {
  const blanked = source.split('')
  let index = 0
  let state = 'code'
  while (index < source.length) {
    const two = source.slice(index, index + 2)
    if (state === 'code' && two === '//') state = 'line'
    else if (state === 'code' && two === '/*') state = 'block'
    else if (state === 'line' && source[index] === '\n') state = 'code'
    else if (state === 'block' && two === '*/') {
      blanked[index] = ' '
      blanked[index + 1] = ' '
      index += 2
      state = 'code'
      continue
    }
    if (state !== 'code' && source[index] !== '\n') blanked[index] = ' '
    index += 1
  }
  return blanked.join('')
}

// dragPath(...) 的完整实参范围（括号配平，跨行也算）。落在这个范围里的坐标就是拖拽手势的坐标。
function dragCallRanges(source) {
  const ranges = []
  const pattern = /\bdragPath\s*\(/g
  for (const match of source.matchAll(pattern)) {
    let depth = 0
    let index = match.index + match[0].length - 1
    for (; index < source.length; index += 1) {
      if (source[index] === '(') depth += 1
      else if (source[index] === ')') {
        depth -= 1
        if (depth === 0) break
      }
    }
    ranges.push([match.index, index])
  }
  return ranges
}

const EDGE_HUGGING = /stage\.(?:width|height)\s*-\s*(\d+(?:\.\d+)?)/g
const ASSIGNMENT_LINE = /^\s*(?:const|let|var)\s|^\s*\w+\s*=[^=]/
const LITERAL_MARQUEE_SELECTION = /\bselected\s*(?:<|<=|>|>=|===|!==|==|!=)\s*(\d+)\b/
// 判据归属看**它所在的场景分支**，不看「附近有没有出现 marquee 这个词」：
// 后者会在两个 guard 挨着写时把下一个场景的判据也算进来（multi-node-drag 就这么被误伤过）。
const SCENARIO_BRANCH = /sample\.scenario\s*===\s*'([a-z0-9-]+)'/i
const SWEPT_SELECTION_SCENARIOS = new Set(['marquee-select'])

function lineNumberAt(source, offset) {
  let line = 1
  for (let index = 0; index < offset; index += 1) if (source[index] === '\n') line += 1
  return line
}

function findEdgeHuggingDragPoints(source, lines) {
  const hits = []
  const ranges = dragCallRanges(source)
  for (const match of source.matchAll(EDGE_HUGGING)) {
    if (Number(match[1]) >= AUTO_PAN_SAFE_MARGIN_PX) continue
    const line = lineNumberAt(source, match.index)
    const text = lines[line - 1] ?? ''
    const insideDragCall = ranges.some(([start, end]) => match.index >= start && match.index <= end)
    // 先算进变量再传给 dragPath 的写法，括号范围里看不到，所以赋值行一并认。
    const precomputedPoint = ASSIGNMENT_LINE.test(text)
    if (insideDragCall || precomputedPoint) hits.push({ line, hit: match[0], source: text.trim() })
  }
  return hits
}

function findLiteralMarqueeSelection(lines) {
  const hits = []
  let branch = null
  lines.forEach((text, index) => {
    const scenario = text.match(SCENARIO_BRANCH)
    if (scenario) branch = scenario[1]
    if (!branch || !SWEPT_SELECTION_SCENARIOS.has(branch)) return
    const match = text.match(LITERAL_MARQUEE_SELECTION)
    if (match) hits.push({ line: index + 1, hit: match[0], source: text.trim() })
  })
  return hits
}

const RULES = [
  {
    id: 'edge-hugging-drag-endpoint',
    label: `拖拽手势坐标自己贴着 stage 边缘算，退的距离小于自动平移安全边距 ${AUTO_PAN_SAFE_MARGIN_PX}px`,
    why:
      'React Flow 会在指针进入 pane 边缘 40px 带内时按帧自动平移视口，手势扫过的区域随帧率变化，\n'
      + '    量出来的东西不可复现。改成 clampIntoAutoPanSafeArea(point, stage)（tests/ux/canvas-perf/gestureGeometry.mjs）。',
    find: (source, lines) => findEdgeHuggingDragPoints(source, lines),
  },
  {
    id: 'literal-marquee-selection-count',
    label: '框选结果和数字字面量比大小',
    why:
      '扫过多少节点由窗口尺寸决定，本机和 CI 并不一样，写死的常数在另一台机器上就是掷硬币。\n'
      + '    改成和 expectedFullySelected(boxes, sweptRect) derive 出来的期望值比。',
    find: (_source, lines) => findLiteralMarqueeSelection(lines),
  },
]

function main() {
  const violations = []
  for (const file of collectFiles()) {
    const relative = path.relative(repoRoot, file)
    const source = blankComments(fs.readFileSync(file, 'utf8'))
    const lines = source.split('\n')
    for (const rule of RULES) {
      for (const hit of rule.find(source, lines)) violations.push({ rule, relative, ...hit })
    }
  }

  if (violations.length === 0) {
    console.log(`✓ 画布手势确定性门岗：${RULES.length} 条规则全通过（硬零）`)
    return
  }

  console.error(`✗ 画布手势确定性门岗：${violations.length} 处违规\n`)
  for (const rule of RULES) {
    const own = violations.filter((violation) => violation.rule.id === rule.id)
    if (!own.length) continue
    console.error(`  [${rule.id}] ${rule.label}`)
    console.error(`    ${rule.why}`)
    for (const violation of own) {
      console.error(`      ${violation.relative}:${violation.line}  ${violation.hit}`)
      console.error(`        ${violation.source}`)
    }
    console.error('')
  }
  console.error('这两条是硬零规则：没有棘轮基线，也不接受「先记一笔欠账」——')
  console.error('它们拦的是「本机绿、别的机器红，而且每次都得有人重查一遍才敢说不是回归」那一族。')
  process.exit(1)
}

main()
