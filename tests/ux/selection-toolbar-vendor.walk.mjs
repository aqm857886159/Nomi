// 看清「框选多选浮条」的真实样子：用户报「框选没办法选择不同供应商的模型，导致一直生成失败」。
// 这份只做取证——不断言对错，就是把浮条真实渲染出来给人眼看：模型下拉有、供应商下拉有没有。
import { launchNomiApp } from './_launchApp.mjs'
import { expectVisible, expectAbsent, proveProbe, screenshotSettled } from './_assert.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-sel-vendor-'))
const settingsDir = path.join(tempRoot, 'settings')
const projectsDir = path.join(tempRoot, 'projects')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/selection-toolbar-vendor')
fs.mkdirSync(shotsDir, { recursive: true })
fs.mkdirSync(settingsDir, { recursive: true })

// 关键：种一个**同一个模型来自两家**的目录。本机默认目录全是即梦单家，
// 在那种现场跑「没有『N 家』折叠行」等于什么都没验（空洞的绿）——必须造出多家现场。
const now = '2026-08-18T00:00:00.000Z'
const vendors = [
  { key: 'ux-apimart', name: 'APIMart' },
  { key: 'ux-kie', name: 'Kie' },
]
fs.writeFileSync(
  path.join(settingsDir, 'model-catalog.json'),
  JSON.stringify({
    version: 8,
    vendors: vendors.map((v) => ({
      key: v.key, name: v.name, enabled: true,
      baseUrlHint: `https://${v.key}.example/v1`, authType: 'none',
      providerKind: 'openai-compatible', meta: {}, createdAt: now, updatedAt: now,
    })),
    models: [
      // 同款「Nano Banana」两家都有 → 修好后下拉里该是两行，trailing 分别是 APIMart / Kie。
      ...vendors.map((v) => ({
        vendorKey: v.key, modelKey: `nano-banana-${v.key}`, labelZh: 'Nano Banana', kind: 'image',
        enabled: true, createdAt: now, updatedAt: now,
        meta: {
          adapter: {
            state: 'verified', activeRevision: 'revision-x', publicationModes: ['text_to_image'],
            modes: [{ taskKind: 'text_to_image', state: 'verified' }], runId: 'run-x', updatedAt: now,
          },
        },
      })),
      // 单家对照组：它应该仍是一行。
      {
        vendorKey: 'ux-apimart', modelKey: 'gpt-image-2', labelZh: 'GPT Image 2', kind: 'image',
        enabled: true, createdAt: now, updatedAt: now,
        meta: {
          adapter: {
            state: 'verified', activeRevision: 'revision-x', publicationModes: ['text_to_image'],
            modes: [{ taskKind: 'text_to_image', state: 'verified' }], runId: 'run-x', updatedAt: now,
          },
        },
      },
    ],
    mappings: [],
    apiKeysByVendor: {},
  }, null, 2),
)

const swatch = (c) =>
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="${c}"/></svg>`)

// 混合 image + video：浮条会为每个 executionKind 各渲一个模型下拉，正好看清「多组时有多挤」。
const nodes = [
  ...['#4a7fe0', '#00a886', '#c56b3c'].map((c, i) => ({
    id: `img-${i + 1}`, kind: 'image', title: `镜头 ${i + 1}`,
    position: { x: 40 + i * 240, y: 80 }, categoryId: 'shots', shotIndex: i + 1,
    result: { id: `img-${i + 1}-r`, type: 'image', url: swatch(c) },
  })),
  ...['#8a5cf6', '#e0574a'].map((c, i) => ({
    id: `vid-${i + 1}`, kind: 'video', title: `视频 ${i + 1}`,
    position: { x: 40 + i * 240, y: 300 }, categoryId: 'shots', shotIndex: 10 + i,
    result: { id: `vid-${i + 1}-r`, type: 'image', url: swatch(c) },
  })),
]

const projectId = 'selvendor-0001'
const projDir = path.join(projectsDir, `selvendor-${projectId}`)
fs.mkdirSync(projDir, { recursive: true })
const project = {
  id: projectId, name: '框选供应商取证', version: 1,
  createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1, lastKnownRootPath: projDir,
  payload: {
    workbenchDocument: { version: 1, title: '框选供应商取证', updatedAt: 1, contentJson: { type: 'doc', content: [] } },
    timeline: null,
    generationCanvas: { nodes, edges: [], selectedNodeIds: [], groups: [] },
    storyboardPlan: null, storyboardPlanCommitted: false,
  },
}
fs.writeFileSync(path.join(projDir, 'project.json'), JSON.stringify(project, null, 2))

const { app, win } = await launchNomiApp({
  name: 'selection-toolbar-vendor', tempRoot, settingsDir, projectsDir, settleMs: 1200,
})

const snap = async (name) => {
  await screenshotSettled(win, { path: path.join(shotsDir, `${name}.png`) })
  console.log(`  · shot ${name}`)
}
async function closeApp() {
  const child = app.process()
  await Promise.race([app.close().catch(() => undefined), new Promise((r) => setTimeout(r, 8000))])
  if (child.exitCode === null) child.kill('SIGKILL')
}

try {
  await win.evaluate(() => {
    for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(k, 'seen')
  })
  await win.reload()
  await win.waitForTimeout(1500)
  for (let i = 0; i < 5; i += 1) {
    await win.keyboard.press('Escape').catch(() => {})
    const skip = win.locator('button,[role="button"],a', { hasText: /跳过|完成|知道了|开始创作/ }).first()
    if (await skip.isVisible().catch(() => false)) await skip.click({ timeout: 1000 }).catch(() => {})
  }

  const card = win.locator('[data-project-card]', { hasText: project.name }).first()
  await expectVisible(card, `项目库里找不到项目卡「${project.name}」`)
  await card.hover()
  const cont = card.getByText('继续创作', { exact: false }).first()
  if (await cont.isVisible().catch(() => false)) await cont.click()
  else await card.dblclick()

  // 「项目开好了」的真信号 = 顶部「生成」导航出现，不是等够 1.8 秒。
  const gen = win.getByRole('button', { name: '生成', exact: true })
  await expectVisible(gen, '打开项目后没等到顶部「生成」导航')
  await gen.click()

  // 画布挂载完的真信号 = 我种的那 5 个节点渲染出来了。等够时间才截图，否则拍到空画布。
  const nodeCards = win.locator('[data-node-id]')
  await expectVisible(nodeCards.first(), '切到生成区后画布上没渲染出节点')
  await snap('01-canvas')

  // 全选（比模拟拖框稳），等价于框选出来的多选态。
  await win.keyboard.press('ControlOrMeta+a')

  const bar = win.locator('.generation-canvas-v2__selection-toolbar').first()
  // 多选浮条出现 = 全选真的生效了。旧写法靠 sleep 赌，赌短了浮条还没挂，
  // 后面「浮条里有几行」全部读到 0——而 0 恰好让「没有 N 家折叠行」这条通过（空洞的绿）。
  await expectVisible(bar, '全选后没出现多选浮条')
  await snap('02-selection-toolbar')

  const box = await bar.boundingBox().catch(() => null)
  if (box) {
    await screenshotSettled(win, {
      path: path.join(shotsDir, '03-toolbar-closeup.png'),
      clip: { x: Math.max(0, box.x - 12), y: Math.max(0, box.y - 12), width: box.width + 24, height: box.height + 24 },
    })
    console.log(`  · 浮条宽 ${Math.round(box.width)}px（组件 max-w 是 760px，超了就会横向滚动）`)
  } else {
    console.log('  · 没拿到浮条边界框')
  }

  // 浮条里到底有哪些控件 —— 直接把 aria-label 全打出来，别靠猜。
  const labels = await bar.evaluate((el) =>
    [...el.querySelectorAll('[aria-label],button')].map((n) => n.getAttribute('aria-label') || n.textContent?.trim()).filter(Boolean),
  ).catch(() => [])
  console.log('  · 浮条控件：', JSON.stringify(labels, null, 2))

  // 打开「图片 ×N」那个批量下拉，把每一行的 模型 + 厂商标注 打出来。
  // 修好的判据：同一个模型若有多家，就该出现**多行同名、trailing 是不同厂商**；
  // 而不是一行「N 家」（那种形态下用户根本没有入口指定走哪家 —— 就是这次的 bug）。
  await bar.locator('[aria-label^="图片"]').first().click({ timeout: 5000 })

  // 页面上同时存在多个 listbox（并发那个也是）——按内容挑出模型那个，别拿第一个就用。
  // 用 locator.filter 而不是一次性 querySelectorAll：下拉是点开后异步挂的，
  // 一次取样会在挂载前读到空数组，而空数组恰好让下面「没有 N 家折叠行」通过（空洞的绿）。
  const modelListbox = win.locator('[role="listbox"]').filter({ hasText: /Nano|GPT|Seedream|即梦/ }).first()
  await expectVisible(modelListbox, '点开「图片 ×N」批量下拉后没找到模型 listbox')
  const options = modelListbox.locator('[role="option"]')

  // 基线：探针得先真的找得到「行」。这是这条走查里唯一诚实的基线形式——
  // 「没有 N 家折叠行」若在一个**一行都没读到**的现场成立，那它和「下拉根本没打开」完全无法区分
  // （我上一版正是栽在这：本机目录全是即梦单家，压根不可能有折叠行，报绿但什么都没验）。
  const rowsProof = await proveProbe(options, '批量下拉里确实读得到模型行')
  await snap('04-bulk-dropdown-open')

  const dump = await options.evaluateAll((nodes) => nodes.map((n) => ({
    text: n.textContent?.replace(/\s+/g, ' ').trim() || '',
    value: n.getAttribute('data-value') || n.getAttribute('value') || '',
  })))
  const rows = dump.map((d) => d.text)
  console.log(`  · 下拉共 ${rows.length} 行：`)
  for (const d of dump) console.log(`      ${d.text}   ⟵ ${d.value}`)

  // 断言写成**目录无关的不变量**——别钉死行数。本机自带目录里已经有 Nano Banana/GPT Image 2，
  // 和我种的两家会叠加，第一版按「期望 2 行」断言直接误报（数错了不代表功能坏）。
  const collapsedRows = options.filter({ hasText: /\d+\s*家/ })
  const collapsed = rows.filter((r) => /\d+\s*家/.test(r))
  const nano = rows.filter((r) => r.includes('Nano Banana'))
  const nanoVendors = new Set(['APIMart', 'Kie'].filter((v) => nano.some((r) => r.includes(v))))
  // 每行文本 = 显示名 + 厂商标注。两行完全相同 = 用户不可区分（走查抓到的真 bug）。
  const dupes = Object.entries(rows.reduce((m, r) => { m[r] = (m[r] || 0) + 1; return m }, {}))
    .filter(([, c]) => c > 1)

  let noCollapsed = true
  let collapsedDetail = `折叠行 ${collapsed.length} 个（期望 0——那种形态下用户没有入口指定走哪家）`
  try {
    await expectAbsent(collapsedRows, {
      provenBy: rowsProof,
      message: '下拉里不该出现「N 家」折叠行（那种形态下用户没有入口指定走哪家）',
    })
  } catch (error) {
    noCollapsed = false
    collapsedDetail = `${collapsedDetail}：${String(error).split('\n')[0]}`
  }

  const checks = [
    ['多家模型按供应商摊开', nanoVendors.size >= 2,
      `Nano Banana 出现在 ${nanoVendors.size} 家名下：${[...nanoVendors].join('、')}（种了 APIMart + Kie，期望两家都能单独选到）`],
    ['没有「N 家」折叠行', noCollapsed, collapsedDetail],
    ['没有两行完全相同的选项', dupes.length === 0,
      dupes.length === 0 ? '每一行的「模型 + 厂商」组合都唯一，用户区分得开'
        : `重复行：${JSON.stringify(dupes)} —— 用户看到两个一模一样的选项，只能瞎猜`],
  ]
  let failed = 0
  for (const [name, ok, detail] of checks) {
    console.log(`${ok ? '✅' : '❌'} ${name} — ${detail}`)
    if (!ok) failed += 1
  }
  if (failed > 0) {
    await closeApp()
    process.exit(1)
  }
  await closeApp()
} catch (error) {
  console.error(error)
  await win.screenshot({ path: path.join(shotsDir, 'failure.png') }).catch(() => {})
  await closeApp()
  process.exit(1)
}
