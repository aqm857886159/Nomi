// 生成框 B3（I-b1a）**真机闭环**：打包同构的 Electron（开发态）+ 隔离资料目录（临时目录里的项目 / 设置 / userData），
// 全程**不点生成、不花钱**（目录里是本机 ux-local 供应商，没有任何 key 和外网；主进程网络闸只放行本机）。
//
// 一条用户路径把改造的每一处都走到：
//   画布节点生成框（选中 → 参考行小图 / 悬停小提示 / 悬停大图 / 提示词里的「小图 + 名字」）
//   → 参数面板（生成方式在顶部、切到首尾帧、对调、切回、改比例）
//   → 加参考（「+」→ 选择器 → 真上传一张图）
//   → 切模型（模型菜单只列模型）
//   → 四个复用宿主：节点错误报告 / 列表详情 / Agent 输入框的参考钮 / 分镜表镜头行。
// 中文 + 浅色一遍、英文 + 暗色一遍；截图进 docs/evidence/2026-10-19-b1a/real/。
//
// 用法：先 pnpm run build；node tests/ux/composer-b3-real.walk.mjs
import { stationTimeout } from './_station-budget.mjs'
import { uiText, uiTextPattern } from './full-walk/invariants.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { launchNomiApp, currentCatalogVersion } from './_launchApp.mjs'
import { clickOrFail, expectAbsent, expectVisible, proveProbe, screenshotSettled } from './_assert.mjs'
import { canvasFitView, collapseAgentPanel, ensureAgentPanelOpen } from './_shell.mjs'
import { openStoryboardEditor } from './_creationResourceTree.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const evidenceDir = path.join(repoRoot, 'docs/evidence/2026-10-19-b1a/real')
fs.mkdirSync(evidenceDir, { recursive: true })

const failures = []
const passed = []
function check(name, ok, detail) {
  if (ok) { passed.push(name); console.log(`  ✓ ${name}`) } else { failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}

const STAMP = '2026-10-19T00:00:00.000Z'
function seedProfile(root) {
  const settingsDir = path.join(root, 'settings')
  const projectsDir = path.join(root, 'projects')
  const projectId = 'composer-b3-real'
  const projectRoot = path.join(projectsDir, projectId)
  for (const dir of [path.join(projectRoot, '.nomi'), path.join(projectRoot, 'assets'), settingsDir]) fs.mkdirSync(dir, { recursive: true })
  const adapter = (state = 'verified') => ({ state, activeRevision: 'b3', publicationModes: ['text_to_video', 'image_to_video'], modes: [{ taskKind: 'text_to_video', state }, { taskKind: 'image_to_video', state }] })
  const model = (modelKey, labelZh, kind, archetypeId) => ({
    vendorKey: 'ux-local', modelKey, labelZh, kind, enabled: true, createdAt: STAMP, updatedAt: STAMP,
    meta: { archetypeId, ...(kind === 'video' ? { adapter: adapter() } : {}) },
  })
  fs.writeFileSync(path.join(settingsDir, 'model-catalog.json'), JSON.stringify({
    version: currentCatalogVersion(),
    vendors: [{ key: 'ux-local', name: 'UX Local', enabled: true, authType: 'none', providerKind: 'openai-compatible', createdAt: STAMP, updatedAt: STAMP }],
    models: [
      model('seedance-2-5', 'Seedance 2.5', 'video', 'seedance-2.5'),
      model('wan2.7', 'Wan 2.7', 'video', 'wan-2.7'),
      model('veo3.1', 'Veo 3.1', 'video', 'veo-3.1'),
      model('gpt-image-2', 'GPT Image 2', 'image', 'gpt-image-2'),
    ],
    mappings: [], apiKeysByVendor: {},
  }, null, 2))
  const demo = (name) => path.join(repoRoot, 'resources/onboarding-demo', name)
  fs.copyFileSync(demo('shot-1.jpg'), path.join(projectRoot, 'assets', 'portrait.jpg'))
  fs.copyFileSync(demo('shot-2.jpg'), path.join(projectRoot, 'assets', 'seaside.jpg'))
  fs.copyFileSync(demo('shot-3.jpg'), path.join(projectRoot, 'assets', 'forest.jpg'))
  fs.copyFileSync(demo('shot-4.jpg'), path.join(projectRoot, 'assets', 'upload-me.jpg'))
  const url = (name) => `nomi-local://asset/${encodeURIComponent(projectId)}/assets/${name}`
  const imageNode = (id, title, file, x) => ({
    id, kind: 'image', categoryId: 'shots', title, prompt: '', position: { x, y: 0 }, size: { width: 220, height: 124 }, status: 'success',
    result: { id: `${id}-r`, type: 'image', url: url(file), thumbnailUrl: url(file), createdAt: 1 },
  })
  const videoMeta = (extra = {}) => ({ modelKey: 'seedance-2-5', modelVendor: 'ux-local', vendor: 'ux-local', archetype: { id: 'seedance-2.5', modeId: 'omni' }, aspect_ratio: '16:9', duration: 5, ...extra })
  const mention = (file) => `@[asset:${encodeURIComponent(url(file))}]`
  const nodes = [
    imageNode('ref-portrait', '女主肖像', 'portrait.jpg', 0),
    imageNode('ref-seaside', '海边小镇', 'seaside.jpg', 260),
    imageNode('ref-forest', '树林', 'forest.jpg', 520),
    {
      id: 'target-video', kind: 'video', categoryId: 'shots', title: '海边清晨', position: { x: 160, y: 300 }, size: { width: 340, height: 192 }, status: 'idle',
      prompt: `${mention('portrait.jpg')} 走进 ${mention('seaside.jpg')}，镜头缓慢推近。`, meta: videoMeta({ referenceImageUrls: [url('forest.jpg')] }),
    },
    {
      id: 'error-video', kind: 'video', categoryId: 'shots', title: '失败的镜头', position: { x: 700, y: 300 }, size: { width: 340, height: 192 }, status: 'error',
      error: 'InvalidParameter: resolution "1080p" is not supported by this model', prompt: '纸船缓缓漂过水洼，镜头固定。', meta: videoMeta({ resolution: '1080p' }),
    },
  ]
  // 参考图结构重写的往返走查（2026-10-22）：一张只有 3 张上传参考的视频卡、一张放满 30 张上传参考的视频卡（Seedance 2.5 参考上限 30）。
  // 地址刻意不用画布上图片卡的产物：那些地址打开工程时会被迁移成连线（projectV51ToV60Migration），就不是「上传」了。
  const demoShots = ['shot-1.jpg', 'shot-2.jpg', 'shot-3.jpg', 'shot-4.jpg', 'shot-5.jpg', 'shot-6.jpg', 'shot-7.jpg', 'shot-8.jpg']
  const thirty = Array.from({ length: 30 }, (_, i) => {
    const file = `ref-${String(i + 1).padStart(2, '0')}.jpg`
    fs.copyFileSync(demo(demoShots[i % demoShots.length]), path.join(projectRoot, 'assets', file))
    return url(file)
  })
  nodes.push(
    { id: 'trio-video', kind: 'video', categoryId: 'shots', title: '三张参考', position: { x: 700, y: 700 }, size: { width: 340, height: 192 }, status: 'idle',
      prompt: '海边的清晨慢慢过渡到傍晚。', meta: videoMeta({ referenceImageUrls: thirty.slice(0, 3) }) },
    { id: 'edges-video', kind: 'video', categoryId: 'shots', title: '两条参考连线', position: { x: 1240, y: 700 }, size: { width: 340, height: 192 }, status: 'idle',
      prompt: '从清晨推到傍晚。', meta: videoMeta({ archetype: { id: 'seedance-2.5', modeId: 'firstlast' } }) },
    { id: 'thirty-video', kind: 'video', categoryId: 'shots', title: '三十张参考', position: { x: 160, y: 700 }, size: { width: 340, height: 192 }, status: 'idle',
      prompt: '镜头缓慢推近。', meta: videoMeta({ referenceImageUrls: thirty }) },
    // 旧工程（#1269 条件 4）：参考方式的节点里还存着一张早先首尾帧方式留下的 firstFrameUrl——旧界面在参考方式下根本不显示它。
    { id: 'legacy-video', kind: 'video', categoryId: 'shots', title: '旧工程残留', position: { x: 1240, y: 300 }, size: { width: 340, height: 192 }, status: 'idle',
      prompt: '海边的清晨。', meta: videoMeta({ referenceImageUrls: thirty.slice(3, 5), firstFrameUrl: thirty[5] }) },
  )
  // 画布最下面放一张远处的小文本卡：「适应视图」按全部节点的包围盒摆，有了它目标卡的生成框就落在底部时间轴胶囊和缩放条上方，点得到。
  nodes.push({ id: 'memo', kind: 'text', categoryId: 'shots', title: '备忘', prompt: '备忘', position: { x: 160, y: 1250 }, size: { width: 220, height: 120 }, status: 'success', result: { id: 'memo-r', type: 'text', text: '备忘', createdAt: 1 } })
  const edges = [
    { id: 'e1', source: 'ref-portrait', target: 'target-video', mode: 'reference', order: 0 },
    { id: 'e2', source: 'ref-seaside', target: 'target-video', mode: 'reference', order: 1 },
    // 用户 10-22 拍板 ⑪：两条参考连线进首尾帧，第一条落首帧、第二条落尾帧。
    { id: 'e3', source: 'ref-forest', target: 'edges-video', mode: 'reference', order: 0 },
    { id: 'e4', source: 'ref-portrait', target: 'edges-video', mode: 'reference', order: 1 },
  ]
  const designId = 'b3-design'
  const shot = (index, prompt, bindings) => ({
    index, shotId: `shot-${index}`, shotKind: 'video', durationSec: 5, anchorIds: [], modelKey: 'seedance-2-5', modeId: 'omni', prompt,
    ...(bindings ? { referenceBindings: { image_ref: bindings } } : {}),
  })
  const plan = {
    title: '参考行走查', anchors: [],
    shots: [
      shot(1, `${mention('portrait.jpg')} 走进 ${mention('seaside.jpg')}，镜头缓慢推近。`, [{ url: url('portrait.jpg'), name: '女主肖像' }, { url: url('seaside.jpg'), name: '海边小镇' }]),
      shot(2, '她回头，车灯扫过。'),
    ],
  }
  const project = {
    id: projectId, name: '参考行走查', version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1, lastKnownRootPath: projectRoot,
    payload: {
      workbenchDocuments: [{ id: 'doc-1', version: 1, title: '走查', updatedAt: 10, contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '雨夜。' }] }] } }],
      activeDocumentId: 'doc-1', timeline: null,
      generationCanvas: { nodes, edges, selectedNodeIds: [], groups: [] },
      storyboardDesignsByDocumentId: { 'doc-1': [{ id: designId, documentId: 'doc-1', title: plan.title, plan, committed: false, status: 'draft', sourceDocumentUpdatedAt: 10, createdAt: 11, updatedAt: 12 }] },
    },
  }
  for (const file of [path.join(projectRoot, 'project.json'), path.join(projectRoot, '.nomi', 'project.json')]) fs.writeFileSync(file, JSON.stringify(project, null, 2))
  return { settingsDir, projectsDir, projectRoot, designId }
}

async function runPass({ locale, scheme }) {
  const en = locale === 'en'
  const tag = `${locale === 'en' ? 'en' : 'zh'}-${scheme}`
  const root = makeTempDir(`nomi-b3-real-${tag}-`)
  const profile = seedProfile(root)
  const launched = await launchNomiApp({
    name: `composer-b3-real-${tag}`, tempRoot: root, settingsDir: profile.settingsDir, projectsDir: profile.projectsDir, settleMs: 1500,
    mainRequire: [path.join(repoRoot, 'scripts', 'walkthrough-network-guard.cjs'), ...(process.platform === 'linux' ? [] : [path.join(repoRoot, 'tests', 'ux', '_quietWalk.cjs')])],
    initialLocalStorage: { 'nomi:locale:v1': locale, 'nomi-color-scheme': scheme, 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen', __nomiE2E: '1' },
    env: { NOMI_TEST_NETWORK_GUARD: '1', NOMI_DISABLE_AUTO_UPDATE: '1' },
  })
  const { app, win } = launched
  win.setDefaultTimeout(stationTimeout())
  const errors = []
  win.on('pageerror', (error) => errors.push(String(error).slice(0, 200)))
  const snap = async (name) => { await screenshotSettled(win, { path: path.join(evidenceDir, `${name}-${tag}.png`) }) }
  const T = (zh, enText) => (en ? enText : zh)
  const section = async (name, fn) => {
    try { await fn() } catch (error) {
      failures.push(`[${tag}] ${name} 中断：${String(error?.message || error).split('\n')[0]}`)
      console.error(`  ✗ [${tag}] ${name} 中断：${String(error?.message || error).split('\n')[0]}`)
      await snap(`99-failure-${name.replace(/\W+/g, '-')}`).catch(() => {})
    }
  }
  const composer = () => win.locator('.generation-canvas-v2-node__composer').last()
  const selectNode = async (id) => {
    await win.locator('.generation-canvas-v2__stage .react-flow__pane').first().click({ position: { x: 24, y: 24 } }).catch(() => {})
    await win.locator(`.react-flow__node[data-id="${id}"]`).click({ position: { x: 8, y: 8 } })
    await expectVisible(composer(), `选中 ${id} 后生成框出现`)
  }

  try {
    const card = win.locator('[data-project-card]', { hasText: '参考行走查' }).first()
    await expectVisible(card, '项目库里有走查项目')
    await card.hover()
    const open = card.getByText(new RegExp(`${uiText('zh-CN', 'library.continueCreating')}|${uiText('en', 'library.continueCreating')}`), { exact: false }).first()
    if (await open.isVisible().catch(() => false)) await open.click(); else await card.dblclick()
    await clickOrFail(win.getByRole('button', { name: T('生成', 'Generate'), exact: true }), '生成工作区')
    await expectVisible(win.locator('.generation-canvas-v2__stage'), 'canvas stage')
    await collapseAgentPanel(win).catch(() => {})
    await canvasFitView(win, 'show nodes')

    await section('canvas-composer', async () => {
      await selectNode('target-video')
      const c = composer()
      const tiles = await c.locator('[data-reference-row] [data-asset-tile]').count()
      check(`[${tag}] 参考行有 3 张小图（2 条连线 + 1 张上传）`, tiles === 3, String(tiles))
      const entry = await c.locator('[data-reference-entry]').boundingBox()
      check(`[${tag}] 点选钮 40px（缩放前后同比例，宽高相等）`, Boolean(entry) && Math.abs(entry.width - entry.height) <= 1)
      const chipNames = await c.locator('[data-storyboard-mention-chip]').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')))
      check(`[${tag}] 提示词里写「小图 + 名字」`, chipNames.join() === '女主肖像,海边小镇', chipNames.join())
      await snap('01-canvas-composer')
      // 悬停：小提示 → 大图
      const first = c.locator('[data-reference-row] [data-asset-tile]').first()
      await first.hover()
      await expectVisible(win.locator('[data-asset-tile-tip]'), '悬停小提示')
      check(`[${tag}] 连线来的图悬停提示带「断开连线」`, /断开连线|disconnect/i.test((await win.locator('[data-asset-tile-tip]').textContent()) ?? ''))
      await snap('02-hover-tip')
      await expectVisible(win.locator('[data-asset-tile-zoom]'), '悬停大图', stationTimeout())
      await snap('03-hover-zoom')
      await win.mouse.move(5, 5)
    })

    await section('params-and-modes', async () => {
      await selectNode('target-video')
      const c = composer()
      await c.locator('[data-parameter-summary]').click()
      const panel = win.locator('[data-agent-parameter-panel]')
      await expectVisible(panel, '参数面板')
      const modes = await panel.locator('[data-agent-generation-mode] [role="radio"]').allTextContents()
      check(`[${tag}] 生成方式在面板顶部，没有文生`, modes.length >= 2 && !modes.some((m) => /文生|text/i.test(m)), modes.join('|'))
      await snap('04-params-panel')
      await panel.locator('[data-agent-generation-mode] [role="radio"]', { hasText: new RegExp('首尾帧|First / Last') }).first().click()
      // 面板是盖在生成框上面的浮层：先收起它，再看下面的格。
      await win.keyboard.press('Escape')
      await expectVisible(c.locator('[data-asset-slot-label]').first(), '首尾帧格出现')
      check(`[${tag}] 切到首尾帧：首帧 / 尾帧两格 + 对调钮`, (await c.locator('[data-asset-slot-label]').count()) === 2 && (await c.locator('[data-reference-swap]').count()) === 1)
      const chipsInFirstLast = await c.locator('[data-storyboard-mention-chip]').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')))
      check(`[${tag}] 切到首尾帧后提示词里的小块仍写名字（不退回「参考图」）`, chipsInFirstLast.join() === '女主肖像,海边小镇', chipsInFirstLast.join())
      await snap('05-first-last')
      const before = await c.locator('[data-asset-slot]').evaluateAll((els) => els.map((el) => el.querySelector('img')?.getAttribute('src') ?? 'empty').join('|'))
      await c.locator('[data-reference-swap]').click()
      await win.waitForFunction((was) => [...document.querySelectorAll('.generation-canvas-v2-node__composer [data-asset-slot]')].map((el) => el.querySelector('img')?.getAttribute('src') ?? 'empty').join('|') !== was, before, { timeout: stationTimeout() })
      check(`[${tag}] 对调钮真的把首帧 / 尾帧换了位置`, true)
      // 切回参考，参考的图还在（切回参考还在）
      await win.keyboard.press('Escape')
      await c.locator('[data-parameter-summary]').click()
      await panel.locator('[data-agent-generation-mode] [role="radio"]').first().click()
      await expectVisible(c.locator('[data-reference-row] [data-asset-tile]').first(), '切回参考后小图还在')
      // 改比例
      await panel.getByRole('radio', { name: '9:16' }).first().click()
      // 面板打开期间摘要钮是冻结的（宽度稳定）：收起以后再读。
      await win.keyboard.press('Escape')
      await win.waitForFunction(() => /9:16/.test(document.querySelector('.generation-canvas-v2-node__composer [data-parameter-summary]')?.getAttribute('data-parameter-summary') ?? ''), null, { timeout: stationTimeout() })
      check(`[${tag}] 改比例：摘要钮跟着变成 9:16`, true)
    })

    await section('add-reference', async () => {
      await selectNode('target-video')
      const c = composer()
      const before = await c.locator('[data-reference-row] [data-asset-tile]').count()
      await c.locator('[data-reference-add-entry]').click()
      const picker = win.locator('[data-testid="asset-picker"]').first()
      await expectVisible(picker, '「+」打开选择器')
      await snap('06-add-reference-picker')
      await picker.locator('input[type="file"]').setInputFiles(path.join(repoRoot, 'resources/onboarding-demo/shot-5.jpg'))
      await win.waitForFunction((n) => document.querySelectorAll('.generation-canvas-v2-node__composer [data-reference-row] [data-asset-tile]').length > n, before, { timeout: stationTimeout() })
      check(`[${tag}] 加参考：真上传一张图后小图 +1`, true)
      await win.keyboard.press('Escape')
      await snap('07-after-upload')
    })

    // ── 功能普查里「保留」的几项，在真 App 里各摸一遍（断言名 = 清单元素 id）──
    await section('keep-canvas-pick', async () => {
      await selectNode('target-video')
      await composer().locator('[data-reference-entry]').click()
      await expectVisible(win.locator('[data-canvas-pick-bar]'), '画布点选进行态')
      check(`[${tag}] board:ComposerB3/keep.canvas-pick.mode：点选钮进入点选态`, true)
      await win.keyboard.press('Escape')
      await win.waitForFunction(() => !document.querySelector('[data-canvas-pick-bar]'), null, { timeout: stationTimeout() })
      check(`[${tag}] board:ComposerB3/keep.canvas-pick.mode.esc：Esc 退出点选态`, true)
    })
    await section('keep-picker', async () => {
      await selectNode('target-video')
      await composer().locator('[data-reference-add-entry]').click()
      const picker = win.locator('[data-testid="asset-picker"]').first()
      await expectVisible(picker, '选择器')
      const surface = await picker.evaluate((el) => ({ search: Boolean(el.querySelector('input:not([type="file"])')), file: Boolean(el.querySelector('input[type="file"]')) }))
      check(`[${tag}] board:ComposerB3/keep.picker.surface：选择器带搜索框和上传入口`, surface.search && surface.file, JSON.stringify(surface))
      await win.keyboard.press('Escape')
      await win.waitForFunction(() => !document.querySelector('[data-testid="asset-picker"]'), null, { timeout: stationTimeout() })
    })
    await section('keep-prompt', async () => {
      await selectNode('target-video')
      const c = composer()
      const before = await c.locator('[data-storyboard-mention-chip]').count()
      await c.locator('[data-reference-row] [data-asset-tile]').nth(2).click()
      await win.waitForFunction((n) => document.querySelectorAll('.generation-canvas-v2-node__composer [data-storyboard-mention-chip]').length > n, before, { timeout: stationTimeout() })
      check(`[${tag}] board:ComposerB3/keep.prompt.tile-insert：点参考小图在光标处插入引用`, true)
      await c.locator('[data-prompt-box] .ProseMirror').click()
      await win.keyboard.press('End')
      await win.keyboard.type(' @')
      await expectVisible(win.locator('[data-mention-list]'), '@ 候选')
      check(`[${tag}] board:ComposerB3/keep.prompt.at-mention：打 @ 弹出候选`, true)
      await win.keyboard.press('Escape')
    })
    await section('keep-tools', async () => {
      await selectNode('target-video')
      const c = composer()
      await c.locator('[data-prompt-tool="translate"]').hover()
      await expectVisible(win.getByRole('tooltip').first(), '工具名称提示')
      check(`[${tag}] board:ComposerB3/keep.bar.tool-tooltips：悬停工具钮出名字`, true)
      await c.locator('[data-prompt-tool="effects"]').click()
      await snap('14-presets-library')
      check(`[${tag}] board:ComposerB3/keep.presets.library：点提示词预设钮不报错（弹层见截图 14）`, true)
      await win.keyboard.press('Escape')
      await c.locator('[data-prompt-tool="optimize"]').click()
      await expectVisible(win.locator('textarea, input[type="text"]').last(), '优化弹层的想法输入')
      check(`[${tag}] board:ComposerB3/keep.optimize.popover：点优化钮打开想法输入`, true)
      await snap('15-optimize-popover')
      await win.keyboard.press('Escape')
    })
    await section('keep-params-behavior', async () => {
      await selectNode('target-video')
      const c = composer()
      await c.locator('[data-parameter-summary]').click()
      const panel = win.locator('[data-agent-parameter-panel]')
      await expectVisible(panel, '参数面板')
      const kinds = { slider: await panel.locator('[role="slider"], input[type="range"], .mantine-Slider-root').count(), toggle: await panel.locator('[role="switch"], input[type="checkbox"]').count() }
      check(`[${tag}] board:ComposerB3/keep.params.control-kinds：面板里有滑杆和开关`, kinds.slider >= 1 && kinds.toggle >= 1, JSON.stringify(kinds))
      await panel.getByRole('radio', { name: '4:3' }).first().click()
      await panel.getByRole('radio', { name: '3:4' }).first().click()
      check(`[${tag}] board:ComposerB3/keep.params.interaction：连改两项面板不关`, await panel.isVisible())
      await win.keyboard.press('Escape')
      await win.waitForFunction(() => !document.querySelector('[data-agent-parameter-panel]'), null, { timeout: stationTimeout() })
      check(`[${tag}] board:ComposerB3/keep.params.popover-behavior：Esc 收起面板`, true)
    })
    await section('keep-run-and-host', async () => {
      await selectNode('error-video')
      const c = composer()
      await c.locator('[data-parameter-summary]').click()
      await win.locator('[data-agent-parameter-panel] [data-agent-generation-mode] [role="radio"]', { hasText: new RegExp('首尾帧|First / Last') }).first().click()
      await win.keyboard.press('Escape')
      const reason = await c.locator('[data-bar-segment="generate"]').evaluate((el) => ({ disabled: el.disabled, title: el.closest('span[title]')?.getAttribute('title') ?? '' }))
      check(`[${tag}] board:ComposerB3/keep.run.disabled-reason：缺必需首帧时 ↑ 禁用并写原因`, reason.disabled && reason.title.length > 4, JSON.stringify(reason))
      // 多选不挂生成框（先证探针：单选时它在）
      const proof = await proveProbe(win.locator('.generation-canvas-v2-node__composer'), '单选节点时生成框挂在节点下')
      await win.locator('.react-flow__node[data-id="target-video"]').click({ position: { x: 8, y: 8 }, modifiers: ['Shift'] })
      await expectAbsent(win.locator('.generation-canvas-v2-node__composer'), { provenBy: proof })
      check(`[${tag}] board:ComposerB3/keep.host.canvas-mount：多选时不挂生成框`, true)
    })

    await section('switch-model', async () => {
      await selectNode('target-video')
      const c = composer()
      await c.locator('[data-bar-segment="model-params"] button').first().click()
      const options = win.locator('[role="option"]')
      await expectVisible(options.first(), '模型菜单')
      const rows = await options.allTextContents()
      check(`[${tag}] 模型菜单只列模型（没有说明小字），底部有隐藏模型`, rows.length >= 3 && rows.every((r) => r.length < 64) && /隐藏模型|Hide/.test((await win.locator('body').innerText())), rows.join('|'))
      await snap('08-model-menu')
      await options.filter({ hasText: 'Wan 2.7' }).first().click()
      await win.waitForFunction(() => /Wan 2\.7/.test(document.querySelector('.generation-canvas-v2-node__composer [data-bar-segment="model-params"]')?.textContent ?? ''), null, { timeout: stationTimeout() })
      check(`[${tag}] 换到 Wan 2.7：底栏换了模型，生成框仍在`, (await c.locator('[data-reference-row], [data-reference-entry]').count()) >= 1)
      await snap('09-after-model-switch')
    })

    // ── 往返（参考图结构重写的验收线）：节点上只存一份有序参考列表，换方式 / 换模型都不改它 ──
    const pickMode = async (pattern) => {
      const c = composer()
      await c.locator('[data-parameter-summary]').click()
      const panel = win.locator('[data-agent-parameter-panel]')
      await expectVisible(panel, '参数面板')
      await panel.locator('[data-agent-generation-mode] [role="radio"]', { hasText: pattern }).first().click()
      await win.keyboard.press('Escape')
    }
    const pickModel = async (name) => {
      await composer().locator('[data-bar-segment="model-params"] button').first().click()
      await win.locator('[role="option"]').filter({ hasText: name }).first().click()
      await win.waitForFunction((label) => (document.querySelector('.generation-canvas-v2-node__composer [data-bar-segment="model-params"]')?.textContent ?? '').includes(label), name, { timeout: stationTimeout() })
      await win.keyboard.press('Escape')
    }
    const tileCounts = () => composer().evaluate((el) => ({
      tiles: el.querySelectorAll('[data-reference-row] [data-asset-tile]').length,
      unused: el.querySelectorAll('[data-reference-row] [data-reference-unused]').length,
      slots: el.querySelectorAll('[data-asset-slot] [data-asset-tile]').length,
    }))
    await section('roundtrip-three-refs', async () => {
      await selectNode('trio-video')
      const before = await tileCounts()
      await pickMode(new RegExp('首尾帧|First / Last'))
      await expectVisible(composer().locator('[data-asset-slot-label]').first(), '首尾帧格出现')
      const mid = await tileCounts()
      await snap('20-roundtrip-three-firstlast')
      const trioState = await win.evaluate(() => { const st = window.__nomiCanvasStore?.getState(); const n = st?.nodes.find((node) => node.id === 'trio-video'); return { meta: n ? { archetype: n.meta?.archetype, refs: n.meta?.referenceImageUrls, gap: n.meta?.referenceFirstFrameEmpty, first: n.meta?.firstFrameUrl, last: n.meta?.lastFrameUrl } : null, edges: st?.edges.filter((e) => e.target === 'trio-video').map((e) => [e.source, e.mode]) } })
      await pickMode(/^(参考|Reference)$/)
      await win.waitForFunction(() => !document.querySelector('.generation-canvas-v2-node__composer [data-reference-unused]'), null, { timeout: stationTimeout() })
      const back = await tileCounts()
      await snap('21-roundtrip-three-back')
      check(`[${tag}] 往返：3 张上传参考 → 首尾帧（首帧、尾帧 + 1 张未用到）→ 参考，3 张一张不少`, before.tiles === 3 && mid.slots === 2 && mid.unused === 1 && back.tiles === 3 && back.unused === 0, JSON.stringify({ before, mid, back, trioState }))
    })
    await section('remove-unused', async () => {
      // ⑫（用户 10-22 拍板）：3 张上传参考切首尾帧，第 3 张「未用到」悬停出同一颗 ×，点了从节点上删掉；切回参考只剩 2 张。
      await selectNode('trio-video')
      await pickMode(new RegExp('首尾帧|First / Last'))
      await expectVisible(composer().locator('[data-reference-unused] [data-asset-tile]').first(), '未用到那张')
      await composer().locator('[data-reference-unused] [data-asset-tile]').first().hover()
      await composer().locator('[data-reference-unused] [data-asset-tile-remove]').first().click()
      await win.waitForFunction(() => !document.querySelector('.generation-canvas-v2-node__composer [data-reference-unused]'), null, { timeout: stationTimeout() })
      const mid = await tileCounts()
      await pickMode(/^(参考|Reference)$/)
      await win.waitForFunction(() => document.querySelectorAll('.generation-canvas-v2-node__composer [data-reference-row] [data-asset-tile]').length === 2, null, { timeout: stationTimeout() }).catch(() => {})
      const back = await tileCounts()
      await win.mouse.move(5, 5)
      await snap('25-remove-unused-back')
      check(`[${tag}] 「未用到」那张点 × 删掉：首尾帧 2 格不动，切回参考只剩 2 张（用户 10-22 拍板 ⑫）`, mid.slots === 2 && mid.unused === 0 && back.tiles === 2, JSON.stringify({ mid, back }))
    })
    await section('legacy-parked', async () => {
      // 旧工程以前藏着的首帧：淡显「未用到」、悬停写「名字 · 点一下用上」；点一下放回在用，一张不少（#1269 条件 4）。
      await selectNode('legacy-video')
      const parked = composer().locator('[data-reference-parked] [data-asset-tile]').first()
      await expectVisible(parked, '旧工程残留的首帧淡显「未用到」')
      const before = await composer().locator('[data-reference-row] [data-asset-tile]').count()
      await parked.hover()
      await expectVisible(win.locator('[data-asset-tile-tip]'), '悬停小提示')
      const tip = (await win.locator('[data-asset-tile-tip]').textContent()) ?? ''
      check(`[${tag}] board:ComposerB3/ref.slot.unused · 旧工程残留先放一边，悬停写「点一下用上」（真机）`, new RegExp(uiTextPattern(uiText(en ? 'en' : 'zh-CN', 'assetLibrary.refRow.useParked'))).test(tip), tip)
      await snap('26-legacy-parked-hover')
      await parked.click()
      await win.waitForFunction(() => !document.querySelector('.generation-canvas-v2-node__composer [data-reference-unused]'), null, { timeout: stationTimeout() })
      const after = { tiles: await composer().locator('[data-reference-row] [data-asset-tile]').count(), unused: await composer().locator('[data-reference-row] [data-reference-unused]').count() }
      check(`[${tag}] board:ComposerB3/ref.slot.unused · 点一下用上：放回在用，一张不少（真机）`, after.tiles === before && after.unused === 0, JSON.stringify({ before, after }))
      await snap('27-legacy-restored')
    })

    await section('two-ref-edges-into-first-last', async () => {
      await selectNode('edges-video')
      await expectVisible(composer().locator('[data-asset-slot] [data-asset-tile]').first(), '首帧格里有连线来的图')
      const counts = await tileCounts()
      await win.mouse.move(5, 5)
      await snap('24-two-ref-edges-first-last')
      check(`[${tag}] 两条参考连线进首尾帧：首帧、尾帧各一条，没有未用到（用户 10-22 拍板 ⑪）`, counts.slots === 2 && counts.unused === 0, JSON.stringify(counts))
    })
    await section('roundtrip-thirty-refs', async () => {
      await selectNode('thirty-video')
      const before = await tileCounts()
      await pickModel('Veo 3.1')
      await expectVisible(composer().locator('[data-reference-unused]').first(), 'Veo 3.1 下放不下的图淡显「未用到」')
      const there = await tileCounts()
      await snap('22-roundtrip-thirty-veo')
      const metaOf = () => win.evaluate(() => { const n = window.__nomiCanvasStore?.getState().nodes.find((node) => node.id === 'thirty-video'); return n ? { archetype: n.meta?.archetype, modelKey: n.meta?.modelKey, refs: (n.meta?.referenceImageUrls ?? []).length } : null })
      const atVeo = await metaOf()
      await pickModel('Seedance 2.5')
      await win.waitForFunction(() => !document.querySelector('.generation-canvas-v2-node__composer [data-reference-unused]'), null, { timeout: stationTimeout() }).catch(() => {})
      const back = { ...(await tileCounts()), atVeo, meta: await metaOf() }
      await snap('23-roundtrip-thirty-back')
      check(`[${tag}] 往返：30 张 → Veo 3.1（在用 + 未用到 = 30）→ 切回 Seedance 2.5，30 张一张不少`, before.tiles === 30 && there.tiles === 30 && there.unused > 0 && back.tiles === 30 && back.unused === 0, JSON.stringify({ before, there, back }))
    })

    await section('host-error-report', async () => {
      await selectNode('error-video')
      check(`[${tag}] 失败卡盖住节点正文，下面生成框在`, (await win.locator('.react-flow__node[data-id="error-video"] [role="alert"]').count()) >= 1 && (await composer().locator('[data-prompt-box]').count()) === 1)
      await snap('10-error-report')
    })

    await section('host-list-detail', async () => {
      await win.locator('[data-generation-view-switcher]').first().click()
      await expectVisible(win.locator('[data-generation-list]'), '列表视图')
      await win.locator('[data-list-card]', { hasText: T('海边清晨', '海边清晨') }).first().click()
      await expectVisible(win.locator('[data-composer-host="inline"]'), '列表详情里的生成框（inline 宿主）')
      check(`[${tag}] 列表详情用同一个生成框`, (await win.locator('[data-composer-host="inline"] [data-bar-segment="generate"]').count()) === 1)
      await snap('11-list-detail')
      await win.locator('[data-generation-view-switcher]').first().click()
      await expectVisible(win.locator('.generation-canvas-v2__stage'), '回到画布')
    })

    await section('host-agent-input', async () => {
      await ensureAgentPanelOpen(win)
      const pointer = win.locator('[data-agent-surface="generation"] [data-reference-entry]').first()
      await expectVisible(pointer, 'Agent 输入框的参考钮')
      const box = await pointer.boundingBox()
      check(`[${tag}] Agent 输入框参考钮 28px`, Boolean(box) && Math.round(box.width) === 28, JSON.stringify(box))
      await snap('12-agent-input')
    })

    await section('host-storyboard-row', async () => {
      await clickOrFail(win.getByRole('button', { name: T('创作', 'Create'), exact: true }), '切到创作页')
      await openStoryboardEditor(win, profile.designId, '打开分镜')
      await clickOrFail(win.getByRole('button', { name: /打开分镜|再次编辑|Open storyboard|Edit again/ }).first(), '打开分镜页').catch(() => {})
      const row = win.locator('[data-storyboard-editor="true"] [data-storyboard-row="1"]').first()
      await expectVisible(row, '分镜表第 1 行')
      const chips = await row.locator('[data-storyboard-mention-chip]').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')))
      check(`[${tag}] 分镜行提示词里写名字`, chips.join() === '女主肖像,海边小镇', chips.join())
      check(`[${tag}] 分镜行参考小图`, (await row.locator('[data-storyboard-ref-thumb] [data-asset-tile]').count()) === 2)
      await snap('13-storyboard-row')
    })
  } finally {
    if (errors.length) failures.push(`[${tag}] 页面抛错 ${errors.length} 条：${errors.slice(0, 2).join(' | ')}`)
    await Promise.race([app.close().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 8000))])
    await launched.close()
  }
}

await runPass({ locale: 'zh-CN', scheme: 'light' })
await runPass({ locale: 'en', scheme: 'dark' })

console.log(`\n真机走查：通过 ${passed.length} 条${failures.length ? `，失败 ${failures.length} 条` : ''}；截图 ${evidenceDir}`)
if (failures.length) {
  console.error(failures.map((f) => `  ✗ ${f}`).join('\n'))
  process.exit(1)
}
