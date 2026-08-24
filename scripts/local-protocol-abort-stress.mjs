// nomi-local 协议：高强度取消压测，专门去撞 ERR_INVALID_STATE 那条竞态。
//
// 和 scripts/local-protocol-seek-walkthrough.mjs 的分工：
//   走查 = 真实用户旅程（30 次 seek + 60 次 abort），负责证明「修复没把流式播放搞坏」；
//   本脚本 = 仪器（数千次取消 + 时序扫描 + 阳性对照），负责回答「这条竞态在本平台上到底炸不炸」。
// 走查在 macOS 上对照组也是绿的（见 docs/plan/2026-08-24-local-protocol-stream-ownership.md §7b），
// 也就是**没有鉴别力**。没有鉴别力的绿灯什么都不证明，所以才有这个脚本。
//
// 三件事按顺序做，缺一不可：
//
//   ① 现场自证 —— 先证明「我确实跑在我以为的那一版代码上」。
//      构建产物里到底是 new Response(fs流) / Readable.toWeb / createOwnedFileStream，
//      直接从 dist-electron 里读出来打印。跑错版本的 A/B 是最贵的假证据。
//      （记忆：断言前先证明你在你以为的现场。）
//
//   ② 阳性对照 —— 在主进程里用**手控时序**的异步可迭代喂 new Response()，
//      故意去撞同一条竞态。它**必须炸**。炸了才说明：这台机器能炸、收集器接得住、
//      这套判据有鉴别力。如果阳性对照都不炸，那后面所有绿灯一律不作数——
//      那是仪器坏了，不是代码好了。这一条是整个脚本的地基。
//
//   ③ 真实路径压测 —— 对真的 nomi-local:// 发数千条请求并在途中取消，
//      扫描取消时刻（0…21ms）、混合整文件/大区间/小区间、高并发制造 I/O 争用把竞态窗口撑宽。
//
// 竞态机制（决定了怎么压才压得中）：
//   pull() 调 iterator.next() → промise pending 期间消费方 cancel() → controller 进入 closed
//   → cancel 触发 iterator.return() → **那个 pending 的 next() 随即以 done=true 解析**
//   → queueMicrotask(() => controller.close()) 打在已关闭的 controller 上 → 抛。
//   所以要撞中它，取消必须落在「next() 已发出、尚未解析」的窗口里。窗口宽度 ≈ 一次磁盘读的耗时，
//   因此用大文件 + 随机偏移 + 高并发（都是为了让读变慢），而不是小文件顺序读。
//
// 用法：pnpm build && node scripts/local-protocol-abort-stress.mjs
import { launchNomiApp, repoRoot } from '../tests/ux/_launchApp.mjs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const ffmpeg = require('@ffmpeg-installer/ffmpeg').path
const outDir = path.join(repoRoot, '.local-protocol-abort-stress')
fs.mkdirSync(outDir, { recursive: true })
const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stress-settings-'))
const projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stress-projects-'))

const SEED_NAME = 'stress-seed.mp4'
const BIG_NAME = 'stress-big.mp4'
const seedPath = path.join(outDir, SEED_NAME)
const bigPath = path.join(outDir, BIG_NAME)
const MIN_BIG_BYTES = 150 * 1024 * 1024

// 压测规模。CI 上想加压走环境变量，别改默认值（默认值要和历史结果可比）。
const ROUNDS = Number(process.env.STRESS_ROUNDS ?? 2400)
const CONCURRENCY = Number(process.env.STRESS_CONCURRENCY ?? 12)

let failed = false
const fail = (msg) => { failed = true; console.log(`  ✖ ${msg}`) }

// ──────────────────────────────────────────────────────────────────────
// ① 现场自证：构建产物里到底是哪一版？
// ──────────────────────────────────────────────────────────────────────
const builtProtocol = path.join(repoRoot, 'dist-electron', 'protocol', 'localProtocol.js')
if (!fs.existsSync(builtProtocol)) {
  console.log(`\n❌ 没有构建产物 ${builtProtocol} —— 先 pnpm build。走查跑的是产物不是源码。`)
  process.exit(1)
}
// tsc 默认**保留注释**，而 PR #126 的 localProtocol.ts 在注释里逐条列举了走过的三条弯路
//（含 "Readable.toWeb(nodeStream)"）。拿裸文本匹配会把注释当代码 → 形态识别不唯一 → 整轮作废。
// 所以先剥注释再认形态。第一版就栽在这，是被下面那句「命中不唯一就停」当场拦下的。
const builtSource = fs.readFileSync(builtProtocol, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')   // 块注释
  .replace(/^\s*\/\/.*$/gm, '')       // 整行行注释（只吃行首的，避免误伤 "nomi-local://" 这类字面量）
const shapes = [
  { id: 'owned', label: 'createOwnedFileStream（自有流 · PR #126 的修复）', hit: /createOwnedFileStream/.test(builtSource) },
  { id: 'toweb', label: 'Readable.toWeb（Node 适配器 · Race C · nodejs/node#64529）', hit: /toWeb\s*\(/.test(builtSource) },
  { id: 'undici', label: 'new Response(fs 流)（undici ReadableStreamFrom · Race B · 用户栈就是这条）', hit: /createReadStream/.test(builtSource) && !/createOwnedFileStream/.test(builtSource) && !/toWeb\s*\(/.test(builtSource) },
]
const detected = shapes.filter((s) => s.hit)
console.log('  🔬 构建产物里的响应体形态：')
for (const s of detected) console.log(`      → ${s.label}`)
if (detected.length !== 1) {
  fail(`形态识别不唯一（命中 ${detected.length} 条）——无法确定在测哪一版，A/B 作废`)
  process.exit(1)
}
const armId = detected[0].id
if (process.env.STRESS_EXPECT_SHAPE && process.env.STRESS_EXPECT_SHAPE !== armId) {
  console.log(`\n❌ 期望跑 ${process.env.STRESS_EXPECT_SHAPE}，实际是 ${armId} —— 版本没切对，就此停下`)
  process.exit(1)
}

// ──────────────────────────────────────────────────────────────────────
// fixture：大文件 + 随机偏移 = 真磁盘读 = 更宽的竞态窗口
// ──────────────────────────────────────────────────────────────────────
if (!fs.existsSync(seedPath)) {
  execFileSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'testsrc=duration=2:size=320x240:rate=15',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', seedPath], { stdio: 'ignore' })
}
if (!fs.existsSync(bigPath) || fs.statSync(bigPath).size < MIN_BIG_BYTES) {
  console.log('  ⏳ 生成大 fixture（一次性，约 1-2 分钟）…')
  execFileSync(ffmpeg, ['-y', '-f', 'lavfi',
    '-i', 'testsrc=duration=20:size=1280x720:rate=30,noise=alls=60:allf=t+u',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-qp', '0', '-pix_fmt', 'yuv420p', bigPath], { stdio: 'ignore' })
}
const bigBytes = fs.statSync(bigPath).size
console.log(`  🎬 大 fixture ${(bigBytes / 1024 / 1024).toFixed(1)} MB`)
if (bigBytes < MIN_BIG_BYTES) {
  console.log('\n❌ fixture 太小，撑不出流式窗口 —— 就此停下')
  process.exit(1)
}

const { app, win } = await launchNomiApp({
  name: 'local-protocol-abort-stress',
  settingsDir,
  projectsDir,
  env: { NOMI_RENDERER_URL: 'file://' + path.join(repoRoot, 'dist', 'index.html') },
  settleMs: 1800,
})

try {
  // 收集器必须在任何请求之前装上。
  // 装了 uncaughtException 监听后 Electron 默认处理器因 listenerCount>1 提前返回、不再弹框，
  // 正合意：要把异常抓在手里断言，而不是被模态框卡住。
  await app.evaluate(() => {
    globalThis.__stressUncaught = []
    process.on('uncaughtException', (error) => {
      globalThis.__stressUncaught.push({
        code: error?.code ?? null,
        message: String(error?.message ?? error),
        stack: String(error?.stack ?? '').split('\n').slice(0, 4).join('\n'),
      })
    })
  })

  // ────────────────────────────────────────────────────────────────────
  // ② 阳性对照：这台机器 + 这个收集器，到底能不能抓到这条病？
  //    用手控时序的异步可迭代，把竞态**确定性**地摆出来。它必须炸。
  // ────────────────────────────────────────────────────────────────────
  const control = await app.evaluate(async () => {
    const before = globalThis.__stressUncaught.length
    for (let i = 0; i < 40; i++) {
      let resolveNext = null
      const iterable = {
        [Symbol.asyncIterator]() {
          return {
            next() { return new Promise((resolve) => { resolveNext = resolve }) },
            // cancel() → iterator.return()：让那个 pending 的 next() 以 done=true 解析，
            // 正是 undici 那段延迟 close 需要的输入。
            return() {
              resolveNext?.({ done: true, value: undefined })
              return Promise.resolve({ done: true, value: undefined })
            },
          }
        },
      }
      try {
        const reader = new Response(iterable).body.getReader()
        reader.read().catch(() => {})            // 起 pull → next() 挂起
        await new Promise((r) => setTimeout(r, 0))
        reader.cancel().catch(() => {})          // controller 关闭 + 触发 return()
      } catch { /* call site 本来就接不住，接住了才怪 */ }
      await new Promise((r) => setTimeout(r, 2))
    }
    await new Promise((r) => setTimeout(r, 200))
    const fired = globalThis.__stressUncaught.slice(before)
    // 对照组的异常不算真故障，抓完就丢，别污染后面的真实路径判据。
    globalThis.__stressUncaught.length = before
    return { count: fired.length, sample: fired[0] ?? null }
  })

  const controlFired = control.count > 0 && /ERR_INVALID_STATE|already closed/i.test(control.sample?.message ?? '')
  if (controlFired) {
    console.log(`  ✅ 阳性对照命中 ${control.count} 次 —— 本机能炸、收集器接得住，判据有鉴别力`)
    console.log(`      ${control.sample.code} ${control.sample.message}`)
  } else {
    console.log(`  ⚠️  阳性对照没炸（${control.count} 条异常）—— 仪器可能是坏的`)
    console.log('      后面无论绿不绿都不作数：这说明这套判据在本平台没有鉴别力，而不是代码没病。')
  }

  // ────────────────────────────────────────────────────────────────────
  // 拿真实地址：让 app 自己吐，别自己拼（拼错了 404 也不崩 = 假绿）
  // ────────────────────────────────────────────────────────────────────
  await win.getByText('新建空白项目', { exact: false }).first().click()
  await win.waitForTimeout(2200)
  await win.keyboard.press('Escape').catch(() => {})
  await win.getByText('生成', { exact: true }).first().click()
  await win.waitForTimeout(1000)
  const assetTab = win.getByRole('button', { name: /素材库|Asset library/ }).first()
  if (await assetTab.count()) { await assetTab.click().catch(() => {}); await win.waitForTimeout(600) }
  const fileInput = win.locator('input[aria-label="素材文件选择器"]')
  await fileInput.waitFor({ state: 'attached', timeout: 15_000 })
  await fileInput.setInputFiles(seedPath)
  await win.waitForTimeout(3000)
  const projectTab = win.getByText('项目素材', { exact: false }).first()
  if (await projectTab.count()) { await projectTab.click().catch(() => {}); await win.waitForTimeout(1800) }

  let seedUrl = null
  for (let i = 0; i < 20 && !seedUrl; i++) {
    seedUrl = await win.evaluate(() => {
      for (const el of document.querySelectorAll('*')) {
        for (const attr of ['src', 'poster', 'data-src', 'href']) {
          const value = el.getAttribute?.(attr)
          if (typeof value === 'string' && value.startsWith('nomi-local://')) return value
        }
      }
      return null
    })
    if (!seedUrl) await win.waitForTimeout(750)
  }
  if (!seedUrl) throw new Error('探针没拿到 nomi-local:// 地址 —— 素材没导入成功，后面全是空转')
  console.log(`  🔎 真实地址：${seedUrl}`)

  // 落盘目录按**文件名**找，不按 URL 反推（项目目录名是人类可读 slug，不是 projectId）。
  const findSeed = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { const hit = findSeed(full); if (hit) return hit }
      else if (entry.name === SEED_NAME) return full
    }
    return null
  }
  const seedOnDisk = findSeed(projectsDir)
  if (!seedOnDisk) throw new Error(`种子文件没落盘，projectsDir=${projectsDir}`)
  fs.copyFileSync(bigPath, path.join(path.dirname(seedOnDisk), BIG_NAME))
  const bigUrl = seedUrl.replace(new RegExp(`${SEED_NAME}$`), BIG_NAME)

  // 先自证这个地址真的能取到内容，否则后面几千次全打在 404 上（假绿）。
  const probe = await win.evaluate(async (url) => {
    const response = await fetch(url, { headers: { Range: 'bytes=0-65535' } })
    const buffer = await response.arrayBuffer()
    return { status: response.status, bytes: buffer.byteLength }
  }, bigUrl)
  console.log(`  ✓ 地址可取：status=${probe.status} 取到 ${probe.bytes} 字节`)
  if (probe.status !== 206 || probe.bytes !== 65536) {
    fail(`大文件地址不可用（status=${probe.status}, bytes=${probe.bytes}）—— 压测会全打在错误路径上`)
    throw new Error('地址自证失败')
  }

  // ────────────────────────────────────────────────────────────────────
  // ③ 真实路径压测：扫描取消时刻 × 混合请求形态 × 高并发
  // ────────────────────────────────────────────────────────────────────
  console.log(`  🔨 压测：${ROUNDS} 次取消 · 并发 ${CONCURRENCY} · 扫描 0–21ms 取消时刻…`)
  const stress = await win.evaluate(async ({ url, rounds, concurrency, size }) => {
    // 取消时刻扫描表。窗口 = 「next() 已发出、尚未解析」，宽度约等于一次磁盘读，
    // 所以既要有 0（同一 tick 内取消），也要有几 ms（读到一半取消）。
    const delays = [0, 0, 1, 1, 2, 3, 4, 5, 7, 9, 12, 16, 21]
    let issued = 0
    let aborted = 0

    const one = async (index) => {
      const controller = new AbortController()
      // 三种形态混合：整文件 / 大区间 / 小区间。
      // 小区间会自然读到 EOF（done=true 的另一条来路）；整文件则靠 cancel 触发 return()。
      const mode = index % 3
      const offset = Math.floor(Math.random() * Math.max(1, size - 4 * 1024 * 1024))
      const headers = mode === 0
        ? undefined
        : mode === 1
          ? { Range: `bytes=${offset}-${offset + 4 * 1024 * 1024}` }
          : { Range: `bytes=${offset}-${offset + 65535}` }

      const request = fetch(url, { signal: controller.signal, headers })
        .then(async (response) => {
          const reader = response.body?.getReader()
          if (!reader) return
          // 读一两块就走，制造「流还开着、突然没人要了」
          await reader.read()
          if (index % 2 === 0) await reader.read()
        })
        .catch(() => {})

      const delay = delays[index % delays.length]
      if (delay === 0) await Promise.resolve()
      else await new Promise((resolve) => setTimeout(resolve, delay))
      controller.abort()
      aborted++
      await request
    }

    // 高并发：制造 I/O 争用，把每次读拖慢 → 竞态窗口变宽
    for (let base = 0; base < rounds; base += concurrency) {
      const batch = []
      for (let k = 0; k < concurrency && base + k < rounds; k++) {
        batch.push(one(base + k))
        issued++
      }
      await Promise.all(batch)
    }
    await new Promise((resolve) => setTimeout(resolve, 1200))
    return { issued, aborted }
  }, { url: bigUrl, rounds: ROUNDS, concurrency: CONCURRENCY, size: bigBytes })

  console.log(`  ✂️  发出 ${stress.issued} 条 · 中途取消 ${stress.aborted} 次`)

  const uncaught = await app.evaluate(() => globalThis.__stressUncaught ?? [])
  const invalidState = uncaught.filter((item) =>
    item.code === 'ERR_INVALID_STATE' || /ERR_INVALID_STATE|already closed/i.test(item.message))

  console.log('')
  console.log(`  ── 结果（arm=${armId}）──`)
  console.log(`     阳性对照：${controlFired ? `命中 ${control.count} 次（仪器有效）` : '未命中（仪器存疑）'}`)
  console.log(`     真实路径主进程未捕获异常：${uncaught.length} 条`)
  console.log(`     其中 ERR_INVALID_STATE：${invalidState.length} 条`)
  for (const item of invalidState.slice(0, 3)) {
    console.log(`       ${item.code} ${item.message}`)
    console.log(`${item.stack.split('\n').map((l) => '         ' + l).join('\n')}`)
  }
  for (const item of uncaught.filter((u) => !invalidState.includes(u)).slice(0, 3)) {
    console.log(`     （其他异常）${item.code} ${item.message}`)
  }

  // 判据随 arm 走：修复版必须零命中；对照版命中反而是**好事**（证明这条走查有鉴别力）。
  if (armId === 'owned') {
    if (invalidState.length) fail(`修复版仍出现 ${invalidState.length} 条 ERR_INVALID_STATE —— 修复没生效`)
    else console.log('     ✓ 修复版零 ERR_INVALID_STATE')
  } else {
    if (invalidState.length) console.log(`     ⚑ 对照版复现了 ${invalidState.length} 条 —— 本平台有鉴别力，§1.6 可闭合`)
    else console.log('     ○ 对照版也没复现 —— 本平台下这条路径压不出来（如实记录，不当作「已修好」）')
  }

  const logPath = await app.evaluate(({ app: electronApp }) =>
    require('node:path').join(electronApp.getPath('logs'), 'nomi-crash.log')).catch(() => null)
  if (logPath && fs.existsSync(logPath)) {
    const log = fs.readFileSync(logPath, 'utf8')
    console.log(log.includes('ERR_INVALID_STATE')
      ? `     ⚑ nomi-crash.log 里有 ERR_INVALID_STATE：${logPath}`
      : '     ✓ nomi-crash.log 无 ERR_INVALID_STATE')
  } else {
    console.log('     ✓ 未生成 nomi-crash.log')
  }

  fs.writeFileSync(path.join(outDir, `result-${armId}.json`), JSON.stringify({
    arm: armId, controlFired, controlCount: control.count,
    issued: stress.issued, aborted: stress.aborted,
    uncaughtTotal: uncaught.length, invalidState: invalidState.length,
    samples: invalidState.slice(0, 5),
  }, null, 2))
} catch (error) {
  fail(`压测异常：${error?.stack || error}`)
} finally {
  await app.close().catch(() => {})
}

console.log(failed ? '\n❌ 压测未通过' : '\n✅ 压测跑完')
process.exit(failed ? 1 : 0)
