#!/usr/bin/env node
// 剧本 PB07 · 「生成失败有几种，每一种说的都是真话」
//
// 已知问题（0.22.1，pb06 抓到「原因说错」之后的同一类）：失败原因只按 HTTP 状态码归类（400 一律「参数不被接受」），
// 结果已经送达却读不出来也被说成「服务商失败」并劝人换一家，完整可显示的图（IEND 之后带了尾数据）被本机判成解码失败。
// 真实创作者会遇到的三件事，依次发生在同一张卡上：
//   ① 供应商回「参数不对」（真的参数错误，不是模型下线）→ 卡上仍说「参数不被接受」——修复不能把这一类也改没；
//   ② 供应商说成功、给的字节读不出来 → 卡上说「生成的文件没能读出来」；运行记录里记着它发给了谁；
//      屏上不出现「切到另一家」这类劝换供应商的提示（结果已经送达，失败在本机，换一家不是解法）；
//   ③ 供应商说成功、给的是一张完整的 PNG（IEND 之后带了尾数据）→ 图照常落地成功（这一类以前被判 decode_failed）；
//   ④ 供应商明确拒了这一笔（404），回一句认不出类别的话（一句英文）→ 标题永远是界面语言：中文界面顶的是「生成失败」、英文原话降到「服务商原话」那一格，
//      英文界面标题就是那句话（以前中文界面顶着一整句英文）；说明如实说「认不出」——不编「临时故障 / 额度」，供应商给了码就带上码；
//      屏上的切家提示里，原因自带句号时模板不再叠第二个。
//
// 零花费：两家本机回环供应商（第二家只是为了让「切家提示」有资格出现——② 里它不出现才有证明力）；四笔都发给第一家。
// 夹具里「坏」的定义与宿主的落地判据是同一个（见 tests/ux/agent-runtime-fixture.mjs 的 undecodableJpegBytes / pngWithTrailingBytes）。
import { DEFAULT_TIMEOUT_MS, expect, expectAbsent, proveProbe } from '../../_assert.mjs'
import { panCanvasUntilInside } from '../../_canvasHit.mjs'
import { stationTimeout } from '../../_station-budget.mjs'
import { FIXTURE_IMAGE_MODEL, FIXTURE_VENDOR, FIXTURE_VENDOR_NAME } from '../../agent-runtime-fixture.mjs'
import { clickNodeGenerate, zoomOutUntilVisible } from '../actions.mjs'
import { uiText } from '../invariants.mjs'
import { startPlaybook } from '../launch.mjs'

process.env.NOMI_WALK_UNPRICED_MODEL = '1'
// 卡片标题与提示词是用户自己写的内容：英文界面那一档就用英文写（界面漏译才是要抓的，用户写中文不是）。
const SEED_EN = process.env.NOMI_FULL_WALK_LOCALE === 'en'
const LOCALE = SEED_EN ? 'en' : 'zh-CN'
const reasonOf = (kind) => uiText(LOCALE, `generationCommon.observability.error.${kind}.reason`)
const CARD = 'kinds-card'
/** 供应商回的一句认不出类别的话（英文）：它说了什么，界面只能原样转述，不能替它编原因。 */
const UNKNOWN_SAID = 'The render farm returned an unrecognised state after the third checkpoint.'
const UNKNOWN_CODE = 'render_farm_state'
/** 一句真的参数错误（OpenAI 兼容形状：type=invalid_request_error、param 指向出错的参数、code 为 null）。 */
const PARAM_ERROR = "Invalid value for 'size': 4096x4096 is not supported by this model. Supported sizes are 1024x1024 and 1024x1536."

const base = { categoryId: 'shots', references: [], runs: [] }
const pb = await startPlaybook({
  id: 'pb07-failure-kinds',
  needs: ['loopbackProvider'],
  fixtureOptions: { extraImageVendor: true },
  seed: () => ({
    nodes: [{
      ...base, id: CARD, kind: 'image', title: SEED_EN ? 'Harbor at dusk' : '黄昏的港口', prompt: SEED_EN ? 'A quiet harbor at dusk, warm lamps on the water, cinematic' : '黄昏的安静港口，水面上有暖色的灯，电影感', position: { x: 200, y: 140 }, status: 'idle', history: [],
      meta: { modelKey: FIXTURE_IMAGE_MODEL, modelVendor: FIXTURE_VENDOR, imageModel: FIXTURE_IMAGE_MODEL, imageModelVendor: FIXTURE_VENDOR },
    }],
    groups: [],
    edges: [],
  }),
})
const { smoke, fixture, monitor } = pb
const win = () => smoke.win
const node = async () => ((await monitor.readProject())?.payload?.generationCanvas?.nodes ?? []).find((entry) => entry.id === CARD)
const card = () => win().locator(`[data-node-id="${CARD}"]`).first()
const toast = () => win().locator('.mantine-Notification-root')
const switchNotice = () => toast().filter({ hasText: /切到|Switch to/ })
// 四笔提交的结局按顺序排好：参数错误 → 读不出来 → 带尾数据的完整 PNG → 一句认不出类别的话。
// ④ 回 404：它在「明确拒绝」名单里（服务商回了话、这一笔没被收下），状态码本身又不带类别（不是参数 / 鉴权 / 额度），
// 卡上只能照实转述那句话。不用 418：418 不在名单里，按名单是「结果未知」（拿不准收没收下，镜头锁住等核对）——那是另一张卡。
const UNKNOWN_REPLY = { error: { message: UNKNOWN_SAID, code: UNKNOWN_CODE } }
fixture.setMediaBehavior(({ index }) => {
  if (index === 0) return { reject: { status: 400, json: { error: { message: PARAM_ERROR, type: 'invalid_request_error', param: 'size', code: null } } } }
  if (index === 1) return { corruptResult: true }
  if (index === 2) return { trailingBytesResult: true }
  return { reject: { status: 404, json: UNKNOWN_REPLY } }
})
// 生图端点回 404 时，宿主会改走同一家的 chat 路由再问一次（electron/catalog/imageRouteFallback.ts）：那一问也回同一句话，
// 卡上看到的仍是这家服务商的原话（不让夹具把这一问判成计划外请求）。
fixture.respond({
  label: 'pb07 ④ chat route asked after the image route 404',
  match: (body) => body?.model === FIXTURE_IMAGE_MODEL,
  reply: { type: 'http-error', status: 404, json: UNKNOWN_REPLY },
})
/** 打开项目时画布把唯一一张卡放得很大、标题与原因在窗口外：像人一样先缩小、再把整张卡（标题、原因、建议、按钮）拖进舞台再看。 */
const showWholeCard = async () => {
  await zoomOutUntilVisible(win(), card())
  // 顶栏压着舞台上沿：给卡留出一条顶边，标题行与原因（状态条）才不被顶栏盖住。
  await panCanvasUntilInside(win(), card(), { margin: { top: 110 } })
}
/** 这一次运行的记录：新起的那一条（id 不是上一次的），落盘后的样子。 */
const newRun = async (previousRunId) => {
  const run = (await node())?.runs?.[0]
  return run && run.id !== previousRunId ? run : null
}

let harnessError = null
try {
  let noticeProof = null
  let firstRunId = null
  let secondRunId = null
  let thirdRunId = null

  await monitor.step('打开项目（从项目库）', () => smoke.openProject(), { surfaces: ['*'], critical: true })

  await monitor.step('① 点 ↑ 生成（供应商回「参数不对」）', async () => {
    await monitor.consentNodeGenerate(CARD, { label: '第一次生成' })
    await clickNodeGenerate(win(), CARD)
    await expect.poll(async () => (await newRun(null))?.status, { message: '这一次落成失败', timeout: stationTimeout({ operations: 4 }) }).toBe('error')
    const run = await newRun(null)
    firstRunId = run.id
    // 运行记录里记着这一次发给了谁——失败提示与健康记账点名的是它，不是「失败时节点碰巧选着谁」。
    expect(run.attempt, '失败的运行记录里带着这一次发给了哪家的哪个模型').toEqual({ vendorKey: FIXTURE_VENDOR, modelKey: FIXTURE_IMAGE_MODEL })
    await expect(card(), '卡上说的是「参数不被接受」——真的参数错误，这条话不能被「按上游原话归类」带没').toContainText(reasonOf('input'), { timeout: DEFAULT_TIMEOUT_MS })
    // 这是服务商那一侧的失败，本场又有第二家可切：切家提示有资格出现。它出现，就是下一步「不该出现」的基线。
    noticeProof = await proveProbe(switchNotice(), '服务商这一侧的失败（参数错误）会弹出切家提示（本场有第二家可切）')
    // 提示点名的是这一家的显示名（「模型接入」里看到的名字），不是内部 id；动作按钮上的字完整，没有省略号。
    const noticeText = await switchNotice().first().innerText()
    expect(noticeText, '提示点名的是供应商的显示名').toContain(FIXTURE_VENDOR_NAME)
    expect(noticeText, '提示里不出现供应商的内部 id').not.toContain(FIXTURE_VENDOR)
    const actionCut = await switchNotice().first().locator('button:not(.mantine-Notification-closeButton)').first()
      .evaluate((button) => button.scrollWidth > button.clientWidth + 1 || button.scrollHeight > button.clientHeight + 1)
    expect(actionCut, '切家按钮上的字完整（没被省略号 / 被削掉）').toBe(false)
    await showWholeCard()
    await monitor.screenshot('param-error-card')
  }, { surfaces: ['modal', 'canvasGesture', 'canvasViewport'] })

  await monitor.step('② 再点 ↑ 生成（供应商说成功，给的字节读不出来）', async () => {
    await monitor.consentNodeGenerate(CARD, { label: '第二次生成' })
    await clickNodeGenerate(win(), CARD)
    await expect.poll(async () => (await newRun(firstRunId))?.status, { message: '第二次落成失败', timeout: stationTimeout({ operations: 4 }) }).toBe('error')
    const run = await newRun(firstRunId)
    secondRunId = run.id
    expect(run.attempt, '第二次失败的运行记录也带着它发给了谁').toEqual({ vendorKey: FIXTURE_VENDOR, modelKey: FIXTURE_IMAGE_MODEL })
    await expect(card(), '卡上说的是「生成的文件没能读出来」，不是「参数不被接受」，也不是「服务商失败」').toContainText(reasonOf('outputUnreadable'), { timeout: DEFAULT_TIMEOUT_MS })
    // 结果已经送达、失败在本机：不劝换一家。上一条（参数错误）的切家提示也已随节点状态变化收走，不留一句过期的话。
    await expectAbsent(switchNotice(), { provenBy: noticeProof, message: '读不出产物这件事不劝换一家（结果已送达，失败在本机）' })
    await showWholeCard()
    await monitor.screenshot('unreadable-file-card')
  }, { surfaces: ['modal', 'canvasGesture', 'canvasViewport'] })

  await monitor.step('③ 再点 ↑ 生成（供应商说成功，给的是带尾数据的完整 PNG）', async () => {
    await monitor.consentNodeGenerate(CARD, { label: '第三次生成' })
    await clickNodeGenerate(win(), CARD)
    await expect.poll(async () => (await newRun(secondRunId))?.status, { message: '第三次落成成功（这一类以前被判 decode_failed）', timeout: stationTimeout({ operations: 4 }) }).toBe('success')
    thirdRunId = (await newRun(secondRunId)).id
    const landed = await node()
    expect(landed?.status, '节点落成 success').toBe('success')
    expect(landed?.result?.url, '产物落进了项目（nomi-local 地址），不是供应商给的原始地址').toMatch(/^nomi-local:\/\//)
    await expectAbsent(switchNotice(), { provenBy: noticeProof, message: '成功之后屏上没有劝换供应商的提示' })
    await monitor.screenshot('trailing-bytes-landed')
  }, { surfaces: ['modal', 'canvasGesture', 'canvasViewport'] })

  await monitor.step('④ 再点 ↑ 生成（供应商回一句认不出类别的话）', async () => {
    await monitor.consentNodeGenerate(CARD, { label: '第四次生成' })
    await clickNodeGenerate(win(), CARD)
    await expect.poll(async () => (await newRun(thirdRunId))?.status, { message: '第四次落成失败', timeout: stationTimeout({ operations: 4 }) }).toBe('error')
    // 标题永远是界面当前语言的一句话：中文界面顶的是「生成失败」，供应商的英文原话降到「服务商原话」那一格（仍看得见）；
    // 英文界面里那句话本来就是英文，直接当标题。
    await expect(card(), SEED_EN ? '英文界面：标题就是供应商那句话' : '中文界面：标题是「生成失败」，不是一整句英文').toContainText(SEED_EN ? UNKNOWN_SAID : reasonOf('unknown'), { timeout: DEFAULT_TIMEOUT_MS })
    await expect(card(), '供应商原话在「服务商原话」那一格里仍看得见').toContainText(UNKNOWN_SAID, { timeout: DEFAULT_TIMEOUT_MS })
    // 说明如实说「认不出」并带上供应商给的码；不编原因（没有「临时故障 / 额度」）。
    const honest = uiText(LOCALE, 'generationCommon.observability.error.unknown.hintWithCode').replace('{{code}}', UNKNOWN_CODE)
    await expect(card(), '说明说的是「认不出」并带着供应商的错误码').toContainText(honest, { timeout: DEFAULT_TIMEOUT_MS })
    expect(await card().innerText(), '认不出的失败不编原因、不提额度').not.toMatch(/临时故障|额度|out of credit|temporarily unavailable/i)
    // 屏上的切家提示是同一句话的另一种排版：原因（供应商的整句话）自带句号时，提示模板不再补第二个（以前叠成「…checkpoint..」）。
    await expect(switchNotice().first(), '这一笔是服务商那一侧的失败，本场又有第二家可切：切家提示出现').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
    expect(await switchNotice().first().innerText(), '提示里没有叠在一起的句号').not.toMatch(/[.。]{2}/)
    await showWholeCard()
    await monitor.screenshot('unknown-kind-card')
  }, { surfaces: ['modal', 'canvasGesture', 'canvasViewport'] })

  await monitor.settle('收尾')
} catch (error) {
  harnessError = error
  console.error('[full-walk] pb07 故障：', error?.stack ?? error)
}
process.exit(await pb.finish(harnessError))
