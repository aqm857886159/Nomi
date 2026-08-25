// R13 走查（2026-08-24 用户反馈，两条一起验）：
//
// ① 「Comfyui 我配置的文生视频工作流，但是提交必须输入图片才能发出」
//    图里根本没有图输入（UI 也不显示参考框），↑ 却非要一张参考才亮 → 用户只能连张图去喂它 →
//    runtime 又以「模型没有『图生视频』通道，参考图发不出去」拒发 → 两头堵死。
//
// ② 「右上角的报错信息，能否增加一个 x 关闭按钮……有时候下面是生了视频的，
//    有这个报错窗口在，就一直看不了原本的视频」
//    失败卡是 absolute inset-0 铺满正文的遮罩，产物就压在它下面。
//
// 验的是**真实链路**（判定 → 按钮 disabled 属性 / 点 × → 产物露出来），不是纯函数（那各有单测）。
// 关键手法沿用 omni-video-reference-gate：**先证明探针有效**——同一屏上放一个「有参考槽却没参考」的
// i2v 节点，它必须是灰的；否则「ComfyUI 节点按钮是活的」可能只是因为我们压根没测到那个按钮。
//
// 用法：node tests/ux/comfy-t2v-gate-and-error-dismiss.walk.mjs
import { launchNomiApp } from './_launchApp.mjs'
import { expect, clickOrFail, DEFAULT_TIMEOUT_MS, screenshotSettled } from './_assert.mjs'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

const repoRoot = process.cwd()
const port = 5297
const baseUrl = `http://127.0.0.1:${port}`
const tempRoot = path.join(repoRoot, '.tmp', 'nomi-comfy-t2v-gate')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/comfy-t2v-gate-and-error-dismiss')
for (const dir of [tempRoot, shotsDir]) {
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
}
const settingsDir = path.join(tempRoot, 'settings')
fs.mkdirSync(settingsDir, { recursive: true })

// 种一台本地 ComfyUI + 一张**纯文生视频**导入图。关键在 meta.parameters 里**一个 image-url 参数都没有**
// ——这正是用户那张图的形状（没有图输入槽），也是导入侧把 taskKind 定成 text_to_video 的原因。
const now = '2026-08-24T00:00:00.000Z'
const COMFY_MODEL_KEY = 'comfy-h3-t2v-001'
fs.writeFileSync(
  path.join(settingsDir, 'model-catalog.json'),
  JSON.stringify({
    version: 5,
    vendors: [{
      key: 'comfyui-local', name: '本地 ComfyUI', enabled: true, authType: 'none', authHeader: null,
      baseUrlHint: 'http://127.0.0.1:8188', createdAt: now, updatedAt: now,
    }],
    models: [{
      modelKey: COMFY_MODEL_KEY, vendorKey: 'comfyui-local', labelZh: 'H3文生视频',
      kind: 'video', enabled: true, createdAt: now, updatedAt: now,
      meta: {
        // 只有数值参数，没有任何 image-url —— 「这张图不吃参考图」的真相源。
        parameters: [
          { key: 'steps', label: '采样步数', type: 'number', default: 20 },
          { key: 'fps', label: '帧率', type: 'number', default: 24 },
        ],
        comfyWorkflowImport: {
          text: '{}',
          binding: { promptNodeId: '6', promptInputKey: 'text', outputKind: 'video', images: [], params: [] },
        },
      },
    }],
    mappings: [{
      vendorKey: 'comfyui-local', taskKind: 'text_to_video', modelKey: COMFY_MODEL_KEY, name: 'H3文生视频',
      create: {
        method: 'POST', path: '/prompt', headers: { 'Content-Type': 'application/json' },
        body: { prompt: {}, client_id: 'nomi' }, response_mapping: { task_id: 'prompt_id' },
        request_transform: 'comfyui-prompt', defaultParams: { steps: 20, fps: 24 },
      },
      query: {
        method: 'GET', path: '/history/{{providerMeta.task_id}}', response_transform: 'comfyui-history',
        response_mapping: { video_url: 'video_url', error_message: 'error' },
      },
    }],
    apiKeysByVendor: {},
  }, null, 2),
)

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
  cwd: repoRoot, env: { ...process.env }, stdio: 'ignore',
})

let app
let failed = null
const launchOpts = {
  userDataDir: path.join(tempRoot, 'user-data'),
  settingsDir,
  projectsDir: path.join(tempRoot, 'projects'),
  env: { NOMI_DESKTOP_DEV: '1', VITE_DEV_SERVER_URL: baseUrl },
}
try {
  await waitForUrl(baseUrl)
  let win
  ;({ app, win } = await launchNomiApp({ name: 'comfy-t2v-gate', ...launchOpts, settleMs: 0 }))
  await win.evaluate(() => {
    localStorage.setItem('__nomiE2E', '1')
    localStorage.setItem('nomi-color-scheme', 'dark')
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(key, 'seen')
  })
  // 冷启动一次（不是 win.reload()：原地刷新后活动项目会话为空，面板会静默空掉）。
  await win.close().catch(() => {})
  await app.close().catch(() => {})
  ;({ app, win } = await launchNomiApp({ name: 'comfy-t2v-gate-2', ...launchOpts, settleMs: 1800 }))
  const snap = async (name) => { await screenshotSettled(win, { path: path.join(shotsDir, `${name}.png`) }) }

  for (let i = 0; i < 4; i += 1) { await win.keyboard.press('Escape').catch(() => {}); await win.waitForTimeout(160) }
  await clickOrFail(win.getByRole('button', { name: /新建空白项目/ }), '新建空白项目', { noWaitAfter: true })
  await win.waitForFunction(() => /projectId=/.test(location.href), undefined, { timeout: DEFAULT_TIMEOUT_MS })
  await clickOrFail(win.locator('[data-mode="generation"]'), '生成 tab')
  await win.waitForTimeout(1200)

  const ids = await win.evaluate(async (modelKey) => {
    const m = await import('/src/workbench/generationCanvas/store/generationCanvasStore.ts')
    const store = m.useGenerationCanvasStore.getState()
    // 探针基线：有参考槽（i2v 首帧）却一张参考都没有 → 这颗 ↑ 必须是灰的。
    const gate = store.addNode({ kind: 'video', title: '探针·图生视频', position: { x: 160, y: 200 } })
    store.updateNode(gate.id, {
      prompt: '一只猫跳下沙发',
      meta: { modelKey: 'bytedance/seedance-2', archetype: { id: 'seedance-2', modeId: 'first' } },
    })
    // 用户现场：ComfyUI 纯文生视频工作流，写了提示词、没有也不可能有参考图。
    const comfy = store.addNode({ kind: 'video', title: '镜头 1', position: { x: 760, y: 200 } })
    store.updateNode(comfy.id, {
      prompt: '日出前，面包师打开木质百叶窗，把热面包放上柜台。镜头缓慢推进。',
      meta: { modelKey, modelVendor: 'comfyui-local', vendor: 'comfyui-local', videoModel: modelKey, videoModelVendor: 'comfyui-local' },
    })
    store.selectNode(gate.id)
    return { gate: gate.id, comfy: comfy.id }
  }, COMFY_MODEL_KEY)
  await win.waitForTimeout(1500)

  const generateButton = () => win.getByRole('button', { name: /生成素材|重新生成/ }).first()

  // ① 探针基线：i2v 零参考 → 灰。证明我们测到的就是那颗会随状态变化的按钮。
  await expect(generateButton(), '探针失效：i2v 零参考时 ↑ 竟然是活的，后面「ComfyUI 可点」就证明不了什么')
    .toBeDisabled({ timeout: DEFAULT_TIMEOUT_MS })
  await snap('01-probe-i2v-no-reference-disabled')

  // ② 用户报的那一刻：ComfyUI 纯文生视频，没有参考图，↑ 必须能点。
  await win.evaluate(async (id) => {
    const m = await import('/src/workbench/generationCanvas/store/generationCanvasStore.ts')
    m.useGenerationCanvasStore.getState().selectNode(id)
  }, ids.comfy)
  await win.waitForTimeout(1200)

  // 先确认模型没被「可用模型」归一换走——换走了就不是用户的现场了（omni 走查栽过这一条）。
  const shownModel = await win.evaluate(async (id) => {
    const m = await import('/src/workbench/generationCanvas/store/generationCanvasStore.ts')
    const node = m.useGenerationCanvasStore.getState().nodes.find((n) => n.id === id)
    return { modelKey: node?.meta?.modelKey, vendor: node?.meta?.modelVendor, archetype: node?.meta?.archetype?.id ?? null }
  }, ids.comfy)
  expect(shownModel.vendor, `节点模型被换成了别家（${JSON.stringify(shownModel)}），验的就不是 ComfyUI 现场了`)
    .toMatch(/^comfyui-local/)
  expect(shownModel.archetype, 'ComfyUI 导入图不该有内置档案——有档案说明解析口径变了，这条走查的前提没了')
    .toBeNull()

  await expect(
    generateButton(),
    'ComfyUI 纯文生视频工作流没有参考图时 ↑ 仍被禁用 —— 就是用户报的「必须输入图片才能发出」。',
  ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS })
  await snap('02-comfy-t2v-no-reference-enabled')

  // ③ 失败卡：节点已经出过一条片子，然后这一次生成失败 —— 用户说的正是这个现场。
  await win.evaluate(async (id) => {
    const m = await import('/src/workbench/generationCanvas/store/generationCanvasStore.ts')
    const store = m.useGenerationCanvasStore.getState()
    // 取 public/ 下的资源：Vite 把 publicDir 原样挂在 /，这条 URL 一定加载得到。
    // 用加载不到的 URL 会冒出「媒体加载失败」占位，那个占位**也带 role="alert"**，
    // 既会把断言引到错的元素上，又会让「收起后产物露出来」这张截图**其实是空的**（两版都栽过）。
    store.addNodeResult(id, {
      id: 'r-kept', type: 'image', url: '/nomi-logo.svg', createdAt: 1,
    })
    store.setNodeStatus(
      id, 'error',
      "Error invoking remote method 'nomi:tasks:run': Error: 模型「H3文生视频」没有「图生视频」通道，参考图发不出去。",
    )
  }, ids.comfy)
  await win.waitForTimeout(900)

  // 精确定位失败卡本身：画布上「媒体加载失败」占位同样是 role="alert"，只用 role 会指到它身上去。
  const errorCard = win.locator('[role="alert"][aria-label^="生成失败"]').first()
  await expect(errorCard, '失败卡没出来——后面的「点 × 收起」就无从验起').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  const dismissButton = win.getByRole('button', { name: '收起这条报错' }).first()
  await expect(dismissButton, '失败卡右上角没有 × 收起钮（用户在截图上把它画在了这个位置）')
    .toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await snap('03-error-card-with-dismiss')

  // ④ 点 × → 遮罩撤掉，下面那条产物露出来；节点回到 success，错误不再挡着。
  await clickOrFail(dismissButton, '失败卡的 × 收起钮')
  await expect(errorCard, '点了 × 失败卡还在——遮罩没撤掉，产物依旧被挡着').toBeHidden({ timeout: DEFAULT_TIMEOUT_MS })
  const after = await win.evaluate(async (id) => {
    const m = await import('/src/workbench/generationCanvas/store/generationCanvasStore.ts')
    const node = m.useGenerationCanvasStore.getState().nodes.find((n) => n.id === id)
    return { status: node?.status, error: node?.error ?? null, resultId: node?.result?.id ?? null }
  }, ids.comfy)
  expect(after.status, '收起后节点状态不对（有产物就该回 success，让那条片子露出来）').toBe('success')
  expect(after.error, '收起后 node.error 没清掉，失败卡随时会再盖回来').toBeNull()
  expect(after.resultId, '收起把产物也弄丢了——它只该撤遮罩，不该删数据').toBe('r-kept')
  await snap('04-dismissed-result-visible')

  console.log('✅ ComfyUI 文生视频可提交 + 失败卡可收起；截图见 tests/ux/shots/comfy-t2v-gate-and-error-dismiss/')
} catch (error) {
  failed = error
} finally {
  await app?.close().catch(() => {})
  vite.kill('SIGTERM')
}
if (failed) { console.error(`❌ ${failed.message}`); process.exit(1) }
