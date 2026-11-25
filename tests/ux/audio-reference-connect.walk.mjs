// R13 走查（2026-09-11，用户反馈「声音节点连不了视频节点」+「ComfyUI 音频输入用不了」根因修复）。
//
// 用户现场：拖一个「声音」节点想当参考连到 Seedance 全能参考视频节点（模型档案早就声明了
// audio_ref 参考音频槽），画布却直接拒绝这条连线——根因是共享的参考边分类器/门岗
// （electron/shared/modelArchetypes/anchorPolicy.ts + referenceEdgeCapability.ts）从没认过
// audio 是一种可参考资产类型，不管目标模型声明了什么。
//
// 这个走查验的是**真实画布连线 → composer 判定 → 请求体字段**这条完整链路，不是单测里的纯函数：
// ① 先证明零参考不能选全能参考，发送按钮走文生方式（探针基线）；
// ② 只连音频参考边 → 仍是灰的，但原因必须是「Seedance 2.0 的音频不能单独用，需要搭配图/视频」
//    （供应商文档明写的跨槽依赖），不能是「根本连不上」——两者体感完全不同，前者是诚实的产品
//    约束，后者是本次修的 bug；
// ③ 再连一段图片参考 → 按钮变活，槽位视觉上确实吃到了这条音频边；
// ④ 干跑（不花钱）构造最终请求参数——复用生产同一份 resolveGenerationReferences +
//    buildArchetypeInputParams，断言音频参考槽对应的请求字段真的带着这段音频的 URL，
//    不是识别对了、真发的时候又在半路被丢（字段名不 hardcode——不同 archetype 给 audio_ref
//    槽声明的 inputKey 不同，如 dreamina 是 mm_audios，见④步内的说明）。
//
// 目录夹具用 Seedance 2.0 的档案复现音频槽的跨槽约束。请求字段仍从实际选择的档案读取。
//
// 用法：node tests/ux/audio-reference-connect.walk.mjs
import { launchNomiApp } from './_launchApp.mjs'
import { expect, clickOrFail, DEFAULT_TIMEOUT_MS, screenshotSettled } from './_assert.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { require as tsxRequire } from 'tsx/cjs/api'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { newProjectEntry, switchWorkspace } from './_shell.mjs'
import { bringButtonIntoReach } from './_generateReach.mjs'
import { closeModeMenu, modeCell, modeName, openModeMenu, pickMode } from './_modeMenu.mjs'
import { uiText } from './full-walk/invariants.mjs'

const shotsDir = makeTempDir('nomi-audio-reference-evidence-')
process.env.EVIDENCE_DIR = shotsDir
const locale = 'zh-CN'
const { buildWorld } = tsxRequire('../world/index.ts', import.meta.url)
const { SEEDANCE_2_MODEL_SEED, SEEDANCE_2_IMAGE_TO_VIDEO_MAPPING, SEEDANCE_2_TEXT_TO_VIDEO_MAPPING } =
  tsxRequire('../../electron/catalog/kieSeedance.ts', import.meta.url)
const modelLabel = 'Seedance Reference Fixture'
const vendor = 'reference-fixture'
const world = buildWorld({
  projects: [],
  catalog: {
    vendors: [{ key: vendor, name: 'Local Fixture', enabled: true, authType: 'none', providerKind: 'openai-compatible', baseUrlHint: 'http://127.0.0.1:1' }],
    models: [{
      ...SEEDANCE_2_MODEL_SEED, vendorKey: vendor, labelZh: modelLabel, enabled: true, meta: { archetypeId: 'seedance-2' },
    }],
    mappings: [SEEDANCE_2_IMAGE_TO_VIDEO_MAPPING, SEEDANCE_2_TEXT_TO_VIDEO_MAPPING].map((mapping) => ({
      ...mapping, id: `${vendor}-${mapping.taskKind}`, vendorKey: vendor, modelKey: SEEDANCE_2_MODEL_SEED.modelKey, enabled: true,
    })),
  },
})

const { app, win: library } = await launchNomiApp({
  name: 'audio-reference-connect',
  world,
  initialLocalStorage: {
    __nomiE2E: '1',
    'nomi:locale:v1': locale,
    'nomi-color-scheme': 'dark',
    'nomi:splash:v1': 'seen',
    'nomi:journey-tour:v1': 'seen',
    'nomi:canvas-gesture-hint:v1': 'seen',
  },
})
let win
let failed = null
try {
  await clickOrFail(newProjectEntry(library), '新建空白项目', { noWaitAfter: true })
  const projectWindow = () => app.windows().find((page) => /[?&]projectId=/.test(page.url()))
  await expect.poll(() => Boolean(projectWindow())).toBe(true)
  win = projectWindow()
  await switchWorkspace(win, 'generation')
  await win.waitForFunction(() => Boolean(window.__nomiCanvasStore), undefined, { timeout: DEFAULT_TIMEOUT_MS })
  const snap = async (name) => { await screenshotSettled(win, { path: path.join(shotsDir, `${name}.png`) }) }

  const projectId = (/[?&]projectId=([^&#]+)/.exec(win.url()))[1]
  const projects = await win.evaluate(() => window.nomiDesktop.projects.listAsync())
  const project = projects.find((entry) => entry.id === projectId)
  if (!project?.rootPath || path.relative(world.projectsDir, project.rootPath).startsWith('..')) {
    throw new Error('走查没有找到新建项目的隔离目录')
  }
  const assets = path.join(project.rootPath, 'assets', 'imported')
  fs.mkdirSync(assets, { recursive: true })
  const audioFile = 'real-narration.mp3'
  const imageFile = 'test-upload.png'
  for (const file of [audioFile, imageFile]) {
    fs.copyFileSync(new URL(`./fixtures/${file}`, import.meta.url), path.join(assets, file))
  }
  const audioUrl = `nomi-local://asset/${projectId}/assets/imported/${audioFile}`
  const imageUrl = `nomi-local://asset/${projectId}/assets/imported/${imageFile}`

  // 注入用户现场：一个视频镜头节点 + 一个「声音」节点（用户报的原话就是"声音节点"，不是泛义的
  // 导入音频素材）+ 一张本机图片素材。模型经生成框下拉选择，解析和门岗走真实生产链路。
  const ids = await win.evaluate(({ audioUrl, imageUrl }) => {
    const store = window.__nomiCanvasStore.getState()
    const shot = store.addNode({ kind: 'video', title: '镜头 1', position: { x: 620, y: 260 } })
    const voice = store.addNode({ kind: 'audio', title: '声音 1', position: { x: 160, y: 160 } })
    const voiceResult = { id: `${voice.id}-result`, type: 'audio', url: audioUrl, createdAt: 1 }
    store.updateNode(voice.id, { status: 'success', result: voiceResult, history: [voiceResult] })
    const face = store.addNode({ kind: 'asset', title: '本机图片', position: { x: 160, y: 360 }, meta: { source: 'asset-upload' } })
    const faceResult = { id: `${face.id}-result`, type: 'image', url: imageUrl, createdAt: 1 }
    store.updateNode(face.id, { status: 'success', result: faceResult, history: [faceResult] })
    store.selectNode(shot.id)
    return { shot: shot.id, voice: voice.id, face: face.id }
  }, { audioUrl, imageUrl })

  const composer = win.locator(`[data-node-id="${ids.shot}"] .generation-canvas-v2-node__composer`)
  const model = composer.getByRole('button', { name: uiText(locale, 'generationCommon.parameters.model'), exact: true })
  await expect(model).toBeVisible()
  await bringButtonIntoReach(win, model, '选择声明音频伴随约束的夹具模型')
  await model.click()
  const standardModel = win.locator('[data-nomi-select-option-label]', { hasText: new RegExp(`^${modelLabel}$`) })
  await win.locator('[data-nomi-select-dropdown]:visible').getByRole('option').filter({ has: standardModel }).click()
  await expect(model).toContainText(modelLabel)
  await expect(modeCell(composer, locale)).toBeVisible()
  const assertReferenceMode = async () => {
    const rows = await openModeMenu(win, composer, locale)
    expect(rows.filter((row) => row.checked).map((row) => row.name), '视频节点当前方式是全能参考')
      .toEqual([modeName(locale, 'reference')])
    await closeModeMenu(win)
  }
  const generateButton = composer.locator('button[data-bar-segment="generate"]')
  const readSendExplanation = async () => {
    const parent = generateButton.locator('xpath=..')
    if ((await parent.getAttribute('data-send-cost-trigger')) === null) return (await parent.getAttribute('title')) ?? ''
    await generateButton.hover()
    const tooltip = win.locator('[data-send-cost-hover]:visible')
    await expect(tooltip).toBeVisible()
    return tooltip.innerText()
  }

  // ① 零参考时，参考发送在方式菜单就被拦住。已填的提示词可以按当前文生方式发送。
  await composer.locator('[data-node-composer-prompt] [contenteditable="true"]').fill('生成一段有趣的视频')
  const emptyModes = await openModeMenu(win, composer, locale)
  expect(emptyModes.find((row) => row.name === modeName(locale, 'reference'))).toMatchObject({ disabled: true, checked: false })
  expect(emptyModes.filter((row) => row.checked).map((row) => row.name)).toEqual([modeName(locale, 'text')])
  await snap('01-reference-mode-unavailable')
  await closeModeMenu(win)
  await expect(generateButton, '有文字提示词后文生方式可发').toBeEnabled()

  // ② 只连声音节点（画布边）：用户报的第一个 bug——这条连线过去直接被画布拒绝，
  // 修复前这一步就会失败（connectNodes 静默不建边，下面的边计数断言会先红）。
  const readEdgeCount = () => win.evaluate(() => window.__nomiCanvasStore.getState().edges.length)
  const beforeEdgeCount = await readEdgeCount()
  await win.evaluate(({ shot, voice }) => {
    window.__nomiCanvasStore.getState().connectNodes(voice, shot, 'reference')
  }, ids)
  const afterVoiceEdgeCount = await readEdgeCount()
  expect(afterVoiceEdgeCount, `声音节点 → 视频节点的参考边没能建上（before=${beforeEdgeCount} after=${afterVoiceEdgeCount}）——这正是用户报的「声音节点连不了视频节点」`)
    .toBe(beforeEdgeCount + 1)
  await pickMode(win, composer, locale, 'reference')
  await assertReferenceMode()
  await snap('02-voice-connected-still-disabled')

  // 只连音频这一刻，按钮该继续灰着——但灰的原因必须是「音频不能单独用」这个诚实的产品约束，
  // 不是「连不上」。
  await expect(generateButton, '只连音频参考时 ↑ 应仍禁用（音频参考不能单独用，需搭配图/视频）').toBeDisabled({ timeout: DEFAULT_TIMEOUT_MS })
  const voiceOnlyTitle = await readSendExplanation()
  expect(voiceOnlyTitle, `只连音频时 tooltip 应提示"参考音频"需要搭配图/视频，实际：${voiceOnlyTitle}`)
    .toMatch(/参考音频/)
  expect(voiceOnlyTitle, `只连音频时 tooltip 应说"不能单独使用"，实际：${voiceOnlyTitle}`)
    .toMatch(/不能单独使用/)
  await snap('02b-voice-only-explanation')
  await win.mouse.move(0, 0)

  // ③ 再连一张图片参考——这就是用户报的第二种形态「我有固定参考声音怎么办」的组合现场：
  // 音频 + 图片一起送，按钮必须能点。
  await win.evaluate(({ shot, face }) => {
    window.__nomiCanvasStore.getState().connectNodes(face, shot, 'reference')
  }, ids)
  await assertReferenceMode()
  await expect(
    generateButton,
    '音频 + 图片参考都连上后 ↑ 仍被禁用——音频参考没有真正接入判定/发送链路。',
  ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS })
  const pairedTitle = await readSendExplanation()
  expect(pairedTitle, `配上图片参考后 tooltip 不该再提"不能单独使用"，实际：${pairedTitle}`).not.toMatch(/不能单独使用/)
  await snap('03-voice-plus-image-enabled')

  // ④ 干跑请求体（不花钱）：复用生产同一份 resolveGenerationReferences + buildArchetypeInputParams，
  // 证明这段音频的 URL 真的带到了「即将发送」这一步的请求参数里，不是识别对了、真送的时候又在
  // 半路被丢（archetypeMeta.ts 的 B4 修复正是治这一类半途丢参考）。输出键名不 hardcode 成
  // reference_audio_urls——archetype 可以给 audio_ref 槽声明自己的 inputKey（如 dreamina 的
  // mm_audios，见 electron/shared/videoCapabilities/dreaminaSeedance.ts），按 mode.slots 里
  // 那个 audio_ref 槽实际的 inputKey（缺省回落 reference_audio_urls）去参数对象里找。
  const { nodes, edges } = await win.evaluate(() => {
    const state = window.__nomiCanvasStore.getState()
    return { nodes: state.nodes, edges: state.edges }
  })
  const restoreWorld = world.activate()
  try {
    const { resolveGenerationReferences } = tsxRequire('../../src/workbench/generationCanvas/runner/generationReferenceResolver.ts', import.meta.url)
    const { resolveModelArchetype, variantRecordedInMeta } = tsxRequire('../../electron/shared/modelArchetypes/index.ts', import.meta.url)
    const { buildArchetypeInputParams, sendArchetypeMode } = tsxRequire('../../src/workbench/generationCanvas/nodes/controls/archetypeMeta.ts', import.meta.url)
    const node = nodes.find((candidate) => candidate.id === ids.shot)
    const references = resolveGenerationReferences(node, { nodes, edges })
    const meta = node.meta || {}
    const archetype = resolveModelArchetype({ modelKey: meta.modelKey, modelAlias: meta.modelAlias, vendorKey: meta.modelVendor || meta.vendor, meta }, { variant: variantRecordedInMeta(meta, meta.modelKey) })
    expect(archetype?.id, '干跑时解析不出 archetype——点「全能参考」时选的模型没能落进 node.meta').toBeTruthy()
    const mode = sendArchetypeMode(archetype, node, references)
    const params = buildArchetypeInputParams(meta, mode, references)
    const audioSlot = mode.slots.find((slot) => slot.kind === 'audio_ref')
    const audioParamKey = audioSlot?.inputKey || 'reference_audio_urls'
    expect(references.referenceAudios, '判定/显示侧的 referenceAudios 里没有这段声音节点的 URL').toContain(audioUrl)
    expect(params[audioParamKey], `请求参数 ${audioParamKey} 应包含音频 URL，实际参数（archetype=${archetype.id} mode=${mode.id}）：${JSON.stringify(params)}`)
      .toContain(audioUrl)
    console.log(`✅ 声音节点可连视频节点参考边、跨槽依赖提示正确、请求体${audioParamKey}字段带音频 URL（archetype=${archetype.id}）；截图：${shotsDir}`)
  } finally {
    restoreWorld()
  }
} catch (error) {
  failed = error
  if (win) await win.screenshot({ path: path.join(shotsDir, 'FAIL.png') }).catch(() => {})
} finally {
  await app.close().catch(() => {})
}
if (failed) { console.error(`❌ ${failed.stack || failed}`); process.exit(1) }
