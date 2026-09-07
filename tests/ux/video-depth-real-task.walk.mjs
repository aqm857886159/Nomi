#!/usr/bin/env node
// R13 / R16 走查 —— 「提取深度」的真实用户任务。
//
// 用法: pnpm run build && node tests/ux/video-depth-real-task.walk.mjs
// 产出: tests/ux/shots/video-depth-real-task/*.png
//
// 一句话的任务：
//   用户手上有一段 4 秒的真人动作素材（黄雨衣、举着手电、推门走进来）。他要把它变成一段
//   深度视频，拿去当动作参考喂给一个视频模型——只换人物、保住动作。做完发现连错了，⌘Z 撤销。
//
// 2026-09-07 用户连着拍了两下，动线跟着变了两次：
//   v1：加号 →「更多」→ 新建一个深度节点 → 在它的表单里挑源、填七个参数 → 开始 → 产物落在同一张卡里。
//   v2：选中那段视频 → 浮条「提取深度」→ 小面板只问「输出」→ 开始 → 旁边长出一张连好线的新卡。
//   v3（本版，拍板原话「其实如果这么砍了之后 也没啥设计的 只要保持一致 能挂入参考被模型使用就行」）：
//       选中那段视频 → 浮条「提取深度」→ **直接跑**。没有面板、没有输出三选一、没有「高级」。
//   所以这条走查里**没有一步是在填表**：从点下动作到产物落回画布之间，用户一个决定都不用做。
//   断言的重点也跟着换：动作找不找得到、点完是不是立刻就有一张卡、进度挡不挡画面、
//   产物能不能被下游模型当参考吃下去。
//
// 这条走查**跑的是真东西**，没有一处 mock：
//   · 真的下载 Depth Anything V2 Small 的 fp16 权重（约 50MB，隔离 profile 每次都从零下）；
//   · 真的用 ffmpeg 抽帧、真的在渲染层 WebGPU 上逐帧推理、真的用 ffmpeg 合成 mp4；
//   · 产物真的落成项目资产、真的能被连成参考边。
//   所以它慢（分钟级），也所以它是唯一能证明这条链在打包路径上活着的东西——
//   nomi-local 伺服 wasm 那一段在 dev 里根本复现不出来。
//
// **零额度**：全程不触发任何供应商生成。下游那个视频模型节点只连线、不点生成——
//   §12.8 要看的是「产物能被当参考消费」，不是「模型出片好不好」（那是另一场付费实验）。
//
// 素材是仓库里已有的那段真实镜头（tests/ux/fixtures/real-shot-640x360.mp4），
// 用 ffmpeg 裁到 4 秒放进项目。纯色板证明不了深度模型真的在看一个人。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { launchNomiApp, repoRoot } from './_launchApp.mjs'
import { addCanvasNodeFromRail } from './_canvasRail.mjs'
import { clickOrFail, expect, expectAbsent, expectVisible, proveProbe, screenshotSettled } from './_assert.mjs'

const require = createRequire(import.meta.url)
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path

const shotsDir = path.join(repoRoot, 'tests/ux/shots/video-depth-real-task')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-video-depth-walk-'))
const userDataDir = path.join(tempRoot, 'user-data')
const settingsDir = path.join(tempRoot, 'settings')
const projectsDir = path.join(tempRoot, 'projects')
const capabilityDir = path.join(tempRoot, 'capability')
for (const dir of [userDataDir, settingsDir, projectsDir, capabilityDir]) fs.mkdirSync(dir, { recursive: true })

// ── 素材：把仓库里那段真实镜头裁到 4 秒放进项目 ────────────────────────────────
const SOURCE_FIXTURE = path.join(repoRoot, 'tests/ux/fixtures/real-shot-640x360.mp4')
if (!fs.existsSync(SOURCE_FIXTURE)) throw new Error(`真实素材不在仓库里：${SOURCE_FIXTURE}`)

const projectId = 'video-depth-real-task'
const projectName = '深度参考 · 黄雨衣'
const projectRoot = path.join(projectsDir, projectId)
const importedDir = path.join(projectRoot, 'assets', 'imported')
fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
fs.mkdirSync(importedDir, { recursive: true })

const CLIP_FILE = 'real-shot-4s.mp4'
const CLIP_SECONDS = 4
execFileSync(
  ffmpegPath,
  ['-v', 'error', '-y', '-i', SOURCE_FIXTURE, '-t', String(CLIP_SECONDS), '-c', 'copy', path.join(importedDir, CLIP_FILE)],
  { timeout: 120_000 },
)

const assetUrl = `nomi-local://asset/${encodeURIComponent(projectId)}/assets/imported/${encodeURIComponent(CLIP_FILE)}`
const sourceNode = {
  id: 'source-shot',
  kind: 'video',
  categoryId: 'shots',
  title: '推门走进来',
  prompt: '推门走进来',
  position: { x: 120, y: 140 },
  status: 'success',
  result: { id: 'source-shot-result', type: 'video', url: assetUrl, createdAt: 1, durationSeconds: CLIP_SECONDS },
}
const generationCanvas = { nodes: [sourceNode], edges: [], selectedNodeIds: [], groups: [] }
const workbenchDocument = { version: 1, title: projectName, updatedAt: 1, contentJson: { type: 'doc', content: [] } }
const timeline = {
  version: 1,
  fps: 30,
  scale: 1.5,
  playheadFrame: 0,
  tracks: [
    { id: 'imageTrack', type: 'image', label: '图片轨', clips: [] },
    { id: 'videoTrack', type: 'video', label: '视频轨', clips: [] },
    { id: 'audioTrack', type: 'audio', label: '音频轨', clips: [] },
  ],
  textClips: [],
  transitions: [],
}
const payload = { workbenchDocument, timeline, generationCanvas, storyboardPlan: null, storyboardPlanCommitted: false }
const project = {
  id: projectId,
  name: projectName,
  version: 2,
  createdAt: 1,
  updatedAt: 1,
  savedAt: 1,
  revision: 1,
  lastKnownRootPath: projectRoot,
  workbenchDocument,
  timeline,
  generationCanvas,
  payload,
}
fs.writeFileSync(path.join(projectRoot, 'project.json'), JSON.stringify(project, null, 2))
fs.writeFileSync(path.join(projectRoot, '.nomi', 'project.json'), JSON.stringify(project, null, 2))

// ── 判据与情绪摩擦日志 ────────────────────────────────────────────────────────────
const verdicts = []
const friction = []
/**
 * 参数顺序是 (ok, name)——**判据在前**。写反了不会报错，只会让每一条都恒真：
 * 一句非空的中文断言名当成 ok 永远是真，于是这条走查会全绿地什么都没验。
 * 2026-09-07 第一趟就是这么假绿的，所以这里把顺序写死并在下面逐条对齐。
 */
function check(ok, name, detail = '') {
  verdicts.push([name, ok, detail])
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
}
/** 不是断言，是「这一步舒不舒服」的人话记录，和截图一起交付（docs/lessons/experiential-qa-emotion-log）。 */
function note(step, feeling) {
  friction.push([step, feeling])
  console.log(`  · 「${step}」${feeling}`)
}

let shotIndex = 0
async function snap(win, name) {
  shotIndex += 1
  const file = path.join(shotsDir, `${String(shotIndex).padStart(2, '0')}-${name}.png`)
  await screenshotSettled(win, { path: file })
  console.log(`  · shot ${path.basename(file)}`)
  return file
}
/** 进度这一族**不能等静止**——等到静止这一段就过去了。所以单独截，不走 settle。 */
async function snapLive(win, name) {
  shotIndex += 1
  const file = path.join(shotsDir, `${String(shotIndex).padStart(2, '0')}-${name}.png`)
  await win.screenshot({ path: file })
  console.log(`  · shot ${path.basename(file)} (live)`)
  return file
}

/** 派生节点上的进度遮罩就是现役那一个（GeneratingOverlay），不是深度专用的第二套。 */
const NODE_OVERLAY = '.generation-canvas-v2-node__generating-overlay'

/**
 * 从磁盘读回这个项目的画布。落盘是防抖的，所以调用点一律**轮到为止**。
 *
 * 这里刻意**不用** `waitForFunction` 配 async 判据。实测（playwright 1.60，2026-09-07）：
 * 判据是 async 函数时，它返回的 Promise 被当成 truthy，第一次轮询就"成功"返回，
 * `handle.jsonValue()` 拿到 `null`——一个从不等待的等待。本条走查此前三处都是这么写的，
 * 于是「按下开始 → 画布上多了一张卡」这一步在 60 秒里一次都没等过，直接拿 null 去 `.nodes`。
 * 阳性对照见 docs/lessons/wait-for-function-with-async-predicate-never-waits.md。
 * 正解是 `expect.poll`（它会 await 取样器），和 agent-runtime-production 那条走查同一套。
 */
const readCanvas = () =>
  win.evaluate(async (id) => {
    const value = await window.nomiDesktop.projects.readAsync(id)
    return value?.payload?.generationCanvas ?? null
  }, projectId)

const { app, win } = await launchNomiApp({
  name: 'video-depth-real-task',
  userDataDir,
  settingsDir,
  projectsDir,
  capabilityDir,
  timeout: 300_000,
  settleMs: 1200,
  args: ['--no-proxy-server'],
  env: { NOMI_DISABLE_AUTO_UPDATE: '1' },
})
win.setDefaultTimeout(30_000)
win.on('pageerror', (error) => console.log(`[renderer:pageerror] ${error.message}`))

try {
  const browserWindow = await app.browserWindow(win)
  await browserWindow.evaluate((windowRef) => windowRef.setBounds({ x: 0, y: 0, width: 1680, height: 1020 }))
  await win.evaluate(() => {
    window.localStorage.setItem('__nomiE2E', '1')
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1', 'nomi-onboarding-checklist:v1']) {
      window.localStorage.setItem(key, 'seen')
    }
  })
  await win.reload()
  await win.waitForLoadState('domcontentloaded')

  const projectCard = win.locator('[data-project-card="true"]').filter({ hasText: projectName }).first()
  await expectVisible(projectCard, '项目卡没出现', 60_000)
  await projectCard.hover()
  await clickOrFail(projectCard.getByRole('button', { name: /继续创作/ }).first(), `打开${projectName}`)
  await win.locator('[aria-label="工作区切换"]').first().waitFor({ timeout: 60_000 })
  await win.locator('[aria-label="工作区切换"]').getByText('生成', { exact: true }).click({ timeout: 10_000 })
  await win.locator('.generation-canvas-v2-toolbar').first().waitFor({ timeout: 60_000 })
  await win.waitForTimeout(800)

  // ── ① 动作挂在素材上：选中那段视频，浮条上就有「提取深度」 ──────────────────
  //
  // 2026-09-07 改形态前这里是「去加号菜单的『更多』里找一个深度节点」。用户看完那一版的原话是
  // 「不够简单、丑、不知道怎么用」——根子就在这一步：他手上明明就有那段片子，却要先去别处
  // 新建一个空节点，再回头把片子挑给它。现在动作长在片子上。
  const sourceCard = win.locator('.react-flow__node[data-id="source-shot"]')
  await expectVisible(sourceCard, '源视频节点没出现在画布上', 60_000)
  await sourceCard.click({ position: { x: 40, y: 16 } })
  await win.waitForTimeout(600)
  const depthAction = win.getByRole('button', { name: '提取深度' }).first()
  const depthActionProof = await proveProbe(depthAction, '选中视频 → 浮条上就有「提取深度」')
  // §12.4 那句诚实边界的新家：面板砍了，它搬进这颗按钮的悬停说明——用户在**按下之前**
  // 唯一会读到的一处。它必须还在，且必须说全（不含手指/表情/衣物，也不保证比原片更准）。
  const actionHint = (await depthAction.getAttribute('title')) ?? ''
  check(
    /手指/.test(actionHint) && /不保证/.test(actionHint),
    '① 诚实边界没随面板一起消失，它搬到了按下之前唯一会读的那一处',
    actionHint,
  )
  check(true, '① 动作就地挂在源素材上，不用先去加号菜单里新建一个空节点')
  await snap(win, 'action-on-source')
  note('看到这个动作', '选中片子它就在那儿，和抽首帧/拆解排在一起——不用先猜这功能叫什么、住在哪')

  // ── ② 点下去就跑：这里**没有第二步** ────────────────────────────────────────
  //
  // 这一格断言的是一件「不存在」的事，所以它必须先证明自己测得到东西（expectAbsent 的基线
  // 规矩，见 docs/lessons/expect-absent-passes-too-early）：先证浮条上确实有可点的按钮，
  // 再证点完之后画面上**没有**任何面板/表单浮出来。
  //
  // 为什么值得专门验：上一版就在这里放了个小面板（输出三选一 +「高级」）。用户看完拍板
  // 「也没啥设计的」——那几个旋钮用户没有判断依据去拧，问他等于把我们的功课推给他（D1）。
  // 面板一旦回来，第一个症状就是这条断言变红。
  const beforeClickNodes = ((await readCanvas())?.nodes ?? []).length
  await clickOrFail(depthAction, '提取深度')
  await win.waitForTimeout(1200)
  await expectAbsent(win.locator('[data-video-depth-panel="true"]'), {
    provenBy: depthActionProof,
    message: '② 点下动作**直接开跑**：没有面板、没有输出三选一、没有「高级」',
  })
  check(true, '② 从点下动作到开跑之间，用户一个决定都不用做')
  note('点下去', '没有弹面板问我要什么档——它就开始跑了，旁边直接多出一张卡')

  // ── ③ 旁边立刻长出一张连好线的新卡 ──────────────────────────────────────────
  await expect
    .poll(async () => (await readCanvas())?.nodes.length ?? 0, {
      message: '点下动作后画布上应当立刻多出一张派生卡（落盘防抖，轮到为止）',
      timeout: 60_000,
    })
    .toBeGreaterThan(beforeClickNodes)
  const canvasAfterStart = await readCanvas()
  const derived = canvasAfterStart.nodes.find((node) => node.id !== 'source-shot')
  const derivedNodeId = derived?.id
  check(Boolean(derivedNodeId), '③ 点一下，画布上立刻多了一张卡（占位先到、内容后填）', String(derivedNodeId))
  check(derived?.kind === 'video', '③ 它是一个**普通视频节点**，不是第三种节点类型', String(derived?.kind))
  check(/·\s*深度$/.test(derived?.title ?? ''), '③ 标题里带着出身（源名 · 深度）', String(derived?.title))
  check(
    canvasAfterStart.edges.some((edge) => edge.source === 'source-shot' && edge.target === derivedNodeId),
    '③ 产物与源之间自动连好线，用户不用自己记它是从哪来的',
    JSON.stringify(canvasAfterStart.edges),
  )
  note('刚点完', '一张新卡立刻出现在旁边、线已经连好——不用盯着一个「处理中」的全局提示猜是哪一条在跑')

  const derivedCard = win.locator(`.react-flow__node[data-id="${derivedNodeId}"]`)
  const overlay = derivedCard.locator(NODE_OVERLAY).first()
  await expectVisible(overlay, '派生节点上没有进度遮罩', 60_000)
  // 面板砍掉之后「下载进度去哪了」的答案：它没去别处，就在这张卡顶那一条上，
  // 而且必须说清**要下多少**——「下载模型 47 MB… 38%」比「正在下载模型权重」多的那两个数，
  // 正是用户此刻唯一想知道的。首次运行才有这一段（隔离 profile 每次都从零下）。
  const downloadSeen = await expect(overlay, '卡顶那一条应当报出要下多少 MB、下到哪了')
    .toContainText(/下载模型\s*\d+\s*MB…\s*\d+%/, { timeout: 180_000 })
    .then(() => true)
    .catch(() => false)
  check(downloadSeen, '④ 首次下载权重的进度就在这张卡顶上，带 MB 数，不弹窗', (await overlay.textContent().catch(() => '')) ?? '')
  await snapLive(win, 'downloading')
  note('等下载', '要下多少、下到哪了都写在卡上——不用去别处找它在干嘛，也没有弹窗挡住画布')

  await derivedCard.locator('text=/正在逐帧推理/').first().waitFor({ timeout: 900_000 })
  // 预计剩余要等第一批帧跑完才算得出来（在那之前只有阶段名）。所以这里**不能一次取样**——
  // 2026-09-07 第一趟就是在阶段名刚出现的那一瞬间读的，读到「正在逐帧推理取消」判红，
  // 而两秒后的截图里「· 预计还要 0:01」好端端地在。用官方会重试的断言等它。
  const etaSeen = await expect(overlay, '进度条上应当出现预计剩余时间')
    .toContainText(/预计还要\s*\d+:\d\d/, { timeout: 120_000 })
    .then(() => true)
    .catch(() => false)
  const overlayText = (await overlay.textContent().catch(() => '')) ?? ''
  check(etaSeen, '⑤ 处理中报的是预计剩余时间，不是一个空转圈', overlayText.trim())
  await proveProbe(derivedCard.getByRole('button', { name: /取消/ }).first(), '处理中可取消（就在这一条里）')

  // ── ⑤bis 进度条在**顶上**，画面不被遮挡（2026-09-07 用户看图后拍板的那一下）────────
  //
  // 判据不能只写「进度条在」——它在画面正中央的时候也「在」。这里量三件事：
  //   · 它贴着卡顶（离卡顶不超过 2px，不是浮在中间）；
  //   · 它只占卡高的一小条（画面区剩下的那大半是给深度帧的）；
  //   · **卡正中央那一点点到的不是它**——用 elementFromPoint 判，rect 判不出遮挡。
  // 实时深度帧要等 worker 回传第一批，所以单独轮询，等不到就如实报红（不 fallback）。
  await win
    .waitForFunction(
      (nodeId) => {
        const card = document.querySelector(`.react-flow__node[data-id="${nodeId}"]`)
        return Boolean(card?.querySelector('.generation-canvas-v2-node__generating-overlay img'))
      },
      derivedNodeId,
      { timeout: 300_000 },
    )
    .catch(() => null)
  const bandGeometry = await derivedCard.evaluate((card) => {
    const band = card.querySelector('[data-generating-progress-bar="true"]')
    const frame = card.querySelector('.generation-canvas-v2-node__generating-overlay img')
    if (!band) return null
    const cardRect = card.getBoundingClientRect()
    const bandRect = band.getBoundingClientRect()
    const centerX = cardRect.left + cardRect.width / 2
    const centerY = cardRect.top + cardRect.height / 2
    const atCenter = document.elementFromPoint(centerX, centerY)
    return {
      offsetFromTop: Math.round(bandRect.top - cardRect.top),
      heightRatio: bandRect.height / cardRect.height,
      centerHitsBand: band.contains(atCenter),
      frameVisible: Boolean(frame && frame.getBoundingClientRect().height > 0),
    }
  })
  check(bandGeometry !== null, '⑤ 进度这一条渲染出来了（data-generating-progress-bar）')
  check(
    bandGeometry !== null && bandGeometry.offsetFromTop <= 2,
    '⑤ 它贴在卡片顶部，不是浮在画面中央',
    `离卡顶 ${bandGeometry?.offsetFromTop}px`,
  )
  check(
    bandGeometry !== null && bandGeometry.heightRatio < 0.25,
    '⑤ 它只占卡顶一条（<25% 卡高），画面区留给深度帧',
    `占卡高 ${((bandGeometry?.heightRatio ?? 0) * 100).toFixed(1)}%`,
  )
  check(
    bandGeometry !== null && !bandGeometry.centerHitsBand,
    '⑤ 卡正中央那一点打到的是画面，不是进度层（elementFromPoint 判，rect 判不出遮挡）',
  )
  check(
    bandGeometry !== null && bandGeometry.frameVisible,
    '⑤ 实时深度帧在画布上真的看得见（worker 每批回传的最新一帧）',
  )
  await snapLive(win, 'processing')
  note('推理中', '还剩多久看得见、取消就在同一条上，下面整幅都是刚算出来的那一帧——不用猜它是不是卡死了')

  // ── ⑥ 产物：一个能播、能连、能再加工的普通视频 ──────────────────────────────
  await expect
    .poll(
      async () =>
        (await readCanvas())?.nodes.find((node) => node.id === derivedNodeId)?.result?.url ?? null,
      {
        message: '深度处理跑完后，产物 URL 应当落在这张派生卡上',
        timeout: 900_000,
        intervals: [2_000],
      },
    )
    .not.toBeNull()
  const finished = (await readCanvas()).nodes.find((node) => node.id === derivedNodeId)
  check(finished.result.type === 'video', '⑥ 产物是画布上的普通视频资产', JSON.stringify(finished.result))
  check(
    typeof finished.result.url === 'string' && finished.result.url.startsWith('nomi-local://'),
    '⑥ 产物落进项目素材（本地 URL，不是外链）',
    String(finished.result.url),
  )
  // 产物身上**不该**再挂一份深度参数。配方只有一份、界面上也没有它的位置，
  // 挂着就是「写了没人读」的状态——下一个人会以为界面上某处在显示它（P1）。
  check(
    finished.meta?.videoDepth === undefined,
    '⑥ 产物身上没有留一份没人读的参数 meta（配方只有一份，不写进每张卡）',
    JSON.stringify(finished.meta ?? null),
  )
  await snap(win, 'result-on-canvas')
  note('出片那一刻', '它就在源片旁边播着，标题写着从哪来——不用先去素材库里认哪个是哪个')

  // ── ⑦ 拖进任意视频模型的参考槽（连线，不生成）────────────────────────────────
  //
  // 这是这一整件事的**核心验收**：拍板原话最后半句就是「能挂入参考被模型使用就行」。
  // 判据不是「线画出来了」而是「槽收下了」——手动连线走的是 resolveCanvasReferenceConnection，
  // 它按目标档案的参考槽声明（referenceReachability）判这条边能不能成立，不成立就当场拒收、
  // 一条边都不落盘。所以「盘上有这条边」本身就是「视频参考槽认了这个产物」的证据。
  await addCanvasNodeFromRail(win, 'video')
  await win.waitForTimeout(1200)
  const videoNodeId = await win.evaluate(
    (known) =>
      Array.from(document.querySelectorAll('.react-flow__node[data-id]'))
        .map((node) => node.getAttribute('data-id'))
        .find((id) => id && !known.includes(id)) ?? null,
    ['source-shot', derivedNodeId],
  )
  check(Boolean(videoNodeId), '下游视频模型节点建出来了', String(videoNodeId))

  // 新建那张卡会把视口推走：2026-09-07 实测这一步的固定坐标点击落到了视口外，
  // Playwright 报「<html> intercepts pointer events」——那是「这个点上什么都没有」，
  // 不是「有东西挡住了」。所以先「适应视图」把三张卡都收回可视区，再量坐标。
  const fitView = win.getByLabel('适应视图').first()
  if (await fitView.count()) await fitView.click()
  await win.waitForTimeout(900)
  await derivedCard.click({ position: { x: 36, y: 16 } })
  await win.waitForTimeout(500)
  const handleBox = await derivedCard.locator('.generation-canvas-react-flow__handle[data-side="right"]').last().boundingBox()
  // 落点必须是目标节点的**左输入端**，不是它的正中央：本仓没有覆写 `connectionMode`
  // （React Flow 默认 Strict），松手必须命中一个握把，落在节点身上什么都不会发生。
  // 2026-09-07 实测就是这么静默失败的，而失败的样子（少了这条边）和
  // 「深度产物不能当参考」这个产品结论一模一样——所以这一处取点写错的代价是一个假结论。
  const targetHandleBox = await win
    .locator(`.react-flow__node[data-id="${videoNodeId}"] .generation-canvas-react-flow__handle[data-side="left"]`)
    .last()
    .boundingBox()
  if (!handleBox || !targetHandleBox) throw new Error('连接握把量不到（fail-closed）')
  await win.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
  await win.mouse.down()
  await win.mouse.move(targetHandleBox.x + targetHandleBox.width / 2, targetHandleBox.y + targetHandleBox.height / 2, { steps: 14 })
  await win.waitForTimeout(300)
  await win.mouse.up()

  const connected = await expect
    .poll(
      async () => ((await readCanvas())?.edges ?? []).some((edge) => edge.source === derivedNodeId && edge.target === videoNodeId),
      { message: '连完线后这条参考边应当落盘', timeout: 20_000 },
    )
    .toBe(true)
    .then(() => true)
    .catch(() => false)
  const canvasAfterConnect = await readCanvas()
  const edgesAfterConnect = canvasAfterConnect?.edges ?? []
  const refEdge = edgesAfterConnect.find((edge) => edge.source === derivedNodeId && edge.target === videoNodeId)
  check(
    connected,
    '⑦ 深度产物真的被连成了下游模型的参考（不做任何供应商特供接线）',
    JSON.stringify(edgesAfterConnect),
  )
  check(
    refEdge?.mode === 'reference',
    '⑦ 这条边的语义是「参考」——槽按档案声明收下了它，不是画了根线而已',
    String(refEdge?.mode),
  )
  // 连完线目标会自动切到**真能消费这条参考**的那个模式（autoPromoteTargetModeForEdge）。
  // 没切 = 边落了但模型看不到它，那正是「连上了却没用上」这一族的样子。
  const targetMode = canvasAfterConnect?.nodes.find((node) => node.id === videoNodeId)?.meta?.archetype?.modeId
  check(
    typeof targetMode === 'string' && targetMode.length > 0,
    '⑦ 目标节点自动切到了能吃下这条参考的生成方式',
    String(targetMode),
  )
  await snap(win, 'result-into-reference-slot')
  note('连线那一下', '深度产物和别的视频节点没有任何区别——不用先导出再导入，直接拉一条线')

  // ── ⑧ ⌘Z：连错了，撤销 ──────────────────────────────────────────────────────
  await win.keyboard.press('Meta+z')
  await expect
    .poll(
      async () => ((await readCanvas())?.edges ?? []).some((edge) => edge.source === derivedNodeId && edge.target === videoNodeId),
      { message: '撤销后刚连的那条参考边应当从盘上消失', timeout: 20_000 },
    )
    .toBe(false)
    .catch(() => {})
  const edgesAfterUndo = (await readCanvas())?.edges ?? []
  // 撤销只该撤掉刚连的那一条。**源 → 产物**那条派生边必须还在——它不是用户刚做的动作，
  // 是这次处理的出身记录，被一起撤掉等于把「它从哪来的」也撤没了。
  check(
    !edgesAfterUndo.some((edge) => edge.source === derivedNodeId && edge.target === videoNodeId),
    '⑧ ⌘Z 撤掉了刚连的那条参考边',
    JSON.stringify(edgesAfterUndo),
  )
  check(
    edgesAfterUndo.some((edge) => edge.source === 'source-shot' && edge.target === derivedNodeId),
    '⑧ 派生边没被一起撤掉（它是出身记录，不是刚做的那一步）',
    JSON.stringify(edgesAfterUndo),
  )
  const resultSurvivedUndo = Boolean(
    (await readCanvas())?.nodes.find((node) => node.id === derivedNodeId)?.result?.url,
  )
  check(resultSurvivedUndo, '⑧ 撤销只退回连线那一步，跑了几分钟的产物没被一起撤掉')
  await snap(win, 'after-undo')
  note('撤销', '撤的是刚做错的那一下，不是把整趟处理一起吞掉——这条要是反了会很痛')
} finally {
  console.log('\n── 情绪摩擦日志 ──')
  for (const [step, feeling] of friction) console.log(`  「${step}」${feeling}`)
  console.log('\n── 判据 ──')
  for (const [name, ok, detail] of verdicts) console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  console.log(`\n截图：${shotsDir}`)
  await app.close().catch(() => {})
}

const failed = verdicts.filter(([, ok]) => !ok)
if (failed.length > 0) {
  console.error(`\n${failed.length} 条判据没过`)
  process.exit(1)
}
console.log('\n全部判据通过')
