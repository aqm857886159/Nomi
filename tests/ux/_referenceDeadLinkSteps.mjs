// reference-dead-link（参考素材的临时链接失效后改用本机文件）的三条走查共用的**同一份**步骤本体：
//   · reference-dead-link.walk.mjs                      零花费，中英两轨，本机夹具（协调看截图）；
//   · reference-dead-link-real.rehearsal.walk.mjs       真付费脚本的零花费演练（同一份步骤、不出网、不要 key）；
//   · reference-dead-link-real.paid.mjs                 真付费，协调跑一次。
// 设计卡 docs/plan/2026-11-01-reference-link-delivery.md ★9「走查」与「真付费」。演练和真跑不抄第二份（照 _composerB3ReferenceSteps.mjs 的分法）。
//
// 要证的两件事：
//   ① 失效链接直接出结果：参考素材 .meta 里存着的服务商临时链接已经 4xx，发之前的试探判它失效，发出去的是**上传后的新链接**，
//      生成成功，界面上**没有任何新元素**（没有错误卡、没有提示）；供应商恰收一笔创建请求、恰收一次上传。
//   ② 模型拒绝 → 新卡 → 重试（只有夹具能证：真供应商不会按我们的意愿拒绝）：链接活着，所以第一次照发；夹具回
//      「An input media URL could not be fetched (403/404/410).」→ 看到「模型取不到参考图」那张卡，主按钮「重试」→ 点重试 →
//      这条连接已被记下，第二笔创建请求带的是上传后的新链接 → 出结果。两笔创建请求、一次上传；第一次带原链接，第二次不带。
// 参考素材怎么布：像真人一样经节点上的「添加参考」把一张本机图片放进来（产品自己落盘 + 引用），然后只做一件事——改这张图落盘旁边的
// .meta（`originalUrl`），把它写成"服务商的临时链接"。这和 0.24.0 真函数落下的生成图是同一个形状（见 tests/fixtures/old-user-data/assets）。
// 脚本不碰 store、不替产品推导谁发链接谁上传：花钱前读 .meta，花钱后只读夹具 / 网络闸账本里真收到的请求。
import fs from 'node:fs'
import path from 'node:path'
import { canonicalEvidenceUrl } from '../../scripts/walkthrough-url-shape.cjs'
import { clickOrFail, expect, expectAbsent, expectVisible, proveProbe } from './_assert.mjs'
import { canvasFitView, collapseAgentPanel } from './_shell.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { openCanvas, readProject } from './agent-runtime-walk-support.mjs'
import { UI_LOCALES, uiText } from './full-walk/invariants.mjs'

/** 被授权的那一个图片模型（只有它没被 lockToAuthorizedModels 停用）：支持参考图，也是 reference-dead-link 要用的"图生图"模式。价目不进仓库，是否最便宜由协调确认。 */
export const IMAGE = { vendorKey: 'apimart', modelKey: 'gemini-3.1-flash-image-preview' }
/** 被验修复会原样进产物的字面量：主进程试探的日志事件名（electron/assets/providerMediaFetch.ts，tsc 之后在 dist-electron/assets/providerMediaFetch.js）。产物里没有它 = 构建不含这次修复，拒跑。 */
export const DEAD_LINK_BUILD_MARKER = 'reference-link-probe'
/** 夹具回的那句拒绝（用户反馈的原话）。 */
export const REFUSAL_TEXT = 'An input media URL could not be fetched (403/404/410).'
export const REFERENCE_IMAGE = path.resolve('resources/onboarding-demo/shot-5.jpg')

// 这条样本的付费走查配置，真付费与演练共用；两边都**自己直接**调 openPaidWalk（_paidRun.test.mjs 按文件找 openPaidWalk 调用，包一层就看不见了）。
export const REFERENCE_DEAD_LINK_PAID_MODELS = [IMAGE]
// 本地参考图要先经应用的托管上传中转交给供应商（放行当前配置的那一个中转源）；记放行请求的请求体；产物里要有试探的标记。
export const REFERENCE_DEAD_LINK_PAID_OPTIONS = { hostedUploads: true, recordAllowedBodies: true, buildMarkers: [DEAD_LINK_BUILD_MARKER] }

// ── 纯判据（单测钉它：_referenceDeadLinkSteps.test.mjs）──────────────────────────────────────────────
/** 去掉查询串后的地址（网络闸已经把查询串换成 `?<redacted>`）。 */
export function bare(url) {
  try { return canonicalEvidenceUrl(url) } catch { return String(url ?? '').split('?')[0] }
}

function urlsIn(value, out = []) {
  if (typeof value === 'string') { if (/^(https?:|data:|nomi-local:)/i.test(value)) out.push(value) }
  else if (Array.isArray(value)) value.forEach((item) => urlsIn(item, out))
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => urlsIn(item, out))
  return out
}

/** 夹具收到的请求 → 统一的观察：每笔创建请求带了哪些图片地址，上传过几次、各回了什么地址。 */
export function observeFixture(fixture) {
  return {
    creates: fixture.images.map((record) => ({ imageUrls: [...new Set(urlsIn(record.body).map(bare))] })),
    uploads: fixture.uploads.map((record) => ({ fileNames: record.uploadFileNames ?? [], url: bare(record.uploadUrl) })),
  }
}

/** 走查网络闸的账本（`allowed-request` / `allowed-response`，recordAllowedBodies）→ 同样的观察。host = 供应商创建请求的主机；probeUrl = 发之前试探的那条地址（有就数它被 GET 了几次，留作证据）。 */
export function observeLedger(entries, { host, probeUrl = null }) {
  const creates = entries
    .filter((entry) => entry.kind === 'allowed-request' && entry.host === host && entry.method === 'POST' && /\/images\/generations$/.test(new URL(entry.url).pathname))
    .map((entry) => {
      let body = null
      try { body = entry.body?.text ? JSON.parse(String(entry.body.text)) : null } catch { /* 截断或非 JSON：下面按"没读到图片地址"判 */ }
      return { imageUrls: body ? [...new Set(urlsIn(body).map(bare))] : [], truncated: Boolean(entry.body?.truncated) }
    })
  const uploads = entries
    .filter((entry) => entry.kind === 'allowed-request' && Array.isArray(entry.body?.form) && entry.body.form.some((part) => part.fileName))
    .map((entry) => {
      const response = entries.find((candidate) => candidate.kind === 'allowed-response' && candidate.seq === entry.seq)
      let parsed = null
      try { parsed = response?.text ? JSON.parse(String(response.text)) : null } catch { /* 响应不是 JSON */ }
      const url = urlsIn(parsed).find((value) => /^https?:/i.test(value))
      return { fileNames: entry.body.form.filter((part) => part.fileName).map((part) => String(part.fileName)), url: url ? bare(url) : null }
    })
  const probes = probeUrl ? entries.filter((entry) => entry.kind === 'allowed-request' && entry.method === 'GET' && bare(entry.url) === bare(probeUrl)).length : null
  return { creates, uploads, probes }
}

/** 失效链接那一笔：恰一笔创建请求、恰一次上传；请求里的图片是上传换来的新链接，不是那条死链接。 */
export function judgeDeadLinkSend(observed, { deadLink }) {
  const problems = []
  const dead = bare(deadLink)
  if (observed.creates.length !== 1) problems.push(`供应商收到的创建请求有 ${observed.creates.length} 笔（应恰好 1 笔）`)
  if (observed.uploads.length !== 1) problems.push(`上传了 ${observed.uploads.length} 次（失效链接应换成恰好 1 次上传）`)
  const sent = observed.creates[0]?.imageUrls ?? []
  if (observed.creates[0]?.truncated) problems.push('创建请求的请求体超过记账上限被截断，图片地址可能没读全')
  if (sent.length === 0) problems.push('创建请求里读不到任何图片地址')
  if (sent.includes(dead)) problems.push('发出去的还是那条失效的临时链接')
  const uploaded = new Set(observed.uploads.map((upload) => upload.url).filter(Boolean))
  const strangers = sent.filter((url) => !uploaded.has(url))
  if (sent.length && strangers.length) problems.push(`请求里有 ${strangers.length} 个图片地址不是上传换来的`)
  return { problems, summary: { createRequests: observed.creates.length, uploads: observed.uploads.length, sentImageUrls: sent.length, sentTheDeadLink: sent.includes(dead), allFromUpload: sent.length > 0 && strangers.length === 0 } }
}

/** 拒绝 → 重试那一对：恰两笔创建请求（第一笔原链接、第二笔上传后的新链接）、恰一次上传。 */
export function judgeRefusalRetry(observed, { aliveLink }) {
  const problems = []
  const alive = bare(aliveLink)
  if (observed.creates.length !== 2) problems.push(`供应商收到的创建请求有 ${observed.creates.length} 笔（应恰好 2 笔：第一次被拒、重试一次）`)
  if (observed.uploads.length !== 1) problems.push(`上传了 ${observed.uploads.length} 次（重试应换成恰好 1 次上传）`)
  const [first, second] = observed.creates
  if (first && !first.imageUrls.includes(alive)) problems.push('第一笔请求带的不是活着的那条原链接（试探没有照发）')
  if (second?.imageUrls.includes(alive)) problems.push('重试那一笔发的还是被拒绝的那条原链接')
  const uploaded = new Set(observed.uploads.map((upload) => upload.url).filter(Boolean))
  if (second && (second.imageUrls.length === 0 || second.imageUrls.some((url) => !uploaded.has(url)))) problems.push('重试那一笔里的图片地址不都是上传换来的')
  return { problems, summary: { createRequests: observed.creates.length, uploads: observed.uploads.length, firstSentOriginalLink: Boolean(first?.imageUrls.includes(alive)), retrySentUploadedLink: Boolean(second && second.imageUrls.length > 0 && second.imageUrls.every((url) => uploaded.has(url))) } }
}

// ── 在真界面上走的步骤 ─────────────────────────────────────────────────────────────────────────────────
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function assetUrlIn(node) {
  return JSON.stringify(node ?? {}).match(/nomi-local:\/\/asset\/[^"\\]+/)?.[0] ?? null
}

/** nomi-local://asset/<项目>/<相对路径> → 项目目录里的绝对路径。 */
function assetFileOf(url, projectRoot) {
  const relative = url.replace(/^nomi-local:\/\/asset\/[^/]+\//, '').split('/').map(decodeURIComponent)
  return path.join(projectRoot, ...relative)
}

/** 把参考素材旁边的 .meta 写成"服务商的临时链接"：和真生成图落盘的形状一样（kind generated + originalUrl），其余字段原样保留。 */
export function writeProviderLink(assetFile, link) {
  const sidecar = `${assetFile}.meta`
  let meta = {}
  try { meta = JSON.parse(fs.readFileSync(sidecar, 'utf8')) } catch { /* 没有 .meta：新写一份 */ }
  fs.writeFileSync(sidecar, JSON.stringify({ ...meta, kind: 'generated', originalUrl: link }))
  return JSON.parse(fs.readFileSync(sidecar, 'utf8')).originalUrl
}

/** 加一个图片节点、写提示词、像真人一样放进一张本机参考图，返回节点和那张图落盘的位置。 */
async function addReferenceNode({ win, projectId, projectRoot, prompt }) {
  const nodesOnDisk = async () => (await readProject(win, projectId)).payload.generationCanvas.nodes ?? []
  const before = new Set((await nodesOnDisk()).map((node) => node.id))
  await clickOrFail(win.getByRole('button', { name: /添加图片节点|Add image node/i }).first(), '画布「添加图片节点」')
  const fresh = async () => (await nodesOnDisk()).find((node) => !before.has(node.id) && node.kind === 'image')
  await expect.poll(async () => Boolean(await fresh()), { message: '新图片节点落盘', timeout: stationTimeout() }).toBe(true)
  const nodeId = (await fresh()).id
  const node = win.locator(`[data-node-id="${nodeId}"]`)
  // 画布不渲染视口外的节点，节点一多新节点就可能落在外面：先缩放到全部可见。
  await canvasFitView(win, '缩放到新节点可见')
  await node.click({ position: { x: 8, y: 8 } })
  await node.locator('[contenteditable="true"]').last().fill(prompt)
  await node.locator('[data-asset-add-tile]').first().click()
  await win.locator('[data-testid="asset-picker"]').first().locator('input[type="file"]').setInputFiles(REFERENCE_IMAGE)
  // 上传的图是一个新的上游节点，连线指到这个节点上（参考走连线，目标节点自己不存图片地址）。
  const referenceUrl = async () => {
    const canvas = (await readProject(win, projectId)).payload.generationCanvas
    const sourceIds = new Set((canvas.edges ?? []).filter((edge) => edge.target === nodeId).map((edge) => edge.source))
    return (canvas.nodes ?? []).filter((candidate) => sourceIds.has(candidate.id)).map(assetUrlIn).find(Boolean) ?? ''
  }
  await expect.poll(referenceUrl, { message: '参考图被产品放进项目并连到节点上', timeout: stationTimeout() }).toMatch(/^nomi-local:\/\/asset\//)
  await win.keyboard.press('Escape')
  const assetFile = assetFileOf(await referenceUrl(), projectRoot)
  expect(fs.existsSync(assetFile), '参考图真的在项目目录里').toBe(true)
  // 花钱之前核：节点落在被授权的那一个模型上，且就是图生图（带着参考）。
  const meta = (await nodesOnDisk()).find((candidate) => candidate.id === nodeId)?.meta ?? {}
  expect({ vendor: meta.modelVendor, model: meta.modelKey }, '花钱之前：节点的模型就是被授权的那一个').toEqual({ vendor: IMAGE.vendorKey, model: IMAGE.modelKey })
  return { nodeId, node, assetFile, readNode: async () => (await nodesOnDisk()).find((candidate) => candidate.id === nodeId) }
}

/** 点节点上的 ↑，有确认框就点确认；等这一次提交走到结局（成功 / 失败 / 可找回），返回最后一条运行记录。 */
async function generateOnce({ win, reference }) {
  const previous = new Set(((await reference.readNode()).runs ?? []).map((run) => run.id))
  await reference.node.locator('[data-bar-segment="generate"]').click()
  const dialog = win.locator('[data-spend-confirm-dialog]')
  if (await dialog.first().waitFor({ state: 'visible', timeout: stationTimeout({ operations: 1 }) }).then(() => true).catch(() => false)) {
    await dialog.locator('[data-spend-confirm-action="confirm"]').click()
  }
  let latest = null
  await expect.poll(async () => {
    const fresh = ((await reference.readNode()).runs ?? []).filter((run) => !previous.has(run.id))
    latest = fresh.at(-1) ?? null
    return latest?.status ?? 'unsubmitted'
  }, { message: '这一次提交走到结局', timeout: stationTimeout({ turns: 2 }) }).toMatch(/^(success|error|failed|recoverable|cancelled)$/)
  return latest
}

/** 当前界面语言（走查按 localStorage 里的那一个）。 */
async function setLocale(win, locale) {
  await win.evaluate((value) => localStorage.setItem('nomi:locale:v1', value), locale)
  await win.reload({ waitUntil: 'domcontentloaded' })
  // openCanvas 按 document 的语言找导航钮：等 i18n 把这一轮的语言同步到 document 再往下走。
  await win.waitForFunction((value) => document.documentElement.lang.startsWith(value.slice(0, 2)), locale, { timeout: stationTimeout({ operations: 2 }) })
}

/**
 * 整条旅程。同一个项目里，每个语言加新节点走一遍：
 *   A. 失效链接直接出结果（界面无新元素）；
 *   B. （refusal = true，只有夹具）活着的链接 → 被拒 → 新卡 → 重试 → 上传后的新链接出结果。
 * @param {{
 *   paid: { walk: any, lockToAuthorizedModels: (win: any) => Promise<unknown> },
 *   evidence: Record<string, unknown>,
 *   locales?: readonly string[],
 *   links: { dead: string, alive?: string },
 *   observe: () => { creates: Array<{ imageUrls: string[] }>, uploads: Array<{ url: string | null }> },
 *   refusal?: { arm: () => void } | null,
 *   onSubmitted?: () => unknown,
 * }} options
 */
export async function runReferenceDeadLinkJourney({ paid, evidence, locales = ['zh-CN'], links, observe, refusal = null, onSubmitted = () => {} }) {
  const { walk } = paid
  const { win } = await walk.start({ first: true })
  await win.evaluate(() => window.localStorage.setItem('__nomiE2E', '1'))
  evidence.locales = {}
  // 先收窄模型再重新载入：渲染层的模型列表开窗时就读好了，不重新载入的话新节点还会落在收窄前的默认模型上。
  // 项目在中文界面下建一次（walk.newProject 认的是中文的文档区），每个语言在同一个项目里加新节点。
  await paid.lockToAuthorizedModels(win)
  await setLocale(win, 'zh-CN')
  const { projectId, projectRoot } = await walk.newProject()
  for (const locale of locales) {
    if (!UI_LOCALES.includes(locale)) throw new Error(`不认识的界面语言 ${locale}`)
    const report = (evidence.locales[locale] = {})
    // 每个语言从「这条连接没被拒绝过」开始：记录在设置目录里，上一轮 B 段记下的那一笔会让这一轮第一次就走上传。
    fs.rmSync(path.join(walk.settingsDir, 'reference-link-refusals.json'), { force: true })
    if (locale !== 'zh-CN') await setLocale(win, locale)
    await openCanvas(win)
    await collapseAgentPanel(win)

    // ── A. 失效链接：直接出结果，界面无新元素 ──
    const dead = await addReferenceNode({ win, projectId, projectRoot, prompt: locale === 'en' ? 'A paper boat on a quiet lake, soft morning light' : '安静湖面上的一只纸船，清晨柔光' })
    expect(writeProviderLink(dead.assetFile, links.dead), '参考图的 .meta 里存着一条失效的服务商临时链接').toBe(links.dead)
    const offsetA = { creates: observe().creates.length, uploads: observe().uploads.length }
    await walk.snap(`${locale}-a-before-generate`)
    const runA = await generateOnce({ win, reference: dead })
    await onSubmitted()
    expect(runA?.status, `[${locale}] 失效链接那一次生成成功`).toBe('success')
    const nodeA = await dead.readNode()
    expect(String(nodeA.result?.url ?? ''), `[${locale}] 结果落在节点上`).toMatch(/^nomi-local:\/\//)
    // 界面无新元素：没有错误卡，节点状态是成功。
    await expect(dead.node, `[${locale}] 节点是成功态`).toHaveAttribute('data-status', 'success')
    const reasonText = uiText(locale, 'generationCommon.observability.error.referenceUnfetchable.reason')
    // 「没有新卡」的探针要证它在这一屏是活的：同屏必然存在的对照物 = 这个节点自己的生成按钮。
    const alivePart = await proveProbe(dead.node.locator('[data-bar-segment="generate"]'), `[${locale}] 节点底栏在这一屏是活的（探针找得到东西）`)
    await expectAbsent(win.getByText(reasonText, { exact: true }), { provenBy: alivePart, message: `[${locale}] 失效链接直接出结果：没有"模型取不到参考图"卡` })
    await walk.snap(`${locale}-a-landed-no-new-element`)
    const observedA = observe()
    const wireA = judgeDeadLinkSend({ creates: observedA.creates.slice(offsetA.creates), uploads: observedA.uploads.slice(offsetA.uploads) }, { deadLink: links.dead })
    report.deadLink = { ...wireA.summary, ...(observedA.probes != null ? { probeGets: observedA.probes } : {}) }
    if (wireA.problems.length) throw new Error(`[${locale}] 失效链接那一笔的请求核对没过：${wireA.problems.join('；')}`)

    if (!refusal) continue

    // ── B. 活着的链接被模型拒绝 → 新卡 → 重试 → 上传后的新链接出结果 ──
    const alive = await addReferenceNode({ win, projectId, projectRoot, prompt: locale === 'en' ? 'A lighthouse at dusk, film grain' : '黄昏的灯塔，胶片颗粒' })
    expect(writeProviderLink(alive.assetFile, links.alive), '参考图的 .meta 里存着一条还活着的服务商临时链接').toBe(links.alive)
    const offsetB = { creates: observe().creates.length, uploads: observe().uploads.length }
    refusal.arm()
    const first = await generateOnce({ win, reference: alive })
    expect(first?.status, `[${locale}] 第一次：夹具按我们的意愿拒绝，这一次提交失败`).toMatch(/^(error|failed)$/)
    const reason = uiText(locale, 'generationCommon.observability.error.referenceUnfetchable.reason')
    const hint = uiText(locale, 'generationCommon.observability.error.referenceUnfetchable.hint')
    await expectVisible(alive.node.getByText(reason, { exact: true }), `[${locale}] 看到"${reason}"那张卡`, stationTimeout({ operations: 2 }))
    await expectVisible(alive.node.getByText(hint, { exact: true }), `[${locale}] 卡上的说明就是登记的那一句`, stationTimeout({ operations: 1 }))
    // 第二个节点在窗口右边缘外：缩放到全部可见，整张卡才拍得全。
    await canvasFitView(win, `[${locale}] 缩放到整张卡可见`)
    await walk.snap(`${locale}-b-card`)
    const retryName = new RegExp(`^\\s*${escapeRegExp(uiText(locale, 'generationCommon.observability.action.retry.main'))}\\s*$`)
    // 主按钮重试、没有换模型：同一张卡里不出现"换个模型"（探针证活：同一张卡上的「重试」就在）。
    const retryProof = await proveProbe(alive.node.getByRole('button', { name: retryName }), `[${locale}] 同一张卡上的主按钮「重试」`)
    await expectAbsent(alive.node.getByRole('button', { name: new RegExp(escapeRegExp(uiText(locale, 'generationCommon.observability.action.switchModel.main'))) }), { provenBy: retryProof, message: `[${locale}] 这张卡不给换模型` })
    const previous = new Set(((await alive.readNode()).runs ?? []).map((run) => run.id))
    await clickOrFail(alive.node.getByRole('button', { name: retryName }), `[${locale}] 卡上的主按钮「重试」`, { noWaitAfter: true })
    let retried = null
    await expect.poll(async () => {
      retried = ((await alive.readNode()).runs ?? []).filter((run) => !previous.has(run.id)).at(-1) ?? null
      return retried?.status ?? 'unsubmitted'
    }, { message: '重试走到结局', timeout: stationTimeout({ turns: 2 }) }).toMatch(/^(success|error|failed|recoverable|cancelled)$/)
    expect(retried?.status, `[${locale}] 重试成功`).toBe('success')
    await expect(alive.node, `[${locale}] 重试之后节点是成功态`).toHaveAttribute('data-status', 'success')
    await walk.snap(`${locale}-b-retried-landed`)
    const observedB = observe()
    const wireB = judgeRefusalRetry({ creates: observedB.creates.slice(offsetB.creates), uploads: observedB.uploads.slice(offsetB.uploads) }, { aliveLink: links.alive })
    report.refusalRetry = wireB.summary
    if (wireB.problems.length) throw new Error(`[${locale}] 拒绝后重试的请求核对没过：${wireB.problems.join('；')}`)
  }
  evidence.verified = refusal
    ? ['dead-link-sends-uploaded-link', 'dead-link-lands-with-no-new-element', 'refusal-shows-new-card', 'retry-sends-uploaded-link', 'one-post-per-submission']
    : ['dead-link-sends-uploaded-link', 'dead-link-lands-with-no-new-element', 'one-post-per-submission']
}
