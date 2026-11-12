// R13 走查（2026-08-20 用户反馈）：全能参考只连了一段**视频**参考时，↑ 生成钮必须是活的。
//
// 用户现场：素材库拖一段本机 mp4 连到镜头节点 → composer 的「多模态参考」把它显示成已填的槽、
// 提示词也写好了，↑ 却灰着点不动，tooltip 还写「需要先添加参考素材」——让人去做一件已经做完的事。
// 根因是判定侧只读 meta 手动上传，看不见画布边来的视频（发送侧和显示侧都看得见）。
//
// 这个走查验的是**判定 → 按钮 disabled 属性**这条真实链路，不是 canRunGenerationNode 的纯函数
// （那有单测）。先在同一个节点上证明「没参考时它确实是灰的」= 探针有效，再连上视频证明它变活——
// 少了前半截，「按钮是活的」可能只是因为我们压根没测到那个按钮。
//
// 用法：node tests/ux/omni-video-reference-gate.walk.mjs
import { launchNomiApp, encryptFixtureKey, currentCatalogVersion } from './_launchApp.mjs'
import { expect, clickOrFail, DEFAULT_TIMEOUT_MS, screenshotSettled } from './_assert.mjs'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { newProjectEntry } from './_shell.mjs'
import { modeName, openModeMenu, closeModeMenu, readModeCell } from './_modeMenu.mjs'

const repoRoot = process.cwd()
const port = 5291
const baseUrl = `http://127.0.0.1:${port}`
const tempRoot = path.join(repoRoot, '.tmp', 'nomi-omni-video-reference-gate')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/omni-video-reference-gate')
for (const dir of [tempRoot, shotsDir]) {
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
}
// 给 apimart 一把合成后端加密的假 key，让 Seedance 2.0 在这台没配供应商的机器上可用（只看判定 → 按钮，不发请求；
// syntheticCredentialStorage 同时打开测试网闸，假 key 出不了本机）。明文 key 只算 needs_resave = 不可用。
// 没有它模型解析不到档案，方式格根本不出现——旧版靠「换成另一个可用档案」，那个兜底早没了。
fs.mkdirSync(path.join(tempRoot, 'settings'), { recursive: true })
const fakeApimartKey = encryptFixtureKey({ rootDir: repoRoot, userDataDir: path.join(tempRoot, 'user-data'), appName: 'nomi', plaintext: 'sk-walkthrough-fake' })
fs.writeFileSync(path.join(tempRoot, 'settings', 'model-catalog.json'), JSON.stringify({
  version: currentCatalogVersion(), vendors: [], models: [], mappings: [],
  apiKeysByVendor: { apimart: { vendorKey: 'apimart', apiKey: fakeApimartKey, enc: 'safeStorage', enabled: true, createdAt: '', updatedAt: '' } },
}, null, 2))

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
let win
let failed = null
try {
  await waitForUrl(baseUrl)
  ;({ app, win } = await launchNomiApp({
    name: 'omni-video-reference-gate',
    userDataDir: path.join(tempRoot, 'user-data'),
    settingsDir: path.join(tempRoot, 'settings'),
    projectsDir: path.join(tempRoot, 'projects'),
    env: { NOMI_DESKTOP_DEV: '1', VITE_DEV_SERVER_URL: baseUrl },
    syntheticCredentialStorage: true,
    settleMs: 0,
  }))
  await win.evaluate(() => {
    localStorage.setItem('__nomiE2E', '1')
    localStorage.setItem('nomi-color-scheme', 'dark')
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(key, 'seen')
  })
  // 冷启动一次（不是 win.reload()：原地刷新后活动项目会话为空，面板会静默空掉）。
  await win.close().catch(() => {})
  await app.close().catch(() => {})
  ;({ app, win } = await launchNomiApp({
    name: 'omni-video-reference-gate-2',
    userDataDir: path.join(tempRoot, 'user-data'),
    settingsDir: path.join(tempRoot, 'settings'),
    projectsDir: path.join(tempRoot, 'projects'),
    env: { NOMI_DESKTOP_DEV: '1', VITE_DEV_SERVER_URL: baseUrl },
    syntheticCredentialStorage: true,
    settleMs: 1800,
  }))
  const snap = async (name) => { await screenshotSettled(win, { path: path.join(shotsDir, `${name}.png`) }) }

  for (let i = 0; i < 4; i += 1) { await win.keyboard.press('Escape').catch(() => {}); await win.waitForTimeout(160) }
  await clickOrFail(newProjectEntry(win), '新建空白项目', { noWaitAfter: true })
  await win.waitForFunction(() => /projectId=/.test(location.href), undefined, { timeout: DEFAULT_TIMEOUT_MS })
  await clickOrFail(win.locator('[data-mode="generation"]'), '生成 tab')
  await win.waitForTimeout(1200)

  // 注入用户现场：Seedance 全能参考镜头 + 一段本机 mp4 素材节点（先不连线）。
  // 走 store 而不是走导入 UI：这里要验的是「判定 → 按钮」，不是导入流程（那有各自的走查）。
  const ids = await win.evaluate(async () => {
    const m = await import('/src/workbench/generationCanvas/store/generationCanvasStore.ts')
    const store = m.useGenerationCanvasStore.getState()
    const shot = store.addNode({ kind: 'video', title: '镜头 1', position: { x: 620, y: 200 } })
    store.updateNode(shot.id, {
      prompt: '生成一段有趣的视频',
      meta: { modelKey: 'doubao-seedance-2.0', modelVendor: 'apimart', vendor: 'apimart', archetype: { id: 'seedance-2', modeId: 'omni' } },
    })
    const clip = store.addNode({ kind: 'asset', title: '本机视频', position: { x: 160, y: 240 } })
    store.updateNode(clip.id, { result: { type: 'video', url: 'nomi-local://asset/proj/clip.mp4' } })
    store.selectNode(shot.id)
    return { shot: shot.id, clip: clip.id }
  })
  await win.waitForTimeout(1200)

  // 2026-11-12 起方式按输入现算（底栏方式格显示它）：注入的 modeId 只当偏好，没有输入时就是文生视频。
  // 所以不能信注入值，要读方式格——否则后面那条「按钮变活」验的可能是 i2v 首帧接力，
  // 根本不是用户报的 omni 现场（第一版就是这么假绿的：截图里高亮的是「图生视频」）。
  const composer = win.locator('.generation-canvas-v2-node__composer').first()
  const generateButton = win.getByRole('button', { name: /生成素材|重新生成/ }).first()

  // ① 基线：没有任何参考时方式格是文生视频、全能参考在菜单里置灰 —— 证明方式格这根探针是活的。
  await expect.poll(() => readModeCell(composer, 'zh'), { message: '没连参考时方式格应是文生视频', timeout: DEFAULT_TIMEOUT_MS }).toBe(modeName('zh', 'text'))
  const emptyRows = await openModeMenu(win, composer, 'zh')
  await closeModeMenu(win)
  expect(emptyRows.find((row) => row.name === modeName('zh', 'reference'))?.disabled, `没连参考时「全能参考」应置灰：${JSON.stringify(emptyRows)}`).toBe(true)
  await snap('01-no-reference-text-mode')

  // ② 连上那段视频（画布边，等同用户从素材库拖过来连线）。
  await win.evaluate(async ({ shot, clip }) => {
    const m = await import('/src/workbench/generationCanvas/store/generationCanvasStore.ts')
    m.useGenerationCanvasStore.getState().connectNodes(clip, shot, 'reference')
  }, ids)
  await win.waitForTimeout(1200)

  // ③ 这就是用户报的那一刻：参考在画布上连着、缩略图也显示着，按钮必须能点。
  await expect.poll(() => readModeCell(composer, 'zh'), { message: '连上一段参考视频后方式格应自己换成全能参考（只有它收视频）', timeout: DEFAULT_TIMEOUT_MS }).toBe(modeName('zh', 'reference'))
  await expect(
    generateButton,
    '只连了一段参考视频时 ↑ 仍被禁用 —— 就是用户报的「点不了」：判定看不见画布边来的视频参考。',
  ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS })
  await snap('02-video-reference-enabled')

  // ④ tooltip 也不该再让用户去做已经做完的事。
  const title = await generateButton.locator('xpath=..').getAttribute('title')
  expect(title, `↑ 的 tooltip 仍写着「需要先添加参考素材」，可参考已经连上了：${title}`).not.toMatch(/需要先添加参考素材/)

  console.log('✅ 全能参考「只连视频参考」→ ↑ 可点；截图见 tests/ux/shots/omni-video-reference-gate/')
} catch (error) {
  failed = error
  await win?.screenshot({ path: path.join(shotsDir, 'failure.png') }).catch(() => {})
} finally {
  await app?.close().catch(() => {})
  vite.kill('SIGTERM')
}
if (failed) { console.error(`❌ ${failed.message}`); process.exit(1) }
