#!/usr/bin/env node
// 测试等待门岗（2026-08-25）。抓的是一整类**并行跑才炸**的测试写法：私有墙钟等待。
//
// 起因：electron/productionRun 十个测试文件各自复制了一份 waitFor(check, 500ms~5s 硬闹钟)，
// 拿「调过参的墙钟猜测」赛跑「真实文件锁 + fsync 编排链」。单跑几十 ms 绿得发亮；
// vitest 并行满载时 fsync 被放大百倍 → 链路合法地超过闹钟 → 间歇翻红（干净 main 上 5 跑 4 挂）。
// 写的人当场看不出毛病（本机单跑永远绿），靠自觉记不住，只能机器每次拦——P2 通用性判定的又一落地件。
//
// 规矩：测试里等后台编排链，一律 import productionRunTestHelpers 的 waitForProduction
// （60s 安全网、超时抛带标签错误）；不许再手写 waitFor / Date.now() 截止时间轮询。
// 2026-08-25 清零后本门岗硬零：任何新增当场报红，无棘轮基线。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function collectTestFiles() {
  const files = []
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'dist-electron') continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.test\.(tsx?|mts|cts|mjs)$/.test(entry.name)) files.push(full)
    }
  }
  for (const dir of ['src', 'electron', 'evals', 'scripts', 'tests']) walk(path.join(repoRoot, dir))
  return files
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

// 生产读文件的常见写法是「按路径 open、按 fd 读」，所以 readFileSync 的第一个参数是数字 fd，
// 永远不等于路径串。测试若拿 spy 的 mock.calls 按路径过滤，过滤器恒空、断言恒真——成本全付、
// 保护为零。2026-09-02 夜就是这么栽的：一条恒真的「不许重扫账本」断言挂在 1000 条命令的循环上，
// 在四个分支上超时，四个会话都判成「并行负载 flake」。实测把账本缓存关掉、每条命令全量重扫，
// 那条断言照样绿（2045 次 readFileSync 里「看到」0 次）。见 docs/lessons/。
const FS_READ_SPY = /spyOn\(\s*fs\s*,\s*['"](readFileSync|readFile|readSync|read)['"]/

const RULES = [
  {
    id: 'private-waitfor',
    label: '测试文件里定义私有 waitFor——共享 waitForProduction 之外的第二套等待',
    test: (line) => /\bfunction waitFor\s*\(/.test(line) || /\bconst waitFor\s*=/.test(line),
  },
  {
    id: 'wallclock-deadline-poll',
    label: '测试文件里手写 Date.now() 截止时间轮询——拿墙钟猜测赛跑真实 I/O，并行必翻红',
    test: (line) => /\bDate\.now\(\)/.test(line) && /\bdeadline\b/i.test(line),
  },
  {
    id: 'fs-read-spy-path-filter',
    label: '按路径过滤 fs 读调用的 spy——生产按 fd 读，过滤器恒空、断言恒真（假绿，不是假红）',
    test: (line, source) =>
      /\.mock\.calls\b/.test(line) && /\.filter\(/.test(line) && /===/.test(line) && FS_READ_SPY.test(source),
  },
]

const hits = []
for (const file of collectTestFiles()) {
  const source = stripComments(fs.readFileSync(file, 'utf8'))
  const lines = source.split('\n')
  lines.forEach((line, i) => {
    for (const rule of RULES) {
      if (rule.test(line, source)) hits.push({ rule, file, line: i + 1, text: line.trim().slice(0, 120) })
    }
  })
}

if (hits.length > 0) {
  console.log('✖ 测试等待门岗未通过：测试不许手写墙钟等待（单跑看不出，并行跑必间歇翻红）')
  for (const hit of hits.slice(0, 20)) {
    console.log(`    ${path.relative(repoRoot, hit.file)}:${hit.line}  [${hit.rule.id}]  ${hit.text}`)
  }
  console.log('  → 等后台编排链请 import electron/productionRun/productionRunTestHelpers 的 waitForProduction')
  console.log('    （60s 安全网只拦真死锁/真回归，不给磁盘排队计时；来龙去脉见 docs/plan/2026-08-25-fix-flaky-production-run-tests.md）')
  console.log('  → fs-read-spy-path-filter：改成按 open 意图数（读打开 vs 写打开用 flag 区分），')
  console.log('    并给「这事永远不发生」的计数断言配一个同 run 的阳性对照，证明计数器真的会动')
  console.log('    （见 docs/lessons/wall-clock-timeout-can-mean-a-dead-assertion.md）')
  process.exit(1)
}
console.log('✅ 测试等待门岗通过：0 处私有墙钟等待 / 0 处按路径过滤 fs 读 spy（硬零，无基线）')
