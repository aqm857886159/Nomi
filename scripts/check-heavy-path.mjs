#!/usr/bin/env node
// 重活门岗（2026-08-20）。抓的是一整类**用户体感「卡死」**的写法。
//
// 起因：用户报「切图九宫格直接卡死，卡了半小时」。挖到底发现不是一个 bug，是**一族**：
//   ① 同步 PNG 编码（canvas.toDataURL）在主线程上跑，9 张 4K 切片就冻 700ms；
//   ② 产物是 base64，塞进 store → 每次写入被 emitCanvasGesture 做一遍 JSON 深拷贝、
//      压进撤销日志、IPC 发去事件日志，主进程再同步 redact/sha256/writeFileSync 一份全文；
//   ③ 于是渲染层冻 1.6s、主进程冻到分钟级——用户看到的就是「点完就死」。
// 同族的其他入口当时还活着：全景截图把 8K base64 永久留在 store、联系表同款先塞后换。
//
// 这三条规则各自都能单独 grep，所以能做成门岗；按棘轮跑（基线只减不增），
// 和 check:tokens / check:i18n / check:walkthroughs 同一套做法。
//
// 为什么值得一道门岗而不是写进文档：这类写法**当场看不出问题**——小图上跑得飞快，
// 大图上才冻死；写的人手里多半是小图。靠自觉记不住，只能靠机器每次拦。
//
// 2026-08-25 再扩一档：「炸」也包括**炸在 CI 上**。unguarded-fsync 拦的是绕过落盘屏障的
// 直接 fsync——本地单跑照样全绿，只有 CI 磁盘队列深的那一刻才撞 testTimeout（productionRun
// flake 的原病）。判据没变，还是那一条：**写的人当场看不出来**。
//
// 2026-08-24 扩了族的定义：本门岗管的是「**本地看不出、线上才炸**」的写法，不限于「卡死」。
// 新增 node-stream-into-response——把 Node 流交给 undici 管生命周期，小文件/不 seek 时完全正常，
// 大视频一拖进度条就可能抛不可捕获的 ERR_INVALID_STATE 弹框。同一条判据：写的人当场看不出来。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { scanHardcodedProviderLimits } from './hardcoded-provider-limits.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE_FILE = path.join(repoRoot, 'scripts/heavy-path-baseline.json')

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
  return files
}

// 抹注释必须**逐行等高**，不能改变总行数——行号一挪，报出来的 file:line 点开就是别的地方。
// 行号不准的门岗等于没门岗：人点一次发现对不上，下次就不信它了。两个坑都踩过：
//   ① 块注释整段删 → 后面所有行往前挪一整个 JSDoc 的高度；改成只抹字符、保留换行。
//   ② 行注释用 `^\s*//`：`\s` 是**含换行**的，于是 `^` 锚在空行、`\s*` 顺手吃掉那个换行和
//      下一行的缩进——凡是「空行 + // 注释」就吞掉一行。必须用 `[^\S\n]*`（只吃水平空白）。
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ''))
    .replace(/^[^\S\n]*\/\/.*$/gm, '')
}

const RULES = [
  {
    id: 'hardcoded-provider-limits',
    hardZero: true,
    label: '生产代码硬编码供应商并发/速率限额——换模型或账号后策略失真',
    hint: '从带来源的供应商契约数据派生，仅允许用户偏好压低；未知不补默认数值。此规则无白名单、不可更新基线。',
    scan: scanHardcodedProviderLimits,
  },
  {
    id: 'sync-image-encode',
    label: '同步图像编码（canvas.toDataURL）——编码期间整个界面冻住',
    hint: '改用 canvas.convertToBlob() / toBlob()（异步，编码不占主线程），拿到 Blob 再落盘。',
    scan(code, file) {
      const hits = []
      code.split('\n').forEach((line, i) => {
        if (/\.toDataURL\s*\(/.test(line)) hits.push({ line: i + 1, text: line.trim().slice(0, 120), file })
      })
      return hits
    },
  },
  {
    id: 'base64-into-store',
    label: 'base64 写进画布 store——每次写入都被整段 JSON 深拷贝 + 随每次保存全量序列化',
    hint: '先 persistNodeImageBlob() 落盘换 nomi-local:// 门牌号，store 只存门牌号、只写一次。',
    scan(code, file) {
      // 形状：同一个 updateNode/addNode 调用里，url/result 直接吃了 dataUrl/base64 变量。
      // 只认「变量名像 base64」这一类明显写法——宁可漏报，不要噪音（噪音会让整条规则被无视）。
      const hits = []
      const lines = code.split('\n')
      lines.forEach((line, i) => {
        if (!/\b(url|src)\s*:\s*(data[Uu]rl|base64|pngBase64|b64)\b/.test(line)) return
        const window = lines.slice(Math.max(0, i - 12), i + 1).join('\n')
        if (/updateNode\s*\(|addNode\s*\(|result\s*:/.test(window)) {
          hits.push({ line: i + 1, text: line.trim().slice(0, 120), file })
        }
      })
      return hits
    },
  },
  {
    id: 'duplicate-node-size-bounds',
    label: '在 nodeSizing 之外复刻节点尺寸上下界——布局和渲染各算各的，必然错位',
    hint: '尺寸只有一个真相源：从 nodeSizing 导入常量，卡片实际渲染多大问 resolveNodeVisualSize()。',
    scan(code, file) {
      if (file.endsWith(path.join('nodes', 'nodeSizing.ts'))) return []
      const hits = []
      code.split('\n').forEach((line, i) => {
        if (/\b(const|let)\s+(MIN|MAX)_NODE_(WIDTH|HEIGHT)\s*=/.test(line)) {
          hits.push({ line: i + 1, text: line.trim().slice(0, 120), file })
        }
      })
      return hits
    },
  },
  {
    id: 'child-stdin-write-unguarded',
    label: '往子进程 stdin write/end 但没挂流级 error 监听——子进程先死时 EPIPE 升级成进程级 unhandled',
    hint: "先 child.stdin?.on('error', () => {}) 再写：真实故障让 child 的 error/exit 事件如实上报，流级 EPIPE 只是回声（复现见 capabilityCore/mcpVerify.stdinError.test.ts）。",
    scan(code, file) {
      // 为什么当场看不出来：小包写平时走同步快路，对端刚死也静默成功；只有写入落进 libuv
      // 异步队列（并行负载/缓冲挤压）、完成时对端已被收尸，EPIPE 才在流上**异步** emit——
      // write 外面的 try/catch 一律接不住。2026-08-25 真实现场：vitest 3047 全过仍 exit 1；
      // 真机上同一条路是主进程 uncaughtException。文件级判据：写过 stdin 的文件必须也挂过
      // stdin 的 error 监听（宁可漏报，不要噪音——同 base64-into-store 的取舍）。
      if (/\.stdin\??\.\s*(?:on|once)\s*\(\s*['"]error['"]/.test(code)) return []
      const hits = []
      code.split('\n').forEach((line, i) => {
        if (/\bprocess\.stdin\b/.test(line)) return
        if (/\.stdin\??\.\s*(?:write|end)\s*\(/.test(line)) {
          hits.push({ line: i + 1, text: line.trim().slice(0, 120), file })
        }
      })
      return hits
    },
  },
  {
    id: 'node-stream-into-response',
    label: '把 Node 流交给别人管生命周期（new Response(流) / Readable.toWeb）——取消时抛不可捕获的 ERR_INVALID_STATE',
    hint: '用 createOwnedFileStream()（electron/protocol/fileResponseStream.ts）自己拥有流：'
      + '它用一个同步置位的 closed 闸，让 close 与 cancel 不可能互相竞争。',
    scan(code, file) {
      // 为什么必须拦：undici 的 extractBody 见到「异步可迭代」就转交 ReadableStreamFrom，
      // 那里的 close 是 queueMicrotask 里的裸调用、cancel() 又不置任何标记，于是
      // 「in-flight 的 pull 解析出 done → 延迟 close 打在已关闭的 controller 上」→ 从 microtask 抛出，
      // call site 的 try/catch 一律接不住。该缺陷在 undici 6.19.8 / 7.29.0 / 8.10.0 / main 中一致存在，
      // 升 Electron 修不掉——唯一的解是别把流交出去。详见
      // docs/plan/2026-08-24-local-protocol-stream-ownership.md。
      //
      // 同族的第二条路：`Readable.toWeb(fs.createReadStream(...))`。它绕开了 undici，
      // 却换成 Node 自己的适配器——nodejs/node#64529「toWeb(): 背压恢复期间被取消会抛
      // uncaughtException(ERR_INVALID_STATE)」**至今 OPEN、修复 PR 未合**，抛的是同一个错误码。
      // 本仓一度就走在这条路上（origin/main 的 fileBody()），所以必须一起拦：
      // 判据不是「用了哪个 API」，而是「**流的关闭权在不在我们手里**」。
      //
      // 只认 createReadStream / Readable.from / Readable.toWeb 这几类**明确的** Node 流来源：
      // 「任意 Node Readable」静态判不出来，宁可漏报也不要噪音（同 base64-into-store 的取舍）。
      const hits = []
      const lines = code.split('\n')
      const streamVars = new Map()
      lines.forEach((line, i) => {
        if (/Readable\.toWeb\s*\(/.test(line)) {
          hits.push({ line: i + 1, text: line.trim().slice(0, 120), file })
          return
        }
        if (/new Response\s*\(\s*(?:(?:fs|fsp)\.)?(?:createReadStream|Readable\.from)\s*\(/.test(line)) {
          hits.push({ line: i + 1, text: line.trim().slice(0, 120), file })
          return
        }
        const assigned = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=[^=].*?(?:createReadStream|Readable\.from)\s*\(/.exec(line)
        if (assigned) streamVars.set(assigned[1], i)
        const used = /new Response\s*\(\s*([A-Za-z_$][\w$]*)\b/.exec(line)
        if (used && streamVars.has(used[1]) && i - streamVars.get(used[1]) <= 8) {
          hits.push({ line: i + 1, text: line.trim().slice(0, 120), file })
        }
      })
      return hits
    },
  },
  {
    id: 'unguarded-fsync',
    label: '绕过落盘屏障直接 fsync——测试里关不掉，productionRun 的 flake 从这里长回来',
    hint: '文件 fd 用 fsyncIfDurable(fd)（electron/durability.ts）；'
      + '只为 fsync 而开的目录 fd，在 openSync 之前先 if (!isDurable()) return，整段省掉。',
    scan(code, file) {
      // 为什么必须拦（#139 的收口）：fsync 是唯一决定「字节要不要真落到物理介质」的调用，
      // 全仓靠 electron/durability.ts 这一个屏障统一开关。测试把它翻成 'ephemeral' 后
      // productionRun 子集 98.7s → 4.95s，撞 5000ms testTimeout 的 flake 才消失。
      // 新加一处直接 fs.fsyncSync 就绕开了屏障：那条写路径在测试里重新变慢，flake 长回来一角，
      // 而**本地单跑照样全绿**——只有 CI 磁盘队列深的那一刻才红。典型的「当场看不出毛病」。
      //
      // 判据不是「在哪个文件」，是「**这次 fsync 有没有过屏障**」：
      //   ① fsyncIfDurable(fd)              —— 正道，本规则根本匹配不到；
      //   ② if (!isDurable()) return; …fsyncSync(dirFd) —— 目录 fd 那一族的合法形态。
      //      目录 fd 存在的唯一目的就是被 fsync，所以要连 openSync 一起省掉，
      //      没法用 fsyncIfDurable 表达，只能自己判闸 —— 屏障一样被尊重。
      // 于是基线是 0 而不是「现存 2 处」：那 2 处不是待清的存量，是本来就合规的写法，
      // 收进基线等于把正确代码标成债（永远清不到 0），还会留个洞——删掉一处合法的、
      // 新增一处违规的，计数不变，门岗照样绿。按闸判则两种情况都当场报红。
      if (file === path.join(repoRoot, 'electron', 'durability.ts')) return [] // 屏障本体
      const hits = []
      const lines = code.split('\n')
      lines.forEach((line, i) => {
        if (!/\bfsyncSync\s*\(/.test(line)) return
        // 往回退到本顶层声明的开头（上一个顶格 `}` 之后），闸必须落在这段里。
        let start = i - 1
        while (start >= 0 && !/^\}/.test(lines[start])) start -= 1
        if (/\bisDurable\s*\(\s*\)/.test(lines.slice(start + 1, i).join('\n'))) return
        hits.push({ line: i + 1, text: line.trim().slice(0, 120), file })
      })
      return hits
    },
  },
]

const files = collect()
const found = new Map(RULES.map((rule) => [rule.id, []]))
for (const file of files) {
  const raw = fs.readFileSync(file, 'utf8')
  const code = stripComments(raw)
  for (const rule of RULES) {
    for (const hit of rule.scan(rule.hardZero ? raw : code, file)) found.get(rule.id).push(hit)
  }
}

const baseline = fs.existsSync(BASELINE_FILE) ? JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')) : {}
if (process.argv.includes('--update-baseline')) {
  if (RULES.some((rule) => rule.hardZero && found.get(rule.id).length > 0)) {
    console.error('硬零规则命中，不允许写入基线。')
    process.exit(1)
  }
  const next = Object.fromEntries(RULES.filter((rule) => !rule.hardZero).map((rule) => [rule.id, found.get(rule.id).length]))
  fs.writeFileSync(BASELINE_FILE, `${JSON.stringify(next, null, 2)}\n`)
  console.log(`✅ 已写入基线：${JSON.stringify(next)}`)
  process.exit(0)
}

let failed = false
const summary = []
for (const rule of RULES) {
  const hits = found.get(rule.id)
  const allowed = !rule.hardZero && Number.isFinite(baseline[rule.id]) ? baseline[rule.id] : 0
  summary.push(`${rule.id}=${hits.length}`)
  if (hits.length <= allowed) continue
  failed = true
  console.log(`\n✖ ${rule.label}`)
  console.log(`  基线 ${allowed} → 现在 ${hits.length}（新增 ${hits.length - allowed} 处，棘轮只减不增）`)
  for (const hit of hits.slice(0, 12)) {
    console.log(`    ${path.relative(repoRoot, hit.file)}:${hit.line}  ${hit.text}`)
  }
  console.log(`  → ${rule.hint}`)
}

if (failed) {
  console.log('\n重活门岗未通过。这些写法在你手上跑都正常——大图才冻死界面/主进程，CI 磁盘忙才撞超时。')
  process.exit(1)
}
console.log(`✅ 重活门岗通过：${summary.join(' · ')}（棘轮只减不增）`)
