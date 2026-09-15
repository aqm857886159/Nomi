#!/usr/bin/env node
// 媒体导入单一 owner 门岗（2026-09-14）。
//
// 起因（用户原话）：「粘贴/拖入素材库只收图片、视频一律不支持——这地方要通用支持，不能只支持一部分。」
// 挖下去不是一个 bug，是一族：**每个入口自己判「收什么类型」和「收多大」**。
//   · Finder 拖入/粘贴素材库走 localFileCopy.ts，自己写了一句 `assetKindFromContentType(ct) !== "image"`；
//   · 画布自己写了 30MB / 600MB 两个常量，而素材库「上传」按钮转手给它，于是画布的上限变成素材库的上限；
//   · 音频 200MB、Agent 附件 30MB、全景 80MB、MCP 64MB 各是第三到第六份。
// 修一处，下一处还会从另一个调用者回来——所以判断必须收口，再由机器守住。
//
// 三条规则，全部按棘轮跑（基线只减不增），与 check:heavy-path / check:tokens 同一套做法：
//   ① hardcoded-media-accept   —— `accept="image/*"` 这类字面量；应改 acceptAttrForSurface()
//   ② hardcoded-media-max-bytes —— 媒体相关的 `*_MAX_BYTES = <数字>` 常量；上限该从磁盘/owner 派生
//   ③ adhoc-media-kind-branch  —— `x.startsWith('image/') ? … : 'image'` 这类自判 kind；应用
//                                  dropKindFromFile / mediaTypes 单源
//
// 为什么值得一道门岗而不是写进文档：这三种写法**单看每一处都合理**——组件里写个 accept 很自然，
// 给上传加个上限很负责。只有把它们摆在一起才看得出「同一个判断有六份、彼此已经漂移」。
// 靠自觉记不住，只能靠机器每次拦。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE_FILE = path.join(repoRoot, 'scripts/media-import-owner-baseline.json')

// owner 本体与它的直接派生层：规则不适用于它们（它们就是那份声明）。
const OWNER_FILES = new Set([
  path.join(repoRoot, 'electron/shared/contracts/mediaImportPolicy.ts'),
  path.join(repoRoot, 'electron/assets/mediaTypes.ts'),
  path.join(repoRoot, 'electron/assets/videoPlaybackSupport.ts'),
  path.join(repoRoot, 'src/media/videoCodecProbe.ts'),
  // kind 判定的单源本体：它就是那份 startsWith 链，别的地方才不许再写一遍。
  path.join(repoRoot, 'src/workbench/generationCanvas/model/nodeAssetDrop.ts'),
  path.join(repoRoot, 'electron/assets/assetPaths.ts'),
])

function collect() {
  const files = []
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'dist-electron') continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(tsx?|mts|cts)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) files.push(full)
    }
  }
  walk(path.join(repoRoot, 'src'))
  walk(path.join(repoRoot, 'electron'))
  return files.filter((f) => !OWNER_FILES.has(f))
}

// 抹注释逐行等高——行号一挪，报出来的 file:line 点开就是别的地方（同 check-heavy-path 的教训）。
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ''))
    .replace(/^[^\S\n]*\/\/.*$/gm, '')
}

const RULES = [
  {
    id: 'hardcoded-media-accept',
    label: '手写 accept 媒体字面量——每个组件一份，和 owner 声明必然漂移',
    hint: "改成 acceptAttrForSurface('<面>')（electron/shared/contracts/mediaImportPolicy.ts），面收哪些 kind 在那里声明。",
    scan(code, file) {
      const hits = []
      code.split('\n').forEach((line, i) => {
        // accept={'image/*'} / accept="image/*,video/*" / ACCEPT = 'audio/*' 都算
        if (!/\b(accept|ACCEPT)\b[^\n]{0,40}['"`][^'"`\n]*\b(image|video|audio)\/\*/.test(line)) return
        hits.push({ line: i + 1, text: line.trim().slice(0, 120), file })
      })
      return hits
    },
  },
  {
    id: 'hardcoded-media-max-bytes',
    label: '媒体导入上限写成常量——和用户磁盘上真实的余量毫无关系',
    hint: '删掉常量，改 admitMediaImport(surface, candidate, capacity)：上限从磁盘余量派生；'
      + '确有下游硬约束的（模型上下文 / GPU 纹理）在 MEDIA_IMPORT_SURFACES 里登记 hardCapBytes + 理由。',
    scan(code, file) {
      const hits = []
      code.split('\n').forEach((line, i) => {
        // 形状：`XXX_MAX_BYTES = <算术字面量>`，且名字带媒体语义（IMAGE/VIDEO/AUDIO/MEDIA/ASSET/IMPORT/ATTACHMENT/PANORAMA）
        const match = /\b([A-Z0-9_]*(?:IMAGE|VIDEO|AUDIO|MEDIA|ASSET|IMPORT|ATTACHMENT|PANORAMA)[A-Z0-9_]*_MAX_BYTES)\s*=\s*[\d_]/.exec(line)
        if (!match) return
        hits.push({ line: i + 1, text: line.trim().slice(0, 120), file })
      })
      return hits
    },
  },
  {
    id: 'adhoc-media-kind-branch',
    label: "自己判媒体 kind（startsWith('image/') 链，且认不出就当图片）——mkv/空 MIME 被静默当成图送错通道",
    // 提示必须分主进程 / 渲染层两条路说：dropKindFromFile 住在 src/，electron/ 按 R26 不许 import 它，
    // 于是主进程的违规者照着提示做是做不到的（2026-09-15：两处新违规正是在 electron/assets 长出来的）。
    hint: '主进程（electron/）用 mediaKindFromContentType() / mediaKindFromExtension()'
      + '（electron/assets/mediaTypes.ts）——contentType → kind 的唯一判据，认不出返回 null；'
      + '渲染层（src/）用 dropKindFromFile()（src/workbench/generationCanvas/model/nodeAssetDrop.ts）。'
      + '字节和扩展名是事实，MIME 会撒谎；认不出就返回 null 交给调用方拒，别兜底成图片。',
    scan(code, file) {
      const hits = []
      const lines = code.split('\n')
      lines.forEach((line, i) => {
        if (!/startsWith\s*\(\s*['"`](?:image|video|audio)\//.test(line)) return
        // 只抓「兜底成 image」这种会把视频送进图片通道的写法——宁可漏报，不要噪音。
        const window = lines.slice(i, Math.min(lines.length, i + 4)).join('\n')
        if (!/:\s*['"`]image['"`]|\?\s*['"`]image['"`]|\bimage['"`]\s*$/m.test(window)) return
        hits.push({ line: i + 1, text: line.trim().slice(0, 120), file })
      })
      return hits
    },
  },
]

const files = collect()
const found = new Map(RULES.map((rule) => [rule.id, []]))
for (const file of files) {
  const code = stripComments(fs.readFileSync(file, 'utf8'))
  for (const rule of RULES) {
    for (const hit of rule.scan(code, file)) found.get(rule.id).push(hit)
  }
}

const baseline = fs.existsSync(BASELINE_FILE) ? JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')) : {}
if (process.argv.includes('--update-baseline')) {
  const next = Object.fromEntries(RULES.map((rule) => [rule.id, found.get(rule.id).length]))
  fs.writeFileSync(BASELINE_FILE, `${JSON.stringify(next, null, 2)}\n`)
  console.log(`✅ 已写入基线：${JSON.stringify(next)}`)
  process.exit(0)
}

let failed = false
const summary = []
for (const rule of RULES) {
  const hits = found.get(rule.id)
  const allowed = Number.isFinite(baseline[rule.id]) ? baseline[rule.id] : 0
  summary.push(`${rule.id}=${hits.length}`)
  if (hits.length <= allowed) continue
  failed = true
  console.log(`\n✖ ${rule.label}`)
  console.log(`  基线 ${allowed} → 现在 ${hits.length}（新增 ${hits.length - allowed} 处，棘轮只减不增）`)
  for (const hit of hits.slice(0, 15)) {
    console.log(`    ${path.relative(repoRoot, hit.file)}:${hit.line}  ${hit.text}`)
  }
  console.log(`  → ${rule.hint}`)
}

if (failed) {
  console.log('\n媒体导入 owner 门岗未通过。单看每一处都合理——摆在一起才看得出同一个判断有好几份、彼此已经漂移。')
  process.exit(1)
}
console.log(`✅ 媒体导入 owner 门岗通过：${summary.join(' · ')}（棘轮只减不增）`)
