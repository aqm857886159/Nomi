// R13 走查（2026-09-11，用户反馈「声音节点连不了视频节点」+「ComfyUI 音频输入用不了」根因修复）。
//
// 用户现场：拖一个「声音」节点想当参考连到 Seedance 全能参考视频节点（模型档案早就声明了
// audio_ref 参考音频槽），画布却直接拒绝这条连线——根因是共享的参考边分类器/门岗
// （src/config/modelArchetypes/anchorPolicy.ts + referenceEdgeCapability.ts）从没认过
// audio 是一种可参考资产类型，不管目标模型声明了什么。
//
// 这个走查验的是**真实画布连线 → composer 判定 → 请求体字段**这条完整链路，不是单测里的纯函数：
// ① 先证明零参考时按钮确实是灰的（探针基线）；
// ② 只连音频参考边 → 仍是灰的，但原因必须是「Seedance 2.0 的音频不能单独用，需要搭配图/视频」
//    （供应商文档明写的跨槽依赖），不能是「根本连不上」——两者体感完全不同，前者是诚实的产品
//    约束，后者是本次修的 bug；
// ③ 再连一段图片参考 → 按钮变活，槽位视觉上确实吃到了这条音频边；
// ④ 干跑（不花钱）构造最终请求参数——复用生产同一份 resolveGenerationReferences +
//    buildArchetypeInputParams，断言音频参考槽对应的请求字段真的带着这段音频的 URL，
//    不是识别对了、真发的时候又在半路被丢（字段名不 hardcode——不同 archetype 给 audio_ref
//    槽声明的 inputKey 不同，如 dreamina 是 mm_audios，见④步内的说明）。
//
// 走查不挑死具体是哪个供应商/模型：新建视频节点后端目录给的默认模型是什么就用什么，只要它像
// 用户报的现场一样声明了「全能参考」模式 + audio_ref 槽——验的是共享门岗，不是某个特定供应商。
//
// 用法：node tests/ux/audio-reference-connect.walk.mjs
import { launchNomiApp } from './_launchApp.mjs'
import { expect, clickOrFail, DEFAULT_TIMEOUT_MS, screenshotSettled } from './_assert.mjs'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

const repoRoot = process.cwd()
const port = 5292
const baseUrl = `http://127.0.0.1:${port}`
const tempRoot = path.join(repoRoot, '.tmp', 'nomi-audio-reference-connect')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/audio-reference-connect')
for (const dir of [tempRoot, shotsDir]) {
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
}

const waitForUrl = (url, timeoutMs = 60_000) => new Promise((resolve, reject) => {
  const deadline = Date.now() + timeoutMs
  const poll = () => {
    const request = http.get(url, (response) => { response.destroy(); resolve(true) })
    request.on('error', () => (Date.now() > deadline ? reject(new Error('Vite 未就绪')) : setTimeout(poll, 300)))
    request.setTimeout(1200, () => request.destroy())
  }
  poll()
})

const vite = spawn('node', ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port)], {
  cwd: repoRoot,
  env: { ...process.env },
  stdio: 'ignore',
})

let app
let failed = null
try {
  await waitForUrl(baseUrl)
  let win
  // 单次冷启动：onboarding/splash/tour 三个 localStorage 开关用 initialLocalStorage 在**首次
  // 文档创建前**注入（tests/ux/_launchApp.mjs 的 preload script 机制），不需要「起一次→手写
  // localStorage→关掉→再起一次」的旧写法（那条路径在本机重负载下会撞见 Electron 关闭
  // 未完全释放时二次起进程的已知不稳定，见 2026-09-11 环境记录）。语义等价：跳过的是同样三个
  // 开关，只是注入时机从「运行时写入」提前到「预加载脚本」，结果一致、少一次进程生灭。
  ;({ app, win } = await launchNomiApp({
    name: 'audio-reference-connect',
    userDataDir: path.join(tempRoot, 'user-data'),
    settingsDir: path.join(tempRoot, 'settings'),
    projectsDir: path.join(tempRoot, 'projects'),
    env: { NOMI_DESKTOP_DEV: '1', VITE_DEV_SERVER_URL: baseUrl },
    initialLocalStorage: {
      __nomiE2E: '1',
      'nomi-color-scheme': 'dark',
      'nomi:splash:v1': 'seen',
      'nomi:journey-tour:v1': 'seen',
      'nomi:canvas-gesture-hint:v1': 'seen',
    },
    settleMs: 1800,
  }))
  const snap = async (name) => { await screenshotSettled(win, { path: path.join(shotsDir, `${name}.png`) }) }

  for (let i = 0; i < 4; i += 1) { await win.keyboard.press('Escape').catch(() => {}); await win.waitForTimeout(160) }
  await clickOrFail(win.getByRole('button', { name: /新建空白项目/ }), '新建空白项目', { noWaitAfter: true })
  await win.waitForFunction(() => /projectId=/.test(location.href), undefined, { timeout: DEFAULT_TIMEOUT_MS })
  await clickOrFail(win.locator('[data-mode="generation"]'), '生成 tab')
  await win.waitForTimeout(1200)

  // 注入用户现场：一个视频镜头节点 + 一个「声音」节点（用户报的原话就是"声音节点"，不是泛义的
  // 导入音频素材）+ 一张本机图片素材。不挑具体模型/vendor——新建的视频节点会拿到目录里某个默认
  // 模型（隔离测试 profile 下实测是即梦 Seedance，但这条走查不依赖具体是哪一个：只要它和用户报的
  // bug 现场一样声明了「全能参考」模式 + audio_ref 槽即可，验的是共享门岗（anchorPolicy.ts +
  // referenceEdgeCapability.ts），不是某个特定供应商——挑死一个 vendor 反而是特例化断言（P4）。
  // 不直接往 meta 塞 archetype：那个字段这条渲染链路根本不读（真相源是
  // resolveArchetypeForOption(selectedModelOption)，只认「模型下拉真选中的那个 ModelOption」）。
  const ids = await win.evaluate(async () => {
    const m = await import('/src/workbench/generationCanvas/store/generationCanvasStore.ts')
    const store = m.useGenerationCanvasStore.getState()
    const shot = store.addNode({ kind: 'video', title: '镜头 1', position: { x: 620, y: 260 } })
    store.updateNode(shot.id, { prompt: '生成一段有趣的视频' })
    const voice = store.addNode({ kind: 'audio', title: '声音 1', position: { x: 160, y: 160 } })
    store.updateNode(voice.id, { result: { type: 'audio', url: 'nomi-local://asset/proj/voice.mp3' } })
    const face = store.addNode({ kind: 'asset', title: '本机图片', position: { x: 160, y: 360 } })
    store.updateNode(face.id, { result: { type: 'image', url: 'nomi-local://asset/proj/face.png' } })
    store.selectNode(shot.id)
    return { shot: shot.id, voice: voice.id, face: face.id }
  })
  await win.waitForTimeout(1200)

  // 真进「全能参考」模式（同 omni-video-reference-gate.walk.mjs 的教训：注入的 modeId 会被档案
  // 解析归一，必须点真实 tab 再断言选中，不能信注入值）。「全能参考」是 vendorTerm，多个视频档案
  // （seedance-2 / dreamina-seedance-2 / seedance-2-apimart…）各自独立声明这同一个人话标签，
  // 不是同一个 archetype id——tab 按文字找，不 hardcode 具体是哪个 archetype。
  const omniTab = win.locator('button[aria-pressed]', { hasText: '全能参考' }).first()
  await clickOrFail(omniTab, '全能参考 模式 tab')
  await expect(omniTab, '点了「全能参考」但它没被选中——后面的断言就不是这个模式的现场了')
    .toHaveAttribute('aria-pressed', 'true', { timeout: DEFAULT_TIMEOUT_MS })

  const generateButton = win.getByRole('button', { name: /生成素材|重新生成/ }).first()

  // ① 基线：零参考时确实是灰的。
  await expect(generateButton, '全能参考零参考时，↑ 应当是禁用的（探针基线）').toBeDisabled({ timeout: DEFAULT_TIMEOUT_MS })
  await snap('01-no-reference-disabled')

  // ② 只连声音节点（画布边）：用户报的第一个 bug——这条连线过去直接被画布拒绝，
  // 修复前这一步就会失败（connectNodes 静默不建边，下面的边计数断言会先红）。
  const beforeEdgeCount = await win.evaluate(async () => {
    const m = await import('/src/workbench/generationCanvas/store/generationCanvasStore.ts')
    return m.useGenerationCanvasStore.getState().edges.length
  })
  await win.evaluate(async ({ shot, voice }) => {
    const m = await import('/src/workbench/generationCanvas/store/generationCanvasStore.ts')
    m.useGenerationCanvasStore.getState().connectNodes(voice, shot, 'reference')
  }, ids)
  await win.waitForTimeout(1200)
  const afterVoiceEdgeCount = await win.evaluate(async () => {
    const m = await import('/src/workbench/generationCanvas/store/generationCanvasStore.ts')
    return m.useGenerationCanvasStore.getState().edges.length
  })
  expect(afterVoiceEdgeCount, `声音节点 → 视频节点的参考边没能建上（before=${beforeEdgeCount} after=${afterVoiceEdgeCount}）——这正是用户报的「声音节点连不了视频节点」`)
    .toBe(beforeEdgeCount + 1)
  await snap('02-voice-connected-still-disabled')

  // 只连音频这一刻，按钮该继续灰着——但灰的原因必须是「音频不能单独用」这个诚实的产品约束，
  // 不是「连不上」。tooltip 挂在按钮外层容器上（同 omni-video-reference-gate 的读法）。
  await expect(generateButton, '只连音频参考时 ↑ 应仍禁用（音频参考不能单独用，需搭配图/视频）').toBeDisabled({ timeout: DEFAULT_TIMEOUT_MS })
  const voiceOnlyTitle = await generateButton.locator('xpath=..').getAttribute('title')
  expect(voiceOnlyTitle, `只连音频时 tooltip 应提示"参考音频"需要搭配图/视频，实际：${voiceOnlyTitle}`)
    .toMatch(/参考音频/)
  expect(voiceOnlyTitle, `只连音频时 tooltip 应说"不能单独使用"，实际：${voiceOnlyTitle}`)
    .toMatch(/不能单独使用/)

  // ③ 再连一张图片参考——这就是用户报的第二种形态「我有固定参考声音怎么办」的组合现场：
  // 音频 + 图片一起送，按钮必须能点。
  await win.evaluate(async ({ shot, face }) => {
    const m = await import('/src/workbench/generationCanvas/store/generationCanvasStore.ts')
    m.useGenerationCanvasStore.getState().connectNodes(face, shot, 'reference')
  }, ids)
  await win.waitForTimeout(1200)
  await expect(omniTab, '断言时已经不在「全能参考」了（模式被什么东西改回去了）')
    .toHaveAttribute('aria-pressed', 'true')
  await expect(
    generateButton,
    '音频 + 图片参考都连上后 ↑ 仍被禁用——音频参考没有真正接入判定/发送链路。',
  ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS })
  const pairedTitle = await generateButton.locator('xpath=..').getAttribute('title')
  expect(pairedTitle, `配上图片参考后 tooltip 不该再提"不能单独使用"，实际：${pairedTitle}`).not.toMatch(/不能单独使用/)
  await snap('03-voice-plus-image-enabled')

  // ④ 干跑请求体（不花钱）：复用生产同一份 resolveGenerationReferences + buildArchetypeInputParams，
  // 证明这段音频的 URL 真的带到了「即将发送」这一步的请求参数里，不是识别对了、真送的时候又在
  // 半路被丢（archetypeMeta.ts 的 B4 修复正是治这一类半途丢参考）。输出键名不 hardcode 成
  // reference_audio_urls——archetype 可以给 audio_ref 槽声明自己的 inputKey（如 dreamina 的
  // mm_audios，见 electron/shared/videoCapabilities/dreaminaSeedance.ts），按 mode.slots 里
  // 那个 audio_ref 槽实际的 inputKey（缺省回落 reference_audio_urls）去参数对象里找。
  const dryRunParams = await win.evaluate(async ({ shot }) => {
    const canvasStore = await import('/src/workbench/generationCanvas/store/generationCanvasStore.ts')
    const state = canvasStore.useGenerationCanvasStore.getState()
    const node = state.nodes.find((n) => n.id === shot)
    const { resolveGenerationReferences } = await import('/src/workbench/generationCanvas/runner/generationReferenceResolver.ts')
    const { resolveArchetypeForModel } = await import('/src/config/modelArchetypes/index.ts')
    const { buildArchetypeInputParams, currentArchetypeMode } = await import('/src/workbench/generationCanvas/nodes/controls/archetypeMeta.ts')
    const references = resolveGenerationReferences(node, { nodes: state.nodes, edges: state.edges })
    // 不 hardcode 具体是哪个 archetype——真机上新建视频节点默认拿到哪个模型由目录决定（隔离测试
    // profile 下实测是即梦 Seedance，但这条走查不该跟着某个具体默认值绑死），按节点真实 meta 解析。
    const meta = node.meta || {}
    const archetype = resolveArchetypeForModel({ modelKey: meta.modelKey, modelAlias: meta.modelAlias, vendorKey: meta.modelVendor || meta.vendor, meta })
    const mode = currentArchetypeMode(archetype, meta)
    const params = buildArchetypeInputParams(meta, archetype, references)
    const audioSlot = mode.slots.find((s) => s.kind === 'audio_ref')
    const audioParamKey = audioSlot?.inputKey || 'reference_audio_urls'
    return { archetypeId: archetype?.id, modeId: mode.id, params, audioParamKey, referenceAudios: references.referenceAudios }
  }, ids)
  expect(dryRunParams.archetypeId, '干跑时解析不出 archetype——点「全能参考」时选的模型没能落进 node.meta').toBeTruthy()
  expect(dryRunParams.referenceAudios, '判定/显示侧的 referenceAudios 里没有这段声音节点的 URL').toContain('nomi-local://asset/proj/voice.mp3')
  expect(dryRunParams.params[dryRunParams.audioParamKey], `请求参数 ${dryRunParams.audioParamKey} 应包含音频 URL，实际参数（archetype=${dryRunParams.archetypeId} mode=${dryRunParams.modeId}）：${JSON.stringify(dryRunParams.params)}`)
    .toContain('nomi-local://asset/proj/voice.mp3')

  console.log(`✅ 声音节点可连视频节点参考边、跨槽依赖提示正确、请求体${dryRunParams.audioParamKey}字段带音频 URL（archetype=${dryRunParams.archetypeId}）；截图见 tests/ux/shots/audio-reference-connect/`)
} catch (error) {
  failed = error
} finally {
  await app?.close().catch(() => {})
  vite.kill('SIGTERM')
}
if (failed) { console.error(`❌ ${failed.message}`); process.exit(1) }
