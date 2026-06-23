// 站位参考价值的真实 A/B（硬场景）：专挑文本模型容易把站位/动作搞崩、staging 能救的场景。
// 每场景出图两次：A=纯文本、B=文本+staging 灰模图。比 B 是否更牢锁住站位/动作/朝向。
// 真实图像额度(非视频)。需 vite(staging-one) + apimart key。
// 用法：pnpm dev:renderer(后台) && pnpm run build && APIMART_E2E=1 node scripts/staging-ab.mjs
import { _electron as electron } from 'playwright'
import { chromium } from 'playwright'
import { createRequire } from 'node:module'
import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(repoRoot, '.pose-lab')
mkdirSync(outDir, { recursive: true })
const MODEL_KEY = 'gemini-2.5-flash-image-preview'

// 硬场景：文本有强先验/易混的站位，看 staging 能否纠偏。
const SCENARIOS = [
  {
    label: 'rev-propose',
    spec: { characters: [{ pose: 'single-knee', facing: 'toward' }, { pose: 'standing', facing: 'toward' }], layout: 'facing', camera: { angle: 'three-quarter', height: 'low', shot: 'medium' } },
    promptA: '电影写实照片：一个女人单膝跪地向站在她正前方的男人求婚，仰拍低机位，室内暖色灯光。',
    promptB: '把参考图里左边单膝跪着的人渲染成女人、右边站着的人渲染成男人，严格保持他们的站位、姿势、朝向和镜头机位：电影写实照片，求婚场景，室内暖色灯光。',
  },
  {
    label: 'three-poses',
    spec: { characters: [{ pose: 'sit' }, { pose: 'standing' }, { pose: 'single-knee' }], layout: 'side-by-side', camera: { angle: 'front', height: 'eye', shot: 'wide' } },
    promptA: '写实照片，三个人并排：最左边的人坐在地上、中间的人站着、最右边的人单膝跪地，正面全景。',
    promptB: '电影级写实照片：三个人在城市广场上，最左边的人坐在地上、中间的人站着、最右边的人单膝跪地。\n\n（构图参考仅用于确定人物站位、各自姿势和镜头机位；请据此完全写实地重新渲染人物与场景——真实皮肤/衣物/光影，不要保留参考图里灰色人偶或 3D 渲染的外观。）',
  },
  {
    label: 'back-facing',
    spec: { characters: [{ pose: 'standing', facing: 'away' }, { pose: 'standing', facing: 'camera' }], layout: 'behind', camera: { angle: 'three-quarter', height: 'eye', shot: 'medium' } },
    promptA: '过肩镜头写实照片：前景一个人背对镜头，与他面对面站着另一个面朝镜头的人。',
    promptB: '把参考图渲染成真人，严格保持：前景的人背对镜头、对面的人面朝镜头，两人面对面站立，过肩构图写实照片。',
  },
]

// SC_ONLY=<label> 只跑某个场景（省额度调试）。
if (process.env.SC_ONLY) { const only = process.env.SC_ONLY; for (let i = SCENARIOS.length - 1; i >= 0; i--) if (SCENARIOS[i].label !== only) SCENARIOS.splice(i, 1) }

// ── Phase 1：chromium 渲每个场景的 staging 灰模图 ──
console.log('▶ Phase 1: 渲染各场景 staging 灰模图')
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 900, height: 700 } })
for (const sc of SCENARIOS) {
  const b64 = Buffer.from(JSON.stringify(sc.spec)).toString('base64')
  const page = await ctx.newPage()
  await page.goto(`http://127.0.0.1:5273/staging-one.html?spec=${encodeURIComponent(b64)}`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.__oneDataUrl, { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(400)
  sc.staging = await page.evaluate(() => window.__oneDataUrl || null)
  await page.close()
  console.log(`  ${sc.label}: ${sc.staging ? Math.round(sc.staging.length / 1024) + 'KB' : 'FAIL'}`)
}
await browser.close()

// ── Phase 2：electron 真实 A/B 生成 ──
console.log('▶ Phase 2: 真实图像 A/B 生成')
const app = await electron.launch({ executablePath: require('electron'), args: ['.'], cwd: repoRoot, env: { ...process.env } })
try {
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1500)
  if (process.env.APIMART_API_KEY) await win.evaluate((k) => window.nomiDesktop.modelCatalog.upsertVendorApiKey('apimart', { apiKey: k, enabled: true }), process.env.APIMART_API_KEY)
  await win.getByText('新建空白项目', { exact: false }).first().click()
  await win.waitForTimeout(2500)
  const projectId = await win.evaluate(() => new URLSearchParams(window.location.search).get('projectId') || (window.location.hash.match(/projectId=([^&]+)/) || [])[1] || null)
  console.log(`  projectId=${projectId}`)
  const nodeIds = SCENARIOS.flatMap((s) => [`${s.label}-A`, `${s.label}-B`])
  const grant = await win.evaluate((ids) => window.nomiDesktop.tasks.grantSpend({ nodeIds: ids, maxAttemptsPerNode: 2 }), nodeIds)
  const grantId = grant?.grantId
  console.log(`  grant ${grantId ? 'ok' : 'FAIL'}`)

  async function gen(nodeId, kind, prompt, extra) {
    const start = await win.evaluate(async (a) => window.nomiDesktop.tasks.run({ vendor: 'apimart', request: { kind: a.kind, prompt: a.prompt, extras: { modelKey: a.mk, aspect_ratio: '16:9', grantId: a.grantId, nodeId: a.nodeId, ...a.extra } } }), { kind, prompt, mk: MODEL_KEY, grantId, nodeId, extra })
    if (!start?.id) { console.log(`    ✗ ${nodeId} no taskId: ${JSON.stringify(start)?.slice(0, 160)}`); return null }
    let final = start
    const terminal = new Set(['succeeded', 'failed'])
    for (let i = 0; i < 30 && !terminal.has(final.status); i++) {
      await new Promise((r) => setTimeout(r, 8000))
      const resp = await win.evaluate(async (a) => window.nomiDesktop.tasks.result({ taskId: a.id, vendor: 'apimart', taskKind: a.kind, prompt: a.prompt, modelKey: a.mk }), { id: start.id, kind, prompt, mk: MODEL_KEY })
      final = resp?.result ?? final
    }
    const img = (final.assets || []).find((x) => x.type === 'image' && x.url)
    console.log(`    ${nodeId}: ${final.status}${img ? '' : ' (无图)'}`)
    return img?.url || null
  }

  async function save(label, url) {
    if (!url) return
    const dataUrl = await win.evaluate(async (u) => { try { const r = await fetch(u); const b = await r.blob(); return await new Promise((res) => { const fr = new FileReader(); fr.onloadend = () => res(fr.result); fr.readAsDataURL(b) }) } catch { return null } }, url)
    if (typeof dataUrl === 'string' && dataUrl.startsWith('data:')) { writeFileSync(path.join(outDir, `ab-${label}.png`), Buffer.from(dataUrl.split(',')[1], 'base64')); console.log(`    ✓ ab-${label}.png`) }
  }

  for (const sc of SCENARIOS) {
    console.log(`— ${sc.label} —`)
    const urlA = await gen(`${sc.label}-A`, 'text_to_image', sc.promptA, {})
    let localUrl = null
    if (sc.staging) {
      const asset = await win.evaluate(async (a) => window.nomiDesktop.assets.importRemoteUrl({ projectId: a.pid, url: a.d, kind: 'generated', fileName: 'staging.png' }), { pid: projectId, d: sc.staging })
      localUrl = asset?.data?.url
    }
    const urlB = localUrl ? await gen(`${sc.label}-B`, 'image_edit', sc.promptB, { image_urls: [localUrl] }) : null
    await save(`${sc.label}-A`, urlA)
    await save(`${sc.label}-B`, urlB)
    await save(`${sc.label}-staging`, sc.staging)
  }
  console.log('\n═══ A/B 完成 ═══')
} catch (e) { console.log(`✗ ${e?.message || e}`) } finally { await app.close().catch(() => undefined) }
