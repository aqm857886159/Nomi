// composer-b3-reference.paid.mjs（真付费，协调跑）与它的零花费演练 composer-b3-reference-paid.rehearsal.walk.mjs 共用的
// 同一份步骤本体（照 _agentVideoLandingSteps.mjs 的分法：演练和真跑不抄第二份）。
//
// 要证的：B3 生成框上**标为在用**的参考图 = 真发给供应商的参考图。场景与 10-22 热修那一条同档、同图
// （Seedance 2.0 fast · 480p · 4 秒 · 无音频；3 张参考 + 首帧、尾帧），按 B3 的存法布：
//   · 节点上只有一份有序参考列表（meta.referenceImageUrls，见 src/workbench/generationCanvas/nodes/controls/referenceList.ts 文件头）：
//     参考方式（全能参考）下依次放首帧图、尾帧图、3 张参考——和真人在参考区先放两张、再放三张写的是同一个键；
//   · 经**参数面板顶部的「生成方式」**切到首尾帧（B3 里真人会点的那个控件，见 switchToFirstLast）；点不到就在点 ↑ 之前
//     停下（一分钱不花），没有改写 store 顶替的退路；
//   · B3 的唯一推导（placeUploadedImages）把列表前两张落进首帧、尾帧两格，后 3 张淡显「未用到」；
//   · 点 ↑ 花一条。渲染层只把在用的两帧组进请求；万一有入口绕过推导、把没在用的图塞进请求，主进程守卫
//     （electron/tasks/referenceResidueGuard.ts）在发出之前**拒发**（机器码 reference-not-in-use，请求没离开本机）——
//     这也判失败并点名：说明渲染层和界面分了家，正是这条要抓的。
// 脚本不自己推导谁在用：花钱前读生产组件渲染出来的参考行（_composerReferenceRow.mjs），花钱后读请求体与节点上的报错
// （_referenceLeakWire.mjs）。
// 布场景（addNode 一次，新镜头随之选中）是整条旅程唯一一次写 store，其余对 store 只读；
// _composerReferenceRow.test.mjs 的 E2E 桥白名单零花费盯着这几个文件对 store 的每一处用法。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ffmpeg from '@ffmpeg-installer/ffmpeg'
import { clickOrFail, expect, expectHidden, expectVisible, proveProbe } from './_assert.mjs'
import { SPEND_DIALOG } from './_paidRun.mjs'
import { VIDEO, cheapVideoNodeProblems, probeLandedMedia } from './_agentVideoPaid.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { bringButtonIntoReach, readButtonReach } from './_generateReach.mjs'
import { openCanvas, readProject } from './agent-runtime-walk-support.mjs'
import { UI_LOCALES, uiText } from './full-walk/invariants.mjs'
import { fileMapper, judgeComposerReferences, pageReadComposer, readComposerReferences } from './_composerReferenceRow.mjs'
import { firstLastSceneProblems, referenceRejection } from './_referenceLeakWire.mjs'

export const REFERENCE_FILES = ['ref-1.png', 'ref-2.png', 'ref-3.png']
export const FIRST_FILE = 'first.png'
export const LAST_FILE = 'last.png'
export const APIMART_HOST = 'api.apimart.ai'
const SCENE_FILES = [FIRST_FILE, LAST_FILE, ...REFERENCE_FILES]
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const ARCHETYPE = 'seedance-2-apimart'
// 被验修复会原样进产物的字面量：B3 主进程守卫拒发时的诊断前缀（electron/tasks/referenceResidueGuard.ts，tsc 之后在
// dist-electron/tasks/referenceResidueGuard.js）。产物里没有它 = 跑在 B3 之前的构建上（那时守卫只剥不拒，这条证明的前提不成立），拒跑。
// 它还在不在产品源码里，_paidRun.test.mjs 的 paidBuildMarkerProblems 零花费盯着（旧脚本的标记就是悄悄消失的）。
const BUILD_MARKER = 'reference residue rejected before send'
const NODE_GENERATE = 'button[data-bar-segment="generate"]'
const VIDEO_LANDS_MS = stationTimeout({ turns: 4 })
// 界面跟系统语言走：按钮名、「未用到」都按词典取中英两种，不手写一份。
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const FIRSTLAST_NAME = new RegExp(`^\\s*(?:${UI_LOCALES.map((locale) => escapeRegExp(uiText(locale, 'generationCommon.modeMenu.name.firstLast'))).join('|')})\\s*$`)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// 这条样本的付费走查配置，真付费与演练共用。两边都**自己直接**调 openPaidWalk(脚本名, 走查名, COMPOSER_B3_PAID_MODELS, {...COMPOSER_B3_PAID_OPTIONS, ...})：
// _paidRun.test.mjs 的覆盖核对按文件找 openPaidWalk 调用，包一层就看不见了。
// 授权那一档视频；本地参考图要先经应用的托管上传中转交给供应商（放行当前配置的那一个中转源）；记放行请求的请求体；产物里要有 B3 守卫的标记。
export const COMPOSER_B3_PAID_MODELS = [VIDEO]
export const COMPOSER_B3_PAID_OPTIONS = { hostedUploads: true, recordAllowedBodies: true, buildMarkers: [BUILD_MARKER] }

/**
 * 整条旅程：布场景（唯一一次写 store）→ 经参数面板切首尾帧（点不到就抛，一分钱不花）→ 花钱前核对 ①–④（任一不成立就抛，一分钱不花）→ 点 ↑。
 * probe：走到确认框为止，点「取消」。否则点「生成」→ 等提交 → 等结局（落地或报错）→ 判请求体 → 量成片。
 * @param {{
 *   paid: Awaited<ReturnType<typeof import('./_paidRun.mjs').openPaidWalk>>,
 *   evidence: Record<string, unknown>,
 *   probe?: boolean,
 *   judgeWire?: (scene: { localUrlOf: (file: string) => string }) => { problems: string[], summary: Record<string, unknown> },
 *   onSubmitted?: () => unknown,
 * }} options
 */
export async function runComposerB3ReferenceJourney({ paid, evidence, probe = false, judgeWire, onSubmitted = () => {} }) {
  if (!probe && typeof judgeWire !== 'function') throw new Error('花钱的那一档必须给 judgeWire（花钱后核请求体）')
  const { walk } = paid
  const { win } = await walk.start({ first: true })
  await win.evaluate(() => window.localStorage.setItem('__nomiE2E', '1'))
  await win.reload({ waitUntil: 'domcontentloaded' })
  await paid.lockToAuthorizedModels(win)
  const { projectId, projectRoot } = await walk.newProject()
  await openCanvas(win)
  await win.waitForFunction(() => Boolean(window.__nomiCanvasStore), null, { timeout: stationTimeout({ operations: 2 }) })

  // 五张互不相同的合成图（ffmpeg testsrc + 不同色相，没有任何真实素材），放进项目素材目录。
  const assetDir = path.join(projectRoot, 'assets', 'imported')
  fs.mkdirSync(assetDir, { recursive: true })
  const urlOf = (file) => `nomi-local://asset/${projectId}/assets/imported/${file}`
  ;[...REFERENCE_FILES, FIRST_FILE, LAST_FILE].forEach((file, index) => {
    execFileSync(ffmpeg.path, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc=s=832x480:r=1,hue=h=${index * 72}`, '-frames:v', '1', '-y', path.join(assetDir, file)], { stdio: 'pipe' })
  })
  const fileOf = fileMapper(SCENE_FILES, urlOf)
  const scene = { firstFile: FIRST_FILE, lastFile: LAST_FILE, referenceFiles: REFERENCE_FILES, localUrlOf: urlOf }

  // 视频镜头：被授权的那一档，参考方式（全能参考），参考列表 = 首帧图、尾帧图、3 张参考。
  // 整条旅程唯一一次写 store：addNode 缺省就把新镜头设为选中（和真人新建镜头之后一样），不再另写一次选中。
  const shotId = await win.evaluate(({ meta }) => window.__nomiCanvasStore.getState().addNode({
    kind: 'video', title: '参考在用核对', prompt: '一只橘猫从书桌上跳下，镜头缓慢跟随，写实', position: { x: 0, y: 0 }, meta,
  }).id, {
    meta: {
      modelKey: VIDEO.modelKey, modelVendor: VIDEO.vendorKey, vendor: VIDEO.vendorKey,
      archetype: { id: ARCHETYPE, modeId: 'omni', variantId: 'fast' },
      duration: 4, resolution: '480p', generate_audio: false,
      referenceImageUrls: SCENE_FILES.map(urlOf),
    },
  })
  const storeNode = () => win.evaluate((id) => window.__nomiCanvasStore.getState().nodes.find((node) => node.id === id) ?? null, shotId)
  const nodeOnDisk = async () => ((await readProject(win, projectId)).payload.generationCanvas.nodes ?? []).find((node) => node.id === shotId)

  const composer = win.locator(`[data-node-id="${shotId}"] .generation-canvas-v2-node__composer`).first()
  await expectVisible(composer, '选中镜头后它的生成框出现', stationTimeout({ operations: 2 }))
  await switchToFirstLast(win, walk, composer, shotId)

  // ── 花钱之前的整套核对：任何一项不成立就停（一分钱没花）──
  //   ① 被授权那一档；② 方式是首尾帧、首帧图 / 尾帧图排在列表最前；③ 那 3 张参考还在节点的列表里（场景真的布好了）；
  //   ④ 界面：生成框参考行里首帧、尾帧两格各是那张图（在用），那 3 张淡显「未用到」（清单 ComposerB3 板的 ref.slot.unused）。
  const shot = await storeNode()
  const problems = [...cheapVideoNodeProblems(shot?.meta), ...firstLastSceneProblems(shot?.meta, scene)]
  const shown = await readComposerUntilSettled(win, shotId, {
    frames: [{ slot: 'firstFrameUrl', file: FIRST_FILE }, { slot: 'lastFrameUrl', file: LAST_FILE }],
    unused: REFERENCE_FILES, fileOf,
  })
  problems.push(...shown.problems)
  evidence.sceneBeforeSpend = { modeId: shot?.meta?.archetype?.modeId ?? null, referenceList: (shot?.meta?.referenceImageUrls ?? []).map((url) => fileOf(url) ?? 'other') }
  evidence.composerBeforeSpend = shown.summary
  await walk.snap('composer-firstlast-3-unused-before-spend')
  if (problems.length) throw new Error(`花钱前核对没过（一分钱没花）：\n  ${problems.join('\n  ')}`)

  const generateButton = win.locator(`[data-node-id="${shotId}"] ${NODE_GENERATE}`).first()
  walk.report.generateButtonBeforeClick = await bringButtonIntoReach(win, generateButton, '节点底栏的 ↑')
  const clickedAt = Date.now()
  await clickOrFail(generateButton, '节点底栏的 ↑（生成）', { noWaitAfter: true })
  walk.report.generateButtonAfterClick = await readButtonReach(generateButton)
  const dialog = win.locator(SPEND_DIALOG)
  const before = ['scene-armed-before-spend', 'mode-switched-through-parameter-panel', 'composer-shows-frames-in-use-and-3-unused-before-spend']

  if (probe) {
    // 探测（照 director-reference-attach.paid.mjs）：供应商的源不进放行名单，就算点 ↑ 直接提交，网络闸也当场挡下。
    const PROBE_MS = 180_000
    let dialogMs = null
    while (Date.now() - clickedAt < PROBE_MS) {
      if (await dialog.first().isVisible().catch(() => false)) { dialogMs = Date.now() - clickedAt; break }
      await sleep(500)
    }
    evidence.probe = { dialogMs, note: dialogMs === null ? '3 分钟内确认框没出现' : '确认框出现；已点取消，没点生成' }
    if (dialogMs === null) throw new Error(`探测：点 ↑ 之后 ${PROBE_MS / 1000} 秒内确认框一直没出现`)
    await walk.snap('probe-dialog-visible')
    await clickOrFail(dialog.locator('[data-spend-confirm-action="cancel"]'), '确认框「取消」（探测模式绝不点生成）', { noWaitAfter: true })
    await dialog.first().waitFor({ state: 'hidden', timeout: stationTimeout({ operations: 1 }) })
    const runsAfterCancel = (await nodeOnDisk())?.runs?.length ?? 0
    if (runsAfterCancel > 0) throw new Error(`探测模式取消之后镜头上有 ${runsAfterCancel} 条提交记录（不该有）`)
    evidence.verified = [...before, 'generate-click-reaches-confirm-dialog', 'cancel-leaves-no-submission']
    return
  }

  // 真正的等待：isVisible 不等待，框晚几百毫秒出现会被当成「没有框」（协调 10-22 实跑踩到）。托管策略是「允许」时没有框、直接提交。
  if (await dialog.first().waitFor({ state: 'visible', timeout: stationTimeout({ operations: 1 }) }).then(() => true).catch(() => false)) {
    await proveProbe(dialog, '付费 / 托管披露确认框')
    await walk.snap('confirm-dialog')
    await clickOrFail(dialog.locator('[data-spend-confirm-action="confirm"]'), '确认框「生成」', { noWaitAfter: true })
  }
  let done = null
  try {
    let submitted = false
    const submitDeadline = Date.now() + stationTimeout({ operations: 2 })
    while (!submitted && Date.now() < submitDeadline) {
      submitted = ((await nodeOnDisk())?.runs?.length ?? 0) > 0
      if (!submitted) await sleep(1000)
    }
    if (!submitted) {
      await walk.snap('fail-no-submission')
      throw new Error('点了生成但没有提交：30 秒内这个镜头没有出现提交记录（见 fail-no-submission 截图）')
    }
    await onSubmitted()

    // 等结局：成片落地，或这次运行停了（error；recoverable = 停在「可找回」，宿主不再自己问）——主进程拒发
    // （reference-not-in-use）在这里就点名，不干等几分钟的超时。
    const landed = (node) => /^nomi-local:\/\//.test(String(node?.result?.url ?? ''))
    const ended = (node) => landed(node) || node?.status === 'error' || node?.status === 'recoverable' || referenceRejection(node) !== null
    const landDeadline = Date.now() + VIDEO_LANDS_MS
    done = await nodeOnDisk()
    while (!ended(done) && Date.now() < landDeadline) {
      await sleep(2000)
      done = await nodeOnDisk()
    }
    evidence.rejection = referenceRejection(done)
    if (evidence.rejection) {
      await walk.snap('fail-reference-not-in-use')
      throw new Error(`主进程拒发了这次请求（reference-not-in-use：请求没离开本机、服务商没被请求到）——渲染层把界面上没在用的参考图塞进了请求，正是这条要抓的。${evidence.rejection.where}：${evidence.rejection.excerpt}`)
    }
    if (!landed(done)) {
      await walk.snap('fail-not-landed')
      throw new Error(`成片没落到这个镜头上（最多等 ${Math.round(VIDEO_LANDS_MS / 1000)} 秒）：状态 ${done?.status ?? '（读不到节点）'}，${String(done?.error ?? '').slice(0, 300)}`)
    }

    // 请求体在成片落地之后再核：这时闸的账本一定写全了（10-22 实跑在提交那一刻就核，账本还没写到创建请求，误红）。
    const wire = await settledWire(judgeWire, urlOf)
    evidence.request = wire.summary
    evidence.providerTaskIds = [done.result?.taskId].filter(Boolean)
    const media = await probeLandedMedia(projectRoot, projectId, done.result.url)
    const keptAt = path.join(walk.report.outputDir, 'result.mp4')
    fs.copyFileSync(media.filePath, keptAt) // 隔离副本删除前先留下成片
    evidence.landed = { durationSeconds: media.probe.durationSeconds ?? null, videoCodec: media.probe.videoCodec ?? null, width: media.probe.width ?? null, height: media.probe.height ?? null, hasAudio: media.probe.hasAudio, bytes: media.bytes, keptAt: path.relative(REPO_ROOT, keptAt) }
    await walk.snap('result-landed')

    expect(done.runs?.length, '镜头恰好一次提交').toBe(1)
    expect(done.runs[0].status, '那一次提交成功').toBe('success')
    expect(Boolean(done.result?.taskId), '结果带着供应商任务号').toBe(true)
    expect(media.probe.durationSeconds ?? 0, '成片是一段真视频（ffprobe 量出时长）').toBeGreaterThan(1)
    if (wire.problems.length) throw new Error(`请求体核对没过：${wire.problems.join('；')}`)
    evidence.verified = [...before, 'apimart-body-only-first-and-last-frame', 'unused-references-never-uploaded', 'no-reference-not-in-use-rejection', 'one-provider-task', 'result-landed-and-probed']
  } catch (error) {
    // 钱可能已经花了：失败也把供应商任务号和请求体摘要留进证据（账本 env-key 路在收尾时会删，必须在这里读）。
    const taskIds = (done?.runs ?? []).map((run) => run?.taskId).filter(Boolean)
    if (!evidence.providerTaskIds?.length && taskIds.length) evidence.providerTaskIds = taskIds
    if (!evidence.request) {
      try { evidence.request = judgeWire({ localUrlOf: urlOf }).summary } catch (readError) { evidence.request = { readError: String(readError?.message ?? readError).slice(0, 300) } }
    }
    throw error
  }
}

/**
 * 切到「首尾帧」走 B3 里真人会点的控件：B3 把「生成方式」从生成框里的分段条挪进了参数面板顶部
 * （src/workbench/generationCanvas/nodes/InlineParameterBar.tsx 的 [data-agent-generation-mode]，选项是 NomiSegmented 的 role="radio"）。
 * 真人的路：点生成框底栏的参数摘要（[data-parameter-summary]）→ 面板（[data-agent-parameter-panel]，浮层挂在 body 上）→
 * 点「首尾帧」→ Esc 收起（面板盖在生成框上）。点到与否只认节点真的换了方式。
 * 点不到就截图 fail-mode-switch、在点 ↑ 之前停下（一分钱不花）。没有改写 store 顶替的退路：那样花的钱证明不了真人那条路
 * （第 1 轮留过「点不到就写 store 照花钱」，协调退回）。
 */
async function switchToFirstLast(win, walk, composer, shotId) {
  const modeId = () => win.evaluate((id) => window.__nomiCanvasStore.getState().nodes.find((node) => node.id === id)?.meta?.archetype?.modeId ?? null, shotId)
  const panel = win.locator('[data-agent-parameter-panel]').first()
  try {
    const summary = composer.locator('[data-parameter-summary]').first()
    await bringButtonIntoReach(win, summary, '生成框的参数摘要')
    await clickOrFail(summary, '生成框的参数摘要（打开参数面板）')
    await clickOrFail(panel.locator('[data-agent-generation-mode]').getByRole('radio', { name: FIRSTLAST_NAME }), '参数面板顶部「生成方式」里的首尾帧')
    await expect.poll(modeId, { message: '点了「首尾帧」之后节点换成首尾帧方式', timeout: stationTimeout({ operations: 1 }) }).toBe('firstlast')
  } catch (error) {
    await walk.snap('fail-mode-switch')
    const reason = String(error?.message ?? error).split('\n')[0].slice(0, 300)
    throw new Error(`花钱前核对没过（一分钱没花）：参数面板里的「首尾帧」点不到：${reason}`, { cause: error })
  }
  if (await panel.isVisible().catch(() => false)) await win.keyboard.press('Escape')
  await expectHidden(panel, '参数面板收起（它盖在生成框上，先收起再读参考行、点 ↑）', stationTimeout({ operations: 1 }))
}

/** ④ 读选中镜头那张生成框的参考行并判；图要加载、行要重排，判不过就再读，到时限交最后一次的判定。 */
async function readComposerUntilSettled(win, shotId, scene) {
  const deadline = Date.now() + stationTimeout({ operations: 2 })
  let verdict
  do {
    verdict = judgeComposerReferences(readComposerReferences(await win.evaluate(pageReadComposer, shotId)), scene)
    if (!verdict.problems.length) return verdict
    await sleep(500)
  } while (Date.now() < deadline)
  return verdict
}

/** 账本里记到创建请求再判（成片已落地，正常一读就有；给闸一点落盘时间）。 */
async function settledWire(judgeWire, localUrlOf) {
  const deadline = Date.now() + stationTimeout({ operations: 1 })
  let wire = judgeWire({ localUrlOf })
  while (!(wire.summary.createRequests >= 1) && Date.now() < deadline) {
    await sleep(1000)
    wire = judgeWire({ localUrlOf })
  }
  return wire
}
