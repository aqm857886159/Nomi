#!/usr/bin/env node
// 付费出口门岗（2026-09-12）：**自己拼 request 去发任务的调用方，必须带上 grantId。**
//
// 它在拦哪个真实事故：
//   2026-09-09 `2d907292a` 给 runtime 的文本路补上了付费闸（`consumeTaskSpend`），
//   而 `deconstructVideo` / `shotVerifyDeps` 的三处 `runTask` 从来就没带过 `grantId`——
//   它们当时靠的是「文本路早于 grant 校验返回」这条**注释里的前提**，那条前提当天被删了。
//   于是 09-11 起用户每点一次「拆解」，每一镜都在发请求前 0.2s 被闸抛回，
//   再被上层的 `catch` 吞成一格「没读出」。界面上没有一个字指向真因。
//
// 为什么做成门岗而不是写进文档（R28：防线建在最早能拦住的那层）：
//   · 漏带 grantId **编译期看不出来**（`extras` 是 `Record<string, unknown>`）；
//   · 运行期才炸，而且炸得像「模型没答出来」；
//   · 每开一个新的付费出口都要重踩一次。
//   编译器拦不住的，就让机器每次提交都拦。
//
// 判据（硬零，不设基线）：
//   一个调用点只要**自己写了 `request:`**（= 它自己决定发什么任务，而不是转发别人的 payload），
//   那段调用文本里就必须出现 `grantId`。转发型调用（`runTask(payload)`）匹配不到 `request:`，
//   天然不在管辖内——payload 从哪来，grantId 就从哪来。
//
// 怎么验它真的会红：把 `electron/video/deconstructVideo.ts` 里任一处 `grantId,` 删掉再跑。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 发任务的函数名。`runTaskFn` 是注入形态（capabilityCore 的测试桩同名），语义完全一样。 */
const CALLEES = ['runTask', 'runTaskFn']

function collect() {
  const files = []
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'dist-electron') continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(tsx?|mts|cts)$/.test(entry.name) && !/\.test\.(tsx?|mts|cts)$/.test(entry.name)) files.push(full)
    }
  }
  walk(path.join(repoRoot, 'src'))
  walk(path.join(repoRoot, 'electron'))
  return files
}

// 抹注释必须逐行等高（行号一挪，报出来的 file:line 点开就是别的地方）。同 check-heavy-path。
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ''))
    .replace(/^[^\S\n]*\/\/.*$/gm, '')
}

/** 从 `(` 起读到配对的 `)`，返回参数原文（不做词法分析，够用：这些调用里没有裸括号的字符串）。 */
function balancedArgs(code, openIndex) {
  let depth = 0
  for (let i = openIndex; i < code.length; i += 1) {
    const ch = code[i]
    if (ch === '(') depth += 1
    else if (ch === ')') {
      depth -= 1
      if (depth === 0) return code.slice(openIndex + 1, i)
    }
  }
  return ''
}

function scan(code, file) {
  const hits = []
  for (const callee of CALLEES) {
    const pattern = new RegExp(`\\b${callee}\\s*\\(`, 'g')
    let match
    while ((match = pattern.exec(code)) !== null) {
      const open = match.index + match[0].length - 1
      const args = balancedArgs(code, open)
      // 自己没拼 request 的 = 转发型调用，不在管辖内。
      if (!/\brequest\s*:/.test(args)) continue
      if (/\bgrantId\b/.test(args)) continue
      hits.push({
        file,
        line: code.slice(0, match.index).split('\n').length,
        text: args.replace(/\s+/g, ' ').trim().slice(0, 120),
      })
    }
  }
  return hits
}

const hits = []
for (const file of collect()) {
  // 门岗本体与 runTask 的定义处不在管辖内（定义处读的正是 extras.grantId）。
  if (file === path.join(repoRoot, 'electron', 'runtime.ts')) continue
  hits.push(...scan(stripComments(fs.readFileSync(file, 'utf8')), file))
}

if (hits.length) {
  console.log('\n✖ 付费出口缺少 grantId：这些调用点自己拼了 request，却没有带授权令牌。')
  console.log('  后果不是「报错」，是**被闸在发请求之前拦掉、再被上层 catch 吞成一句人话之外的空白**')
  console.log('  （2026-09-11 用户看到的满屏「没读出」就是这样来的）。')
  for (const hit of hits) {
    console.log(`    ${path.relative(repoRoot, hit.file)}:${hit.line}  ${hit.text}`)
  }
  console.log('\n  → 正道：让发起这次动作的那一层先过钱的闸拿到 grantId（主进程 electron/spendConfirmGrant.ts，')
  console.log('    渲染层 src/workbench/generationCanvas/spend/spendConfirm.ts），再把 grantId + nodeId 放进 extras。')
  console.log('    绝不许在 spendGrant 里开「某某 kind 免闸」的后门——那正是 2d907292a 要关的洞。')
  process.exit(1)
}
console.log('✅ 付费出口门岗通过：每一处自拼 request 的 runTask 都带着 grantId（硬零）。')
