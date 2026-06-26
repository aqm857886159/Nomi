// 站位姿势多视角回归截图（R13 子 agent 审查的素材源）。零额度：纯本地 3D 离屏渲染，不碰任何生成 API。
// 启 vite dev server（devlab 页是 dev-only 入口，不进 prod 构建）+ playwright chromium，
// 逐例（staging-shots.html?case=N）等 window.__shotsReady，把 __shots 各视角存成 PNG。
// 用法：node tests/ux/staging-pose-shots.walk.mjs   （可选 CASES=01,07 只跑指定例）
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const outDir = path.join(repoRoot, 'tests/ux/_stagingshot')
fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })

// 用例数（与 stagingTestCases.ts 同步——直接数文件里的 id）
const casesSrc = fs.readFileSync(path.join(repoRoot, 'src/devlab/stagingTestCases.ts'), 'utf8')
const caseIds = [...casesSrc.matchAll(/id:\s*'(\d\d-[^']+)'/g)].map((m) => m[1])
const onlyFilter = (process.env.CASES || '').split(',').map((s) => s.trim()).filter(Boolean)
// 姿势覆盖层(自纠闭环用):OVERRIDES=path/to/overrides.json → 透传给 stagingShots ?ov=<base64>。
const overridesParam = (() => {
  const p = process.env.OVERRIDES
  if (!p || !fs.existsSync(p)) return ''
  try { return '&ov=' + Buffer.from(fs.readFileSync(p, 'utf8')).toString('base64') } catch { return '' }
})()
const CALIBRATE = process.env.CALIBRATE === '1' // 打印逐视角度量，标定阈值用

// 结构性断言阈值（确定性,零成本,补 VLM 人眼审查）：hero 是「生产无地面」帧、5 环绕视角是「地面+网格+投影」帧。
// floorFrac = 底部带里「非背景非红」像素占比（地面/网格/影子存在）；shadowFrac = 明显暗像素占比（投影,网格线更浅不触发）。
const STRUCT = {
  heroFloorMax: 0.08, // hero 不该有地面/网格（背景参考取 hero 角落,自比≈0,留余量）
  heroShadowMax: 0.02, // hero 不该有投影（按饱和度排除彩色假人/人群后,实测全 0）
  orbitFloorMin: 0.3, // 每个环绕视角都必须画出地面/网格
  // 投影是局部小块、随场景宽窄/人群遮挡差异大(宽排/人群 shadowFrac 很小是正常),不宜逐例断言;
  // 真实回归是「全局把投影关了」→ 全场所有视角影子归零。故按整套跑的「最暗影子帧」兜底:
  suiteShadowMin: 0.03, // 整套(非筛选)跑时,至少有一帧 shadowFrac 达到此值,证明投影管线在工作
}

const PORT = 5191
const HOST = '127.0.0.1'
const BASE = `http://${HOST}:${PORT}`

function waitForServer(url, timeoutMs = 60000) {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const res = await fetch(url)
        if (res.ok || res.status === 404) return resolve()
      } catch { /* not up yet */ }
      if (Date.now() - start > timeoutMs) return reject(new Error('vite dev server 启动超时'))
      setTimeout(tick, 400)
    }
    tick()
  })
}

console.log('▶ 启动 vite dev server…')
const vite = spawn('npx', ['vite', '--host', HOST, '--port', String(PORT), '--strictPort'], {
  cwd: repoRoot,
  env: { ...process.env },
  stdio: ['ignore', 'pipe', 'pipe'],
})
vite.stdout.on('data', () => {})
vite.stderr.on('data', (d) => { const s = String(d); if (/error/i.test(s)) process.stderr.write(s) })

let browser
let exitCode = 0
try {
  await waitForServer(`${BASE}/staging-shots.html`)
  console.log(`  ✓ dev server up @ ${BASE}`)

  browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(String(e)))

  const summary = []
  let suiteMaxShadow = 0
  for (let i = 0; i < caseIds.length; i += 1) {
    const id = caseIds[i]
    if (onlyFilter.length && !onlyFilter.some((f) => id.startsWith(f))) continue
    await page.goto(`${BASE}/staging-shots.html?case=${i}${overridesParam}`, { waitUntil: 'domcontentloaded' })
    let shots = null
    let diag = null
    try {
      await page.waitForFunction(() => window.__shotsReady === true, { timeout: 30000 })
      shots = await page.evaluate(() => window.__shots)
      diag = await page.evaluate(() => window.__diag) // 逐角色蒙皮最低点世界 Y(落地判据)
    } catch (err) {
      console.log(`  ✗ ${id}: 渲染超时/无 __shots (${err.message})`)
      summary.push({ id, ok: false, views: 0 })
      continue
    }
    const views = Object.keys(shots || {})
    for (const v of views) {
      const b64 = String(shots[v]).replace(/^data:image\/png;base64,/, '')
      fs.writeFileSync(path.join(outDir, `${id}__${v}.png`), Buffer.from(b64, 'base64'))
    }

    // 结构性度量：逐视角采底部带像素，判地面/网格/投影是否如预期渲染（在浏览器里用 canvas 采样,零成本）。
    // 背景参考取 hero 角落像素（hero 永远是生产无地面的纯背景帧）——避开 THREE.Color 线性/sRGB 口径坑。
    // floorFrac = 底部带「非背景非红」像素占比（地面/网格/影子=地面组渲染了）；shadowFrac = 暗像素(lum<155)占比
    //（影子比网格线暗,网格线 lum>170 不触发；影子是局部小块,顶视会被人挡住,故影子按 5 视角汇总而非逐视角断言）。
    const metrics = await page.evaluate(async () => {
      const shotsMap = window.__shots || {}
      const load = (url) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = url })
      const ctxOf = (im) => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const x = c.getContext('2d'); x.drawImage(im, 0, 0); return { x, W: im.width, H: im.height } }
      let bg = [246, 243, 238]
      if (shotsMap.hero) {
        const im = await load(shotsMap.hero); const { x } = ctxOf(im)
        const p = x.getImageData(4, 4, 10, 10).data; let r = 0, g = 0, b = 0, n = 0
        for (let i = 0; i < p.length; i += 4) { r += p[i]; g += p[i + 1]; b += p[i + 2]; n += 1 }
        bg = [r / n, g / n, b / n]
      }
      const measure = async (url) => {
        const im = await load(url); const { x, W, H } = ctxOf(im)
        const d = x.getImageData(0, 0, W, H).data
        const y0 = Math.floor(H * 0.62), y1 = Math.floor(H * 0.97)
        let total = 0, floorish = 0, dark = 0
        for (let y = y0; y < y1; y += 2) {
          for (let xx = 0; xx < W; xx += 2) {
            const i = (y * W + xx) * 4, r = d[i], g = d[i + 1], b = d[i + 2]
            // 跳过任何「彩色」像素=假人/人群（红/黄/蓝/绿…高饱和）；地面/网格/影子都是低饱和暖灰,留下。
            if (Math.max(r, g, b) - Math.min(r, g, b) > 40) continue
            total += 1
            if (Math.abs(r - bg[0]) + Math.abs(g - bg[1]) + Math.abs(b - bg[2]) > 18) floorish += 1
            if ((r + g + b) / 3 < 155) dark += 1
          }
        }
        return { floorFrac: total ? floorish / total : 0, shadowFrac: total ? dark / total : 0 }
      }
      const out = {}
      for (const [k, url] of Object.entries(shotsMap)) out[k] = await measure(url)
      return out
    })

    // 断言：hero 无地面/投影；5 环绕视角都画出地面/网格；投影至少在某个环绕视角清晰可见（顶视被人挡住故按汇总判）。
    const structFails = []
    const m = metrics || {}
    if (!m.hero || m.hero.floorFrac > STRUCT.heroFloorMax) structFails.push(`hero 出现地面/网格(floor=${m.hero?.floorFrac.toFixed(3)})`)
    if (m.hero && m.hero.shadowFrac > STRUCT.heroShadowMax) structFails.push(`hero 出现投影(shadow=${m.hero.shadowFrac.toFixed(3)})`)
    for (const v of ['front', 'q3', 'side', 'back', 'top']) {
      if (!m[v]) { structFails.push(`${v} 缺失`); continue }
      if (m[v].floorFrac < STRUCT.orbitFloorMin) structFails.push(`${v} 无地面/网格(floor=${m[v].floorFrac.toFixed(3)})`)
    }
    const caseMaxShadow = ['front', 'q3', 'side', 'back', 'top'].reduce((s, v) => Math.max(s, m[v]?.shadowFrac || 0), 0)
    const orbitShadowSum = ['front', 'q3', 'side', 'back', 'top'].reduce((s, v) => s + (m[v]?.shadowFrac || 0), 0)
    if (CALIBRATE) {
      console.log(`  · ${id} 度量: ` + ['hero', 'front', 'q3', 'side', 'back', 'top'].map((v) => `${v}[f=${m[v]?.floorFrac.toFixed(2)},s=${m[v]?.shadowFrac.toFixed(3)}]`).join(' ') + ` shadowSum=${orbitShadowSum.toFixed(3)}`)
    }
    suiteMaxShadow = Math.max(suiteMaxShadow, caseMaxShadow)
    // 落地:每个角色蒙皮最低点世界 Y 都应≈0(|Y|<0.12 视为落地)。供自纠闭环当免费形状回归信号。
    const grounded = Array.isArray(diag) && diag.length > 0 && diag.every((y) => Math.abs(y) < 0.12)
    const structOk = structFails.length === 0
    console.log(`  ${views.length >= 5 && structOk ? '✓' : '✗'} ${id}: ${views.length} 视角${structOk ? '' : ' ⚠ ' + structFails.join('; ')}`)
    summary.push({ id, ok: views.length >= 5 && structOk, views: views.length, structFails, grounded, diag })
  }

  // 整套级投影管线断言（仅整套跑时——筛选子集可能不含明显投影的例,跳过免误报）。
  if (!onlyFilter.length && suiteMaxShadow < STRUCT.suiteShadowMin) {
    console.log(`✗ 投影管线疑似失效：整套最暗影子帧 shadowFrac=${suiteMaxShadow.toFixed(3)} < ${STRUCT.suiteShadowMin}（Canvas shadows / receiveShadow / castShadow 被关？）`)
    exitCode = 1
  }

  fs.writeFileSync(path.join(outDir, '_summary.json'), JSON.stringify(summary, null, 2))
  const bad = summary.filter((s) => !s.ok)
  console.log(`\n═══ ${summary.length} 例，每例多视角 PNG → ${path.relative(repoRoot, outDir)} ═══`)
  if (errors.length) console.log(`console errors:\n  ${[...new Set(errors)].slice(0, 8).join('\n  ')}`)
  if (bad.length) {
    console.log(`✗ ${bad.length} 例未过（渲染不全或结构断言失败）：`)
    for (const b of bad) console.log(`    ${b.id}: ${b.views < 5 ? `仅 ${b.views} 视角` : (b.structFails || []).join('; ')}`)
    exitCode = 1
  } else {
    console.log('✓ 全部用例多视角渲染成功 + 结构断言通过（hero 无地面/投影；5 环绕视角有地面+投影）')
  }
} catch (err) {
  console.log(`FAIL: ${err?.message || err}`)
  exitCode = 1
} finally {
  if (browser) await browser.close().catch(() => {})
  vite.kill('SIGTERM')
}
process.exit(exitCode)
