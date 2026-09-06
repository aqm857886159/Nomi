#!/usr/bin/env node
// 「读 git 的路径列表」写法门岗（2026-09-07）。硬零，无基线。
//
// 起因：pre-push 闸的 `is_docs_only()` 按行读 `git diff --name-only`。git 默认
// `core.quotePath=true`，非 ASCII 路径被输出成 `"docs/\344\270\255\346\226\207.md"`——
// 首尾各一个引号、中间八进制转义。闸门那把尺（`^docs/` / `\.md$`）两头都被引号挡掉，
// **纯中文文件名的文档改动被判成「有代码改动」**，docs-only 的推送白等一遍五门。
//
// 为什么值得一道门岗而不是「记得加 flag」：这是**一整族**，而且每一处的症状都不一样、
// 全都当场看不出来——
//   · 分类型（`--name-only` + 前缀/后缀判断）：判反，像 pre-push 这样多跑门岗，或反过来漏跑；
//   · 读文件型（列完路径再 `fs.existsSync` / `readFileSync`）：路径不存在 → 多数调用点
//     把读失败 try/catch 吞掉 → 门岗**静默少扫几个文件**，不报错也不报红
//     （check:secrets 少扫一个 = 敏感数据从那个文件溜进公开仓库）。
// 两种都只在路径含非 ASCII / 空格时才发作，而本仓 `docs/` 下中文文件名是常态。
//
// 判据（只认这一族，不扩张）：调用 `git` 的 `--name-only` / `--name-status` / `ls-files` /
// `ls-tree ... --name-only`，而这条命令上既没有 `-z`、也没有 `-c core.quotePath=false`。
// `git status --porcelain` 不在本门管辖内——现存调用点只判「空不空」，引号不改变空不空。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCAN_DIRS = ['scripts', '.github']

/** 一行里出现这些 = 它在列路径。 */
/** 故意保留默认写法的唯一出口：只用于「证明 git 默认会转义」的对照测试。 */
const INTENTIONAL_MARKER = 'git-path-quoting:intentional-default'

const PATH_LISTING = /--name-only|--name-status|\bls-files\b/
/** 同一条命令上出现这些 = 已经把引号转义关掉了。 */
const QUOTING_DISABLED = /(^|[\s'"[(])-z($|[\s'"\],)])|core\.quotePath\s*=\s*false/
/**
 * 光有 `git` 三个字母不算调用——报错文案、注释和正则里全是它。
 * JS 侧认「真的在起进程」或「走本文件自己的 git 包装」；shell/yml 侧认命令位置上的 `git`。
 * 判定用**前后各一行**的窗口，因为 `execFileSync('git', [\n  'ls-files', …])` 会跨行写。
 */
const JS_INVOCATION = /\b(execSync|execFileSync|spawnSync|execFile|spawn)\s*\(|\b(git|gitRaw|tryGit|gitOutput|gitStatus)\s*\(/
const SHELL_INVOCATION = /(^|[;&|(`]|\$\()\s*git\s/

export function scanSource(source, file) {
  const isShell = /\.(sh|ya?ml)$/.test(file)
  const hits = []
  const lines = source.split('\n')
  lines.forEach((rawLine, index) => {
    const line = rawLine.trim()
    // 注释行不算调用：本门岗自己的说明、以及各调用点解释「为什么加 -z」的注释都在注释里。
    if (line.startsWith('//') || line.startsWith('#') || line.startsWith('*')) return
    if (!PATH_LISTING.test(line)) return
    // 走共享出口的调用点自己会加 -z，行内看不见。
    const window = lines.slice(Math.max(0, index - 2), index + 2).join('\n')
    if (/\bgitPaths\s*\(|\bgitNameStatus\s*\(/.test(window)) return
    if (QUOTING_DISABLED.test(window)) return
    // 唯一的例外口：**故意**用默认写法去证明 git 会转义（gitPaths 的对照测试就靠这一条）。
    // 写成必须挨着的行内标记而不是路径白名单——白名单会随文件改名悄悄失效，标记不会。
    if (window.includes(INTENTIONAL_MARKER)) return
    if (!(isShell ? SHELL_INVOCATION : JS_INVOCATION).test(window)) return
    hits.push({ file, line: index + 1, text: line.slice(0, 140) })
  })
  return hits
}

function collect() {
  const files = []
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(mjs|cjs|js|ts|sh|yml|yaml)$/.test(entry.name)) files.push(full)
    }
  }
  for (const dir of SCAN_DIRS) walk(path.join(repoRoot, dir))
  return files
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const hits = []
  for (const file of collect()) {
    // 门岗自己那几条判据字面量、以及它的阳性对照（整篇都是喂给 scanSource 的样本串）不算调用点。
    if (file === fileURLToPath(import.meta.url)) continue
    if (path.basename(file) === 'check-git-path-quoting.node-test.mjs') continue
    hits.push(...scanSource(fs.readFileSync(file, 'utf8'), file))
  }
  if (hits.length === 0) {
    console.log('✅ git 路径读取门岗通过：所有 --name-only / --name-status / ls-files 调用都关掉了引号转义（-z 或 core.quotePath=false）。')
    process.exit(0)
  }
  console.log('\n✖ 有调用点按默认 core.quotePath 读 git 的路径列表——非 ASCII 路径会变成 `"docs/\\344..."`：')
  for (const hit of hits) console.log(`    ${path.relative(repoRoot, hit.file)}:${hit.line}  ${hit.text}`)
  console.log('\n  → JS 走 `scripts/lib/gitPaths.mjs` 的 gitPaths() / gitNameStatus()；shell 直接加 `-z` 并按 NUL 读。')
  process.exit(1)
}
