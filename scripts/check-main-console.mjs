#!/usr/bin/env node
// 主进程 console 门岗（2026-09-06）。
//
// 起因：`electron/` 里长年散着 99 处 `console.error/warn/log`。开发时终端能看到，
// **打包成 .app 双击启动后没有任何地方接住它们**，进程一退就没了。于是「不崩溃的失败」
// （模型调不通、导出中途放弃）这一整档在用户机器上是零证据的——而它恰好是用户报障的大头。
//
// 那 99 处已在同一个 PR 里全部收进 `electron/logging/logger.ts` 这一个出口。本门岗守住它不复长：
// 收口的价值全在「**一个**出口」上，第 2 个出口一出现，落盘、脱敏、滚动就又各说各话了。
//
// 为什么是硬零而不是棘轮：棘轮是给「存量还没清完」用的。这里存量已经清到 0，
// 留一个可以往上涨的数字反而是邀请（R28：能让门岗拦的别留给人）。
//
// 两种**不算违规**的写法，判据是形状而不是白名单：
//   ① `console.log = toErr` 这类**赋值**——`mcpStdioServer.ts` 用它把第三方依赖的输出
//      从 stdout（JSON-RPC 通道）赶到 stderr。那是保护，不是日志调用。规则只认 `console.x(`。
//   ② **模板串里**的 `console.info(...)`——`browserViewBridges.ts` 注入到 BrowserView 页面里
//      执行的脚本。那是页面代码，不是主进程代码。所以扫描前先把模板串内容抹掉。
//
// 用法：node ./scripts/check-main-console.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 抹注释与模板串内容，**逐行等高**——行号一挪，报出来的 file:line 点开就是别的地方，
 * 而行号不准的门岗人只会不信它（同 check-heavy-path.mjs 踩过的两个坑）。
 */
export function stripCommentsAndTemplates(source) {
  const blanked = (text) => text.replace(/[^\n]/g, ' ')
  return source
    .replace(/\/\*[\s\S]*?\*\//g, blanked)
    .replace(/^[^\S\n]*\/\/.*$/gm, (line) => blanked(line))
    .replace(/`(?:\\[\s\S]|[^\\`])*`/g, blanked)
}

const CONSOLE_CALL = /\bconsole\s*\.\s*[a-zA-Z]+\s*\(/

export function scanSource(source) {
  return stripCommentsAndTemplates(source)
    .split('\n')
    .map((line, index) => ({ line: index + 1, text: line.trim() }))
    .filter((entry) => CONSOLE_CALL.test(entry.text))
}

function collect(dir) {
  const files = []
  const walk = (current) => {
    if (!fs.existsSync(current)) return
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      // 测试文件不算：它们跑在终端里，console 就是给人看的。
      else if (/\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) files.push(full)
    }
  }
  walk(dir)
  return files
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const hits = []
  for (const file of collect(path.join(repoRoot, 'electron'))) {
    for (const hit of scanSource(fs.readFileSync(file, 'utf8'))) {
      hits.push({ file: path.relative(repoRoot, file), ...hit })
    }
  }

  if (hits.length) {
    console.log('\n✖ 主进程里出现了 console.* 调用（硬零）：')
    for (const hit of hits.slice(0, 20)) console.log(`    ${hit.file}:${hit.line}  ${hit.text.slice(0, 120)}`)
    if (hits.length > 20) console.log(`    …还有 ${hits.length - 20} 处`)
    console.log(
      '\n  → 改用 electron/logging/logger.ts 的出口：\n' +
        '      logInfo / logWarn / logError(scope, event, error?, fields?)\n' +
        '      logVendorCall({ vendor, model, status, ms, requestId?, costUsd? })\n' +
        '      logDevDetail(scope, detail)   ← 只喷 stderr、不落盘；给带本机路径或渲染层自由文本的那一族\n' +
        '  console.* 在打包后没有任何地方接住，等于把证据丢进黑洞——这正是本门岗存在的原因。',
    )
    process.exit(1)
  }
  console.log('✅ 主进程 console 门岗通过：electron/ 下 0 处 console.* 调用（唯一出口是 logging/logger.ts）')
}
