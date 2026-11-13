// composer-b3-reference.paid.mjs（真付费，协调跑）与它的零花费演练 composer-b3-reference-paid.rehearsal.walk.mjs 共用的
// 同一份步骤本体（照 _agentVideoLandingSteps.mjs 的分法：演练和真跑不抄第二份）。
//
// 要证的（2026-11-12 方式按输入现算，协调定的最小一幕）：**方式按输入现算 → 真上游收下 → 结果落回节点**，三处说的是同一种方式：
//   底栏方式格显示的 = owner（modeForInputs）对这一幕算出的 = 请求体里真用的那一族参考键。
// 场景：被授权的最便宜一档（Seedance 2.0 Fast · 480p · 4 秒 · 无音频，见 _agentVideoPaid.mjs），视频节点上放 1 张图，
//   **不手选方式**（节点上不存 modeId）→ 读底栏方式格 → 读参考行（1 张在用、没有「未用到」）→ 点 ↑ 花一条 → 等成片落回。
// 旧场景（首尾帧 + 3 张「未用到」）在新规则下造不出来（放 5 张时首尾帧收不下全部、菜单里置灰），已换掉；
// 「放超过上限、不会发的图不上传」那一幕和 _referenceLeakWire.mjs 的判据改动留后续（I-mode-bar 报告的后续清单）。
//
// owner 怎么问：走查进程里用 tsx 直接调 electron/shared 的 modeForInputs（和产品同一份源码），输入按产品的折法
//   （参考列表里的每张上传图 = 一件 { slots: EDGE_MODE_SLOTS.reference, asset: 'image' }，src/…/controls/archetypeMeta.ts）。
// 方式格上的名字按方式菜单的归类（modeMenuModel.buildModeMenu → 四类之一，名字按词典键取）。
// 请求体里的「方式」：APIMart 的请求体不带方式 id，只能从参考走哪一族键看出来——模式声明了合并键（首尾帧 → image_with_roles）
//   就走那个键，否则图走 image_urls。所以 1 张图时「图生视频」和「全能参考」在线上长得一样，这条证的是「族」对得上，
//   精确到哪一种由方式格 = owner 那一步证。
// 布场景（addNode 一次）是整条旅程唯一一次写 store，其余对 store 只读；
// _composerReferenceRow.test.mjs 的 E2E 桥白名单零花费盯着这几个文件对 store 的每一处用法。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ffmpeg from '@ffmpeg-installer/ffmpeg'
import { require as tsxRequire } from 'tsx/cjs/api'
import { clickOrFail, expect, expectVisible, proveProbe } from './_assert.mjs'
import { SPEND_DIALOG } from './_paidRun.mjs'
import { VIDEO, cheapVideoNodeProblems, probeLandedMedia } from './_agentVideoPaid.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { bringButtonIntoReach, readButtonReach } from './_generateReach.mjs'
import { MODE_KINDS, modeCell, modeName, readModeCell } from './_modeMenu.mjs'
import { openCanvas, readProject } from './agent-runtime-walk-support.mjs'
import { fileMapper, pageReadComposer, readComposerReferences } from './_composerReferenceRow.mjs'
import { bareUrl, referenceRejection } from './_referenceLeakWire.mjs'

const { getArchetypeById } = tsxRequire('../../electron/shared/modelArchetypes/index.ts', import.meta.url)
const { modeForInputs } = tsxRequire('../../electron/shared/modelArchetypes/modeForInputs.ts', import.meta.url)
const { EDGE_MODE_SLOTS } = tsxRequire('../../electron/shared/canvas/edgeAdmission.ts', import.meta.url)
const { combineChannelForMode } = tsxRequire('../../electron/shared/videoCapabilities/referenceChannels.ts', import.meta.url)
const { buildModeMenu } = tsxRequire('../../src/workbench/generationCanvas/nodes/controls/modeMenuModel.ts', import.meta.url)

export const IMAGE_FILE = 'one.png'
export const APIMART_HOST = 'api.apimart.ai'
const SCENE_FILES = [IMAGE_FILE]
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const ARCHETYPE = 'seedance-2-apimart'
// 被验修复会原样进产物的字面量：modeForInputs 的结局之一（electron/shared/modelArchetypes/modeForInputs.ts，2026-11-12 起才有）。
// 产物里没有它 = 跑在「方式按输入现算」之前的构建上，这条证明的前提不成立，拒跑。_paidRun.test.mjs 的 paidBuildMarkerProblems 零花费盯着。
const BUILD_MARKER = 'inputsNotAccepted'
const NODE_GENERATE = 'button[data-bar-segment="generate"]'
const VIDEO_LANDS_MS = stationTimeout({ turns: 4 })
// 图走哪一族参考键：模式声明了合并键就走它，否则图走 image_urls（APIMart 视频创建接口）。两族都列出来，判「另一族不许出现」。
const IMAGE_KEY_FAMILIES = ['image_urls', 'image_with_roles']
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// 这条样本的付费走查配置，真付费与演练共用。两边都**自己直接**调 openPaidWalk(脚本名, 走查名, COMPOSER_B3_PAID_MODELS, {...COMPOSER_B3_PAID_OPTIONS, ...})：
// _paidRun.test.mjs 的覆盖核对按文件找 openPaidWalk 调用，包一层就看不见了。
// 授权那一档视频；本地参考图要先经应用的托管上传中转交给供应商（放行当前配置的那一个中转源）；记放行请求的请求体；产物里要有现算的标记。
export const COMPOSER_B3_PAID_MODELS = [VIDEO]
export const COMPOSER_B3_PAID_OPTIONS = { hostedUploads: true, recordAllowedBodies: true, buildMarkers: [BUILD_MARKER] }

/**
 * owner 对节点此刻的输入算出的方式，以及它在方式格上该叫什么、请求体该走哪一族键。
 * 节点上存着 modeId（有人手选过）也照产品的规则当偏好传进去——这一幕要求没手选，存着就由花钱前核对点名。
 * @param {Record<string, any> | undefined} meta
 */
export function ownerModeFor(meta) {
  const archetype = getArchetypeById(meta?.archetype?.id ?? '')
  if (!archetype) return { problems: [`节点上的档案 ${meta?.archetype?.id ?? '（没有）'} 找不到`] }
  const urls = Array.isArray(meta?.referenceImageUrls) ? meta.referenceImageUrls.filter(Boolean) : []
  const inputs = urls.map(() => ({ slots: EDGE_MODE_SLOTS.reference, asset: 'image' }))
  const stored = meta?.archetype?.modeId
  const preference = stored ? { modeId: stored, chosenBy: meta?.archetype?.modeChosenBy === 'human' ? 'human' : 'unknown' } : null
  const result = modeForInputs(archetype, inputs, preference)
  const menu = buildModeMenu({ nodeKind: 'video', archetype, visible: archetype.modes.map((mode) => ({ id: mode.id, vendorTerm: mode.vendorTerm })), inputs, resolvedModeId: result.mode.id })
  const row = menu?.rows.find((candidate) => candidate.id === result.mode.id)
  const channel = combineChannelForMode(result.mode)
  return {
    problems: [],
    modeId: result.mode.id,
    status: result.status,
    taken: result.taken,
    inputs: inputs.length,
    kind: row?.kind ?? null,
    vendorTerm: result.mode.vendorTerm,
    imageKey: inputs.length === 0 ? null : channel?.key ?? 'image_urls',
    roles: channel && !channel.flat ? channel.roleSlots.map((slot) => slot.role) : null,
  }
}

/** 方式格上该显示的名字：能归进四类的按词典键取，归不进的按档案原名（modeMenuModel 的同一条规则）。 */
export function expectedModeCell(owner, locale) {
  return MODE_KINDS.includes(owner.kind) ? modeName(locale, owner.kind) : owner.vendorTerm
}

/**
 * 请求体判：图走 owner 那一族键、另一族不出现；图的张数 = owner 收下的张数；合并键带角色时角色按模式声明的顺序。
 * 纯函数，真付费（网络闸账本）和演练（夹具）各自取出请求体与上传过的文件名再交给它。
 * @param {Record<string, any> | null} body
 * @param {{ owner: ReturnType<typeof ownerModeFor>, uploadedFiles: string[], fileOfSent: (url: string) => string | null }} scene
 */
export function judgeModeWire(body, { owner, uploadedFiles, fileOfSent }) {
  const problems = []
  if (!body) return { problems: ['没读到视频创建请求的请求体'], summary: { imageKey: null } }
  const present = IMAGE_KEY_FAMILIES.filter((key) => Object.hasOwn(body, key))
  if (owner.imageKey === null) {
    if (present.length) problems.push(`owner 算的是不带图的方式，请求体却带了 ${present.join('、')}`)
  } else {
    if (!present.includes(owner.imageKey)) problems.push(`请求体里没有 owner 那一族的键 ${owner.imageKey}（方式 ${owner.modeId}）`)
    const strangers = present.filter((key) => key !== owner.imageKey)
    if (strangers.length) problems.push(`请求体里出现了另一族的键 ${strangers.join('、')}（owner 算的是 ${owner.modeId}，走 ${owner.imageKey}）`)
  }
  const items = Array.isArray(body[owner.imageKey]) ? body[owner.imageKey] : []
  const urls = items.map((item) => (typeof item === 'string' ? item : item?.url)).filter((url) => typeof url === 'string')
  if (owner.imageKey !== null && urls.length !== owner.taken) problems.push(`${owner.imageKey} 里有 ${urls.length} 张图，owner 收下的是 ${owner.taken} 张`)
  if (owner.roles) {
    const roles = items.map((item) => item?.role ?? null)
    const wanted = owner.roles.slice(0, roles.length)
    if (roles.join() !== wanted.join()) problems.push(`${owner.imageKey} 的角色是 [${roles.join('、')}]，按模式声明应是 [${wanted.join('、')}]`)
  }
  const sentFiles = urls.map(fileOfSent)
  if (sentFiles.some((file) => file === null)) problems.push(`请求体里有 ${sentFiles.filter((file) => file === null).length} 张图对不回本地文件名（托管上传没记到，或换了别的上传形状）`)
  if (JSON.stringify([...sentFiles].sort()) !== JSON.stringify([...SCENE_FILES].sort())) problems.push(`请求体里的图是 ${sentFiles.map((file) => file ?? '?').join('、') || '（没有）'}，应恰好是 ${SCENE_FILES.join('、')}`)
  const uploaded = [...new Set(uploadedFiles)].sort()
  if (uploaded.join() !== [...SCENE_FILES].sort().join()) problems.push(`上传过的图是 ${uploaded.join('、') || '（没有）'}（应只有 ${SCENE_FILES.join('、')}）`)
  return {
    problems,
    summary: { ownerMode: owner.modeId, imageKey: present.join('+') || null, imageCount: urls.length, sentFiles: sentFiles.map((file) => file ?? '?'), uploadedFiles: uploaded, problems },
  }
}

function parseJsonOrNull(text) {
  if (!text) return null
  try { return JSON.parse(String(text)) } catch { return null }
}

/**
 * 真付费那一侧：从走查网络闸的账本取出发往 APIMart 的视频创建请求与托管上传，交给 judgeModeWire。
 * @param {Array<Record<string, any>>} entries 闸的账本条目（openPaidWalk 的 readAllowedRequests()）
 */
export function judgeLedgerModeWire(entries, { owner, localUrlOf }) {
  const creates = entries.filter((entry) => entry.kind === 'allowed-request' && entry.host === APIMART_HOST && entry.method === 'POST' && /\/videos\/generations$/.test(new URL(entry.url).pathname))
  const body = parseJsonOrNull(creates[0]?.body?.text)
  const uploads = entries.filter((entry) => entry.kind === 'allowed-request' && Array.isArray(entry.body?.form))
    .flatMap((entry) => entry.body.form.filter((part) => part.fileName).map((part) => ({ seq: entry.seq, fileName: String(part.fileName) })))
  const fileByRemote = new Map(SCENE_FILES.map((file) => [bareUrl(localUrlOf(file)), file]))
  for (const upload of uploads) {
    const response = entries.find((entry) => entry.kind === 'allowed-response' && entry.seq === upload.seq)
    const text = String(response?.text ?? '')
    for (const match of text.matchAll(/https?:\/\/[^"\s]+/g)) {
      const canonical = bareUrl(match[0])
      if (canonical) fileByRemote.set(canonical, upload.fileName)
    }
  }
  const verdict = judgeModeWire(body, { owner, uploadedFiles: uploads.map((upload) => upload.fileName), fileOfSent: (url) => fileByRemote.get(bareUrl(url)) ?? null })
  if (creates.length !== 1) verdict.problems.unshift(`发往 ${APIMART_HOST} 的视频创建请求有 ${creates.length} 次（应恰好 1 次）`)
  if (creates[0]?.body?.truncated) verdict.problems.push('创建请求的请求体超过记账上限被截断，图片地址可能没读全')
  return { problems: verdict.problems, summary: { ...verdict.summary, createRequests: creates.length, endpoint: creates[0] ? `${new URL(creates[0].url).host}${new URL(creates[0].url).pathname}` : null, problems: verdict.problems } }
}

/**
 * 整条旅程：布场景（唯一一次写 store）→ 花钱前核对（方式格 = owner、参考行 1 张在用；任一不成立就抛，一分钱不花）→ 点 ↑。
 * probe：走到确认框为止，点「取消」。否则点「生成」→ 等提交 → 等结局（落地或报错）→ 判请求体 → 量成片。
 * @param {{
 *   paid: Awaited<ReturnType<typeof import('./_paidRun.mjs').openPaidWalk>>,
 *   evidence: Record<string, unknown>,
 *   probe?: boolean,
 *   judgeWire?: (scene: { owner: ReturnType<typeof ownerModeFor>, localUrlOf: (file: string) => string }) => { problems: string[], summary: Record<string, unknown> },
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

  // 一张合成图（ffmpeg testsrc，没有任何真实素材），放进项目素材目录。
  const assetDir = path.join(projectRoot, 'assets', 'imported')
  fs.mkdirSync(assetDir, { recursive: true })
  const urlOf = (file) => `nomi-local://asset/${projectId}/assets/imported/${file}`
  execFileSync(ffmpeg.path, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=s=832x480:r=1', '-frames:v', '1', '-y', path.join(assetDir, IMAGE_FILE)], { stdio: 'pipe' })
  const fileOf = fileMapper(SCENE_FILES, urlOf)

  // 视频镜头：被授权的那一档，参考列表 = 1 张图，**不存 modeId**（没人手选方式）。
  // 整条旅程唯一一次写 store：addNode 缺省就把新镜头设为选中（和真人新建镜头之后一样），不再另写一次选中。
  const shotId = await win.evaluate(({ meta }) => window.__nomiCanvasStore.getState().addNode({
    kind: 'video', title: '方式现算核对', prompt: '一只橘猫从书桌上跳下，镜头缓慢跟随，写实', position: { x: 0, y: 0 }, meta,
  }).id, {
    meta: {
      modelKey: VIDEO.modelKey, modelVendor: VIDEO.vendorKey, vendor: VIDEO.vendorKey,
      archetype: { id: ARCHETYPE, variantId: 'fast' },
      duration: 4, resolution: '480p', generate_audio: false,
      referenceImageUrls: SCENE_FILES.map(urlOf),
    },
  })
  const storeNode = () => win.evaluate((id) => window.__nomiCanvasStore.getState().nodes.find((node) => node.id === id) ?? null, shotId)
  const nodeOnDisk = async () => ((await readProject(win, projectId)).payload.generationCanvas.nodes ?? []).find((node) => node.id === shotId)

  const composer = win.locator(`[data-node-id="${shotId}"] .generation-canvas-v2-node__composer`).first()
  await expectVisible(composer, '选中镜头后它的生成框出现', stationTimeout({ operations: 2 }))

  // ── 花钱之前的整套核对：任何一项不成立就停（一分钱没花）──
  //   ① 被授权那一档；② 没手选方式（节点上没存 modeId）；③ owner 对这一幕算出的方式能发、收下了那 1 张；
  //   ④ 底栏方式格显示的 = owner 那种；⑤ 参考行：那 1 张在用，没有「未用到」。
  const shot = await storeNode()
  const owner = ownerModeFor(shot?.meta)
  const problems = [...cheapVideoNodeProblems(shot?.meta), ...owner.problems]
  if (shot?.meta?.archetype?.modeId) problems.push(`节点上存着方式 ${shot.meta.archetype.modeId}（这一幕要求没人手选）`)
  if (owner.status !== 'ok' || owner.taken !== owner.inputs) problems.push(`owner 算出 ${owner.modeId}（${owner.status}），收下 ${owner.taken}/${owner.inputs} 张——这一幕应能把那 1 张全发出去`)
  const shown = await readModeBeforeSpend(win, composer, shotId, { owner, fileOf })
  problems.push(...shown.problems)
  evidence.owner = { modeId: owner.modeId, kind: owner.kind, imageKey: owner.imageKey, taken: owner.taken }
  evidence.composerBeforeSpend = shown.summary
  await walk.snap('mode-cell-matches-owner-before-spend')
  if (problems.length) throw new Error(`花钱前核对没过（一分钱没花）：\n  ${problems.join('\n  ')}`)

  const generateButton = win.locator(`[data-node-id="${shotId}"] ${NODE_GENERATE}`).first()
  walk.report.generateButtonBeforeClick = await bringButtonIntoReach(win, generateButton, '节点底栏的 ↑')
  const clickedAt = Date.now()
  await clickOrFail(generateButton, '节点底栏的 ↑（生成）', { noWaitAfter: true })
  walk.report.generateButtonAfterClick = await readButtonReach(generateButton)
  const dialog = win.locator(SPEND_DIALOG)
  const before = ['scene-armed-before-spend', 'mode-cell-equals-owner-mode', 'composer-shows-one-image-in-use-before-spend']

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

    // 等结局：成片落地，或这次运行停了（error；recoverable = 停在「可找回」，宿主不再自己问）——主进程拒发在这里就点名。
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
      throw new Error(`主进程拒发了这次请求（reference-not-in-use：请求没离开本机）——渲染层发出去的图和界面在用的不一致。${evidence.rejection.where}：${evidence.rejection.excerpt}`)
    }
    if (!landed(done)) {
      await walk.snap('fail-not-landed')
      throw new Error(`成片没落到这个镜头上（最多等 ${Math.round(VIDEO_LANDS_MS / 1000)} 秒）：状态 ${done?.status ?? '（读不到节点）'}，${String(done?.error ?? '').slice(0, 300)}`)
    }

    // 请求体在成片落地之后再核：这时闸的账本一定写全了（10-22 实跑在提交那一刻就核，账本还没写到创建请求，误红）。
    const wire = await settledWire(judgeWire, { owner, localUrlOf: urlOf })
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
    evidence.verified = [...before, 'request-uses-owner-mode-family', 'one-provider-task', 'result-landed-and-probed']
  } catch (error) {
    // 钱可能已经花了：失败也把供应商任务号和请求体摘要留进证据（账本 env-key 路在收尾时会删，必须在这里读）。
    const taskIds = (done?.runs ?? []).map((run) => run?.taskId).filter(Boolean)
    if (!evidence.providerTaskIds?.length && taskIds.length) evidence.providerTaskIds = taskIds
    if (!evidence.request) {
      try { evidence.request = judgeWire({ owner, localUrlOf: urlOf }).summary } catch (readError) { evidence.request = { readError: String(readError?.message ?? readError).slice(0, 300) } }
    }
    throw error
  }
}

/**
 * 花钱前读界面：底栏方式格上的字 = owner 那种的名字；参考行里那 1 张在用、没有「未用到」。
 * 图要加载、行要重排，判不过就再读，到时限交最后一次的判定。
 */
async function readModeBeforeSpend(win, composer, shotId, { owner, fileOf }) {
  const locale = (await modeCell(composer, 'zh').count()) ? 'zh' : 'en'
  const wanted = expectedModeCell(owner, locale)
  const deadline = Date.now() + stationTimeout({ operations: 2 })
  let verdict
  do {
    const cell = await readModeCell(composer, locale)
    const row = readComposerReferences(await win.evaluate(pageReadComposer, shotId))
    const name = (src) => fileOf(src) ?? 'other'
    const inUse = [...row.slots, ...row.arrays].flatMap((entry) => entry.srcs.map(name))
    const unused = row.unused.flatMap((entry) => entry.srcs.map(name))
    const problems = []
    if (cell !== wanted) problems.push(`底栏方式格写「${cell ?? '（没有方式格）'}」，owner 算的是 ${owner.modeId}，应显示「${wanted}」`)
    if (inUse.join() !== SCENE_FILES.join()) problems.push(`参考行在用的是 ${inUse.join('、') || '（没有）'}，应恰好是 ${SCENE_FILES.join('、')}`)
    if (unused.length) problems.push(`参考行里有「未用到」：${unused.join('、')}（1 张图应全发）`)
    verdict = { problems, summary: { locale, modeCell: cell, expected: wanted, inUse, unused, problems } }
    if (!problems.length) return verdict
    await sleep(500)
  } while (Date.now() < deadline)
  return verdict
}

/** 账本里记到创建请求再判（成片已落地，正常一读就有；给闸一点落盘时间）。 */
async function settledWire(judgeWire, scene) {
  const deadline = Date.now() + stationTimeout({ operations: 1 })
  let wire = judgeWire(scene)
  while (!(wire.summary.createRequests >= 1) && Date.now() < deadline) {
    await sleep(1000)
    wire = judgeWire(scene)
  }
  return wire
}
