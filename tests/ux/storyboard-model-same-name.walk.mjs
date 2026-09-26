// 分镜里「两家同名模型，选 APIMart 那家，钱就花在 APIMart」——真机走查（2026-09-21 根因合同
// docs/fixes/2026-09-21-storyboard-model-vendor.root-cause.json）。
//
// 用户报的是：自定义了一个与 APIMart 同名的模型（gpt-image-2）之后，分镜里选 APIMart 那条「选不上」，
// 生成却走了自定义那家。三个入口各自复现过：镜头卡底栏、批量条「统一模型」、锚行模型框。
//
// 这条走查的验收点是**一条链两端对上**，不是截图好不好看：
//   ① 真人手势在三个模型框里各选一次「APIMart 那家」（不是灌 store、不是调桥）
//   ② 模型框回显的是那一家（触发器上的模型名 = APIMart 那一组）
//   ③ 真人点「生成」→（单份不弹确认卡）真执行通路 → loopback 收到的**出站请求**是那一家的 mapping 发出的
// 阳性对照：第 3 镜保持在自定义那家先跑一次，请求必须来自自定义那家——证明这条仪器
// 真分得清两家（否则 ③ 可能只是「两家恰好一样」的空洞通过）。
//
// 两家都是本地 loopback（零额度）：「APIMart 替身」用的是独立 vendor key + 独立 mapping，
// 不碰真实 APIMart（内置 apimart 家的传输面被种子锁死，指向 loopback 会被发布闸拒掉，那是对的）。
// 区分两家靠各家 mapping 上的 X-Walk-Vendor 请求头：同一个 loopback 端口，请求走哪家的 mapping 就带哪家的名字。
//
// 用法：node tests/ux/storyboard-model-same-name.walk.mjs            # 中文
//       WALK_LOCALE=en node tests/ux/storyboard-model-same-name.walk.mjs  # 英文
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import {
  createAgentRuntimeFixture,
  FIXTURE_IMAGE_MODEL,
  FIXTURE_VENDOR,
} from './agent-runtime-fixture.mjs'
import { DEFAULT_TIMEOUT_MS, clickOrFail, expect, expectAbsent, expectVisible, proveProbe, screenshotSettled } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'

const LOCALE = process.env.WALK_LOCALE === 'en' ? 'en' : 'zh-CN'
const T = {
  'zh-CN': {
    projectName: '同名模型走查', creationTab: '创作', continueCreating: '继续创作',
    imageModel: '图片模型', bulkModel: '全部镜头的模型', anchorModel: '参考卡生成模型', expandAll: '全部展开',
    generateShot: (index) => `生成镜 ${index}`, generateAnchor: (name) => `生成参考卡「${name}」`,
    anchorName: '主角',
  },
  en: {
    projectName: 'Same-name model walk', creationTab: 'Create', continueCreating: 'Continue creating',
    imageModel: 'Image model', bulkModel: 'Model for all shots', anchorModel: 'Model for reference card', expandAll: 'Expand all',
    generateShot: (index) => `Generate shot ${index}`, generateAnchor: (name) => `Generate reference card "${name}"`,
    anchorName: 'Hero',
  },
}[LOCALE]

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-same-name-model-'))
const settingsDir = path.join(tempRoot, 'settings')
const projectsDir = path.join(tempRoot, 'projects')
const projectId = 'same-name-model-walk'
const projectRoot = path.join(projectsDir, projectId)
const outDir = path.join(repoRoot, 'tests/ux/shots/storyboard-model-same-name', LOCALE)
fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
fs.mkdirSync(outDir, { recursive: true })

// 「自定义那家」= 夹具自带的 loopback 供应商；「APIMart 替身」= 同一个 modelKey 的第二家。
const CUSTOM_LABEL = 'image2'
const APIMART_LABEL = 'GPT Image 2'
const STANDIN_VENDOR = 'apimart-standin'
const STANDIN_NAME = 'APIMart 替身'
const STANDIN_KEY = 'sk-apimart-standin'

const DESIGN = 'sb-same-name'
// 起点：每一镜、锚都**停在自定义那家**（这正是用户「选不上 APIMart」时的现场）。
const onCustom = { modelKey: FIXTURE_IMAGE_MODEL, modelVendor: FIXTURE_VENDOR }
const plan = {
  title: T.projectName,
  anchors: [{ id: 'hero', kind: 'character', name: T.anchorName, description: 'short hair, blue coat', carrier: 'visual', scope: 'selective', ...onCustom }],
  shots: [1, 2, 3].map((index) => ({
    index, shotId: `shot-${index}`, shotKind: 'image', durationSec: 3, anchorIds: [], prompt: `frame ${index}`, ...onCustom,
  })),
}
const project = {
  id: projectId, name: T.projectName, version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1,
  lastKnownRootPath: projectRoot,
  payload: {
    workbenchDocuments: [{
      id: 'doc-1', version: 1, title: T.projectName, updatedAt: 10,
      contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'same-name model walk' }] }] },
    }],
    activeDocumentId: 'doc-1',
    timeline: null,
    generationCanvas: { nodes: [], edges: [], selectedNodeIds: [], groups: [] },
    storyboardDesignsByDocumentId: {
      'doc-1': [{ id: DESIGN, documentId: 'doc-1', title: plan.title, plan, committed: false, status: 'draft', sourceDocumentUpdatedAt: 10, createdAt: 11, updatedAt: 12 }],
    },
  },
}
for (const target of [path.join(projectRoot, 'project.json'), path.join(projectRoot, '.nomi', 'project.json')]) {
  fs.writeFileSync(target, JSON.stringify(project, null, 2))
}

const fixture = await createAgentRuntimeFixture({ rootDir: repoRoot, settingsDir })

/** 夹具目录加第二家：同一个 modelKey、不同 vendor key、不同密钥、不同显示名（与用户现场同形）。 */
function addSameNameVendor() {
  const catalogPath = path.join(settingsDir, 'model-catalog.json')
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
  const customVendor = catalog.vendors.find((vendor) => vendor.key === FIXTURE_VENDOR)
  const customModel = catalog.models.find((model) => model.modelKey === FIXTURE_IMAGE_MODEL && model.vendorKey === FIXTURE_VENDOR)
  if (!customVendor || !customModel) throw new Error('夹具目录缺自定义那家的图片模型——走查前提不成立')
  customVendor.name = 'My Relay'
  customModel.labelZh = CUSTOM_LABEL
  catalog.vendors.push({ ...customVendor, key: STANDIN_VENDOR, name: STANDIN_NAME })
  // 目录新接入的在前：自定义那家更新，排在 APIMart 前面（「按名字取第一条」就会选错的那个顺序）。
  catalog.models.push({ ...customModel, vendorKey: STANDIN_VENDOR, labelZh: APIMART_LABEL, updatedAt: customModel.updatedAt - 1, createdAt: customModel.createdAt - 1 })
  for (const mapping of catalog.mappings.filter((entry) => entry.vendorKey === FIXTURE_VENDOR && entry.modelKey === FIXTURE_IMAGE_MODEL)) {
    catalog.mappings.push({ ...structuredClone(mapping), id: `${mapping.id}-standin`, vendorKey: STANDIN_VENDOR })
  }
  catalog.apiKeysByVendor[STANDIN_VENDOR] = { ...catalog.apiKeysByVendor[FIXTURE_VENDOR], vendorKey: STANDIN_VENDOR, apiKey: STANDIN_KEY }
  // 夹具家是 authType:'none'，{{user_api_key}} 不会被填（请求头只剩 "Bearer"），密钥分不出两家。
  // 改用各家**自己那份 mapping** 上的一个字面请求头：请求走哪家的 mapping，就带哪家的名字——
  // 这正是「执行时落到哪家」的直接证据（mapping 按 (vendor, modelKey) 选出）。
  for (const mapping of catalog.mappings) {
    if (mapping.modelKey !== FIXTURE_IMAGE_MODEL) continue
    mapping.create.headers = { ...mapping.create.headers, 'X-Walk-Vendor': mapping.vendorKey }
  }
  fs.writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`)
}
addSameNameVendor()

async function closeAppHard(instance) {
  const child = instance.process()
  await Promise.race([instance.close().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 8000))])
  if (child.exitCode === null) child.kill('SIGKILL')
}

const { app, win } = await launchNomiApp({
  name: `storyboard-model-same-name-${LOCALE}`, tempRoot, settingsDir, projectsDir, settleMs: 1200,
  initialLocalStorage: {
    'nomi:locale:v1': LOCALE, 'nomi-color-scheme': 'light',
    'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen',
  },
})
const failures = []
const evidence = { locale: LOCALE, requests: [], echoes: {} }
const snap = async (name) => { await screenshotSettled(win, { path: path.join(outDir, name) }) }

/** 真人动作：点开 NomiSelect（portal 弹层）挑一条「文字里同时含 want 与 vendorHint」的选项。 */
async function pickFromSelect(trigger, humanLabel, { want, vendorHint }) {
  await clickOrFail(trigger, `${humanLabel}下拉`)
  const listbox = win.locator('[role="listbox"]:visible')
  const opened = await proveProbe(listbox, `${humanLabel}下拉弹层已打开`)
  const options = win.locator('[role="option"]:visible')
  await expect(options, `${humanLabel}下拉点开了却一个选项都没有`).not.toHaveCount(0)
  const texts = (await options.allTextContents()).map((text) => text.trim())
  const index = texts.findIndex((text) => text.includes(want) && (!vendorHint || text.includes(vendorHint)))
  if (index < 0) throw new Error(`WALK FAIL: ${humanLabel}下拉里没有「${want}${vendorHint ? ` · ${vendorHint}` : ''}」。实际选项：${JSON.stringify(texts)}`)
  evidence.echoes[`${humanLabel}:options`] = texts
  await options.nth(index).click()
  await expectAbsent(listbox, { provenBy: opened, message: `${humanLabel}下拉选完没收起` })
  return texts[index]
}

/**
 * loopback 收到第 n 个图片请求 → 返回它（发出请求的 mapping 所属那家 = 实际花钱的那家）。
 * 这里每一下都是用户自己点的单份生成（生成镜 N / 生成参考卡），不弹付费确认卡（2026-09-25 拍板，
 * 判据按份数不按入口）；若中间弹卡而不点，请求永远发不出去——loopback 请求数恰好到 n 就是证据。
 */
async function captureRequest(expectedCount, label) {
  await expect
    .poll(() => fixture.images.length, { timeout: stationTimeout({ operations: 2 }), message: `${label}：点生成后 loopback 没收到图片请求` })
    .toBe(expectedCount)
  const record = fixture.images[expectedCount - 1]
  const vendor = String(record.headers?.['x-walk-vendor'] ?? 'unknown')
  evidence.requests.push({ label, vendor, model: record.body?.model ?? null, path: record.path })
  return { vendor, record }
}

try {
  const projectCard = win.locator('[data-project-card]', { hasText: T.projectName }).first()
  await expectVisible(projectCard, '隔离 profile 里的走查项目卡没出现')
  await projectCard.hover()
  const cont = projectCard.getByText(T.continueCreating, { exact: false }).first()
  if (await cont.isVisible().catch(() => false)) await cont.click()
  else await projectCard.dblclick()
  await clickOrFail(win.getByRole('button', { name: T.creationTab, exact: true }), '切到创作页')
  await clickOrFail(win.locator(`[data-storyboard-id="${DESIGN}"]`), '侧栏选中分镜设计')
  await expectVisible(win.locator('[data-storyboard-editor="true"]'), '分镜编辑器没有渲染')

  const rowModel = (index) => win.locator(`[data-storyboard-row="${index}"] [aria-label="${T.imageModel}"]`).first()
  // 起点回显：镜 1 停在自定义那家（模型框显示自定义那一组的名字）。
  await expect(rowModel(1), '起点：镜 1 应回显自定义那家（image2）').toContainText(CUSTOM_LABEL, { timeout: DEFAULT_TIMEOUT_MS })
  await snap('01-start-on-custom.png')

  // ── 阳性对照：镜 3 不动，就在自定义那家跑一次——仪器必须分得清两家 ──
  if (fixture.images.length !== 0) failures.push(`点生成之前就发生了 ${fixture.images.length} 次供应商调用`)
  await clickOrFail(win.locator('[data-storyboard-row="3"]').getByRole('button', { name: T.generateShot(3) }), '阳性对照：点镜 3 生成')
  const control = await captureRequest(1, '阳性对照（镜 3 留在自定义那家）')
  if (control.vendor !== FIXTURE_VENDOR) failures.push(`阳性对照失败：镜 3 在自定义那家，请求却来自 ${control.vendor}——仪器分不清两家，后面的断言不作数`)

  // ── ① 镜头卡底栏：镜 1 选 APIMart 那一组 → 回显 → 生成 → 请求去 APIMart ──
  await pickFromSelect(rowModel(1), '镜 1 模型框', { want: APIMART_LABEL })
  await expect(rowModel(1), '镜 1 选完 APIMart 后回显没换过去（0.20.1 那个症状）').toContainText(APIMART_LABEL, { timeout: DEFAULT_TIMEOUT_MS })
  evidence.echoes.shotCard = (await rowModel(1).textContent())?.trim()
  await snap('02-shot-card-picked-apimart.png')
  await clickOrFail(win.locator('[data-storyboard-row="1"]').getByRole('button', { name: T.generateShot(1) }), '点镜 1 生成')
  const shotCard = await captureRequest(2, '镜头卡底栏（镜 1）')
  if (shotCard.vendor !== STANDIN_VENDOR) failures.push(`镜头卡底栏：界面选的是 APIMart，请求却发给了 ${shotCard.vendor}`)

  // ── ② 批量条「统一模型」：选 APIMart 那一行 → 每一镜回显 → 生成镜 2 → 请求去 APIMart ──
  await pickFromSelect(win.locator(`[aria-label="${T.bulkModel}"]`).first(), '批量条模型框', { want: APIMART_LABEL, vendorHint: STANDIN_NAME })
  await expect(rowModel(2), '批量统一成 APIMart 后镜 2 回显没换过去').toContainText(APIMART_LABEL, { timeout: DEFAULT_TIMEOUT_MS })
  evidence.echoes.bulk = (await rowModel(2).textContent())?.trim()
  await snap('03-bulk-picked-apimart.png')
  await clickOrFail(win.locator('[data-storyboard-row="2"]').getByRole('button', { name: T.generateShot(2) }), '点镜 2 生成')
  const bulk = await captureRequest(3, '批量条（镜 2）')
  if (bulk.vendor !== STANDIN_VENDOR) failures.push(`批量条：界面选的是 APIMart，请求却发给了 ${bulk.vendor}`)

  // ── ③ 锚行：展开参考卡区 → 锚的模型框选 APIMart 那一组 → 回显 → 生成 → 请求去 APIMart ──
  await clickOrFail(win.getByRole('button', { name: T.expandAll, exact: true }), '展开参考卡区')
  const anchorModel = win.locator(`[data-anchor-card="hero"] [aria-label="${T.anchorModel}"]`).first()
  await expect(anchorModel, '起点：锚行应回显自定义那家').toContainText(CUSTOM_LABEL, { timeout: DEFAULT_TIMEOUT_MS })
  await pickFromSelect(anchorModel, '锚行模型框', { want: APIMART_LABEL })
  await expect(anchorModel, '锚行选完 APIMart 后回显没换过去').toContainText(APIMART_LABEL, { timeout: DEFAULT_TIMEOUT_MS })
  evidence.echoes.anchor = (await anchorModel.textContent())?.trim()
  await snap('04-anchor-picked-apimart.png')
  await clickOrFail(win.locator('[data-anchor-card="hero"]').getByRole('button', { name: T.generateAnchor(T.anchorName) }), '点锚「主角」生成')
  const anchor = await captureRequest(4, '锚行（主角）')
  if (anchor.vendor !== STANDIN_VENDOR) failures.push(`锚行：界面选的是 APIMart，请求却发给了 ${anchor.vendor}`)
  await snap('05-all-generated.png')

  fixture.assertClean()
} catch (error) {
  failures.push(`走查中断：${error?.message ?? error}`)
  await snap('99-failure.png').catch(() => undefined)
  // 现场留证：失败时界面上说了什么（toast / 行内错误），省得对着截图猜。
  evidence.failureScreenText = await win.evaluate(() => document.body.innerText.slice(-2000)).catch(() => null)
} finally {
  await closeAppHard(app)
  await fixture.close()
}

fs.writeFileSync(path.join(outDir, 'evidence.json'), `${JSON.stringify({ ...evidence, failures }, null, 2)}\n`)
if (failures.length) {
  console.error(`❌ 同名模型走查失败（${LOCALE}）：`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log(`✅ 同名模型走查通过（${LOCALE}）：对照请求去自定义那家；镜头卡 / 批量条 / 锚行选 APIMart → 回显 APIMart → 请求由 APIMart 那家发出`)
console.log(`   截图与证据：${outDir}`)
