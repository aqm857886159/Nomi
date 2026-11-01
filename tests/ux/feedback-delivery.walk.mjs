// R13 走查：应用内反馈发得出去、带得上日志。中英两轨，各一个隔离资料库。
//
// 接收端是本机真起的 HTTP 服务（不 mock fetch），模式可切：ok / 413-once / reset（收完就断）/ hang（收了不答）。
//   ① 成功：拿到编号；接收端收到的包里 logs/tail.txt 有行，夹具里埋的密钥、路径、提示词零命中。
//   ② 对话里的问题：有勾选框；勾了但轨迹读不到时清单写明，contentIncluded 是 false。这张卡最高的样子放到最小窗口，「发送」还点得到。
//   ③ 超限：接收端回 413 → 去掉附件再发，拿到编号，界面说明没带上；摘要和留言还在。
//   ④ 断线 / 不回答：几秒内告诉用户已存本机，队列文件里有这份；恢复后不重启就送达。
//   ⑤ 存不下来也发不出去：说没能确认，留言还在，按钮能点，再点一次成功。
//   ⑥ 排着队就关掉 App：重开后自己补发，只送达一份。
//   ⑦ 这个构建没配接收端：说清发不出去和下一步。
//
// 卡是用失败面共用的那个事件打开的（四个失败面都派发它）；走到失败面那颗钮的路在
// feedback-loop-consent-and-report.walk.mjs，这里盯的是发送这条链在各种接收端下用户看到什么。
//
// 日志目录要换到隔离目录：macOS 上日志路径不随 userData 走，不换就读到这台机器的真实日志。
//
// 用法: pnpm run build && node tests/ux/feedback-delivery.walk.mjs
// 产出: docs/evidence/2026-11-01-feedback-delivery/walk/（两轨截图、measure.json、log-tail-sample.txt；每次先清空这一层，上一层的成绩单和性能结果不动）
import { createServer } from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { require as tsxRequire } from 'tsx/cjs/api'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { dismissSplashIfPresent } from '../../evals/lib/isoApp.mjs'
import { ACCEPTANCE_VIEWPORT, launchNomiApp } from './_launchApp.mjs'
import { clickOrFail, expect, expectAbsent, expectHidden, expectHittable, expectVisible, proveProbe, screenshotSettled } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'docs/evidence/2026-11-01-feedback-delivery/walk')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

const { enFeedbackReport, zhFeedbackReport } = tsxRequire('../../src/i18n/locales/feedbackReport.ts', import.meta.url)
const { FEEDBACK_MANIFEST_ITEMS: ITEMS } = tsxRequire('../../electron/shared/contracts/feedback.ts', import.meta.url)

const failures = []
const check = (ok, message) => { if (!ok) failures.push(message) }

// ── 埋进日志的东西 ─────────────────────────────────────────────────────────────
// 都是合成靶子，不是任何真实账号的 key。
const SECRET_SK = 'sk-live-9QhT2mVx7Zb4Lp0RwEaYcN1sKdJf'
const SECRET_AWS = 'AKIAIOSFODNN7EXAMPLE'
const LONG_BASE64 = 'V2Fsa0JERUZHSElKS0xNTk9QUVJTVFVWV1hZWmFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6'
// 埋进日志的假路径，不是这台机器上的位置；分段拼，因为门岗不许脚本里出现主目录形状的字面量。
const MAC_HOME = ['', 'Users', 'walker'].join('/')
const WINDOWS_HOME = ['C:', 'Users', 'walker'].join('\\')
const UNIX_HOME = ['', 'home', 'walker'].join('/')

/** 每种不许出门的东西一行，写法照真实日志（也有老版本没过写入脱敏的）。needle 都是全包里不会碰巧出现的词。 */
const PLANTED = [
  { name: 'sk 形密钥', needle: SECRET_SK, body: `WARN  vendor         call reason=${SECRET_SK}` },
  { name: 'Bearer', needle: 'walkBearerToken123456', body: 'WARN  vendor         call reason=Bearer walkBearerToken123456' },
  { name: 'AWS key', needle: SECRET_AWS, body: `WARN  vendor         call code=${SECRET_AWS}` },
  { name: '长 base64', needle: LONG_BASE64, body: `INFO  tasks          read requestId=${LONG_BASE64}` },
  { name: 'data URI', needle: 'iVBORw0KGgoWalk', body: 'INFO  assets         seen reason=data:image/png;base64,iVBORw0KGgoWalkAAAANSU' },
  { name: '带 query 的 URL', needle: 'walk-sig-abc123', body: 'WARN  vendor         get status=https://cdn.example/a.mp4?sig=walk-sig-abc123' },
  { name: 'file URL', needle: 'walk-secret-movie', body: `WARN  assets         open reason=file://${MAC_HOME}/walk-secret-movie.mov` },
  { name: 'Mac 路径带空格和中文', needle: '走查猫咪短片', body: `WARN  assets         open absolutePath=${MAC_HOME}/Nomi Projects/走查猫咪短片/a.png` },
  { name: 'Windows 路径', needle: 'WalkDreams', body: `WARN  assets         open reason=${WINDOWS_HOME}\\WalkDreams\\a.png status=1` },
  { name: 'Unix 路径', needle: 'walk-cat-film', body: `WARN  assets         open reason=${UNIX_HOME}/walk-cat-film/a.png` },
  { name: 'firstLine 里的提示词', needle: '走查末班公交车', body: 'WARN  agent          lane-tool-failed tool=write firstLine=走查末班公交车上只剩两个人 consecutive=2' },
  { name: 'firstLine 英文', needle: 'walk-lonely-bus', body: 'WARN  agent          lane-tool-failed tool=write firstLine=a walk-lonely-bus at night consecutive=2' },
  { name: '对话名', needle: 'walk-winter-lane', body: 'INFO  agent          lane-start lane=walk-winter-lane' },
  { name: '项目 id', needle: 'walk-winter-project', body: 'INFO  workspace      open projectId=walk-winter-project' },
  { name: '私有域名', needle: 'relay.walk-corp.local', body: 'WARN  vendor         fallback host=relay.walk-corp.local base=https://relay.walk-corp.local' },
  { name: 'message', needle: 'walk-invoice-overdue', body: 'WARN  update         failed message=walk-invoice-overdue for account' },
  { name: 'detail', needle: 'walk-sandbox-off', body: 'WARN  agent          inactive code=X detail=walk-sandbox-off because reasons' },
  { name: '自建中转的 vendor', needle: 'internal-proxy-walk-local', body: 'WARN  vendor         call vendor=internal-proxy-walk-local model=walk-exec-model status=500 ms=12' },
  { name: '自建中转的模型别名', needle: 'walk-exec-model', body: 'WARN  vendor         call vendor=internal-proxy-walk-local model=walk-exec-model status=500 ms=12' },
  { name: '兄弟连接名', needle: 'walk-my-team', body: 'WARN  vendor         call vendor=apimart--walk-my-team status=500' },
]
/** 排查要用的那些必须还在，否则「零命中」可能只是整份日志都没带上。 */
const KEPT = [
  { body: 'WARN  vendor         call vendor=apimart model=seedance-2.5 status=503 ms=1200 attempt=2 req=walk-req-1', expected: 'WARN vendor call vendor=apimart model=seedance-2.5 status=503 ms=1200 attempt=2 req=walk-req-1' },
  { body: 'ERROR vendor         poll-failed taskId=walk-task-1 VendorRequestError msg#ab12cd34 code=ECONNRESET vendor=apimart http=502', expected: 'ERROR vendor poll-failed taskId=walk-task-1 VendorRequestError msg#ab12cd34 code=ECONNRESET vendor=apimart http=502' },
  { body: 'ERROR export         done TypeError msg#ab12cd34 code=ENOSPC | at run (runner.js:5:1)', expected: 'ERROR export done TypeError msg#ab12cd34 code=ENOSPC | at run (runner.js:5:1)' },
]
const CRASH_MARKER = 'walk-crash-marker'

function seedLogs(logsDir) {
  fs.mkdirSync(logsDir, { recursive: true })
  const now = new Date()
  const day = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-')
  const at = new Date(now.getTime() - 60_000).toISOString()
  const lines = [...PLANTED, ...KEPT].map(({ body }) => `[${at}] ${body}`)
  fs.writeFileSync(path.join(logsDir, `nomi-${day}.log`), `${lines.join('\n')}\n`)
  // 线上那 29 份的另一半原因：崩溃日志排在最前。
  fs.writeFileSync(path.join(logsDir, 'nomi-crash.log'), `${CRASH_MARKER}\n`)
  return at
}

// ── 本机接收端 ─────────────────────────────────────────────────────────────────
async function startIntake() {
  const state = { mode: 'ok', attempts: [], accepted: [], sequence: 0 }
  const server = createServer((request, response) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      const answer = (status, body) => {
        response.writeHead(status, { 'content-type': 'application/json' })
        response.end(JSON.stringify(body))
      }
      if (request.url !== '/v1/feedback') {
        answer(200, { ok: true, ref: 'walk-ref' })
        return
      }
      const body = Buffer.concat(chunks).toString('utf8')
      const mode = state.mode
      state.attempts.push({ mode, body, authorization: request.headers.authorization })
      if (mode === 'hang') return
      if (mode === 'reset') {
        request.socket.destroy()
        return
      }
      if (mode === '413-once') {
        state.mode = 'ok'
        answer(413, { ok: false })
        return
      }
      state.sequence += 1
      state.accepted.push(body)
      answer(200, { ok: true, ref: 'walk-ref', id: `NF-1101-${String(state.sequence).padStart(4, '0')}` })
    })
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  return {
    state,
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => { server.closeAllConnections(); server.close() },
  }
}

// ── 走查 ───────────────────────────────────────────────────────────────────────
const textOf = async (locator) => (await locator.innerText().catch(() => '')).trim()
const SPLASH_SEEN = { 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen' }

async function launch(name, locale, tempRoot, endpointEnv) {
  const instance = await launchNomiApp({
    name,
    tempRoot,
    env: { ...endpointEnv, NODE_ENV: 'production' },
    initialLocalStorage: { ...SPLASH_SEEN, 'nomi:locale:v1': locale },
  })
  await dismissSplashIfPresent(instance.win)
  return instance
}

function openCard(win, request) {
  return win.evaluate((detail) => window.dispatchEvent(new CustomEvent('nomi-open-feedback-share', { detail })), request)
}

/** 清单和界面文字：当前语言、没有机器码。 */
async function checkLanguage(card, locale, label) {
  const text = await textOf(card)
  check(!/never-collected|content-checkbox|no-conversation|trajectory-|logs-unavailable|feedbackReport\./.test(text), `${locale} ${label}：界面上露出了机器码或词条名：${text}`)
  if (locale === 'en') check(!/[\u3400-\u9fff]/.test(text), `en ${label}：英文界面里有中文：${text}`)
}

function inspectBody(body, roots) {
  const needleHits = PLANTED.filter(({ needle }) => body.includes(needle)).map(({ name }) => name)
  if (body.includes(CRASH_MARKER)) needleHits.push('崩溃日志')
  const pathHits = [...roots, os.homedir(), repoRoot, '/Users/', '/home/', '/var/folders', 'C:\\\\Users'].filter((root) => body.includes(root))
  const envelope = JSON.parse(body)
  const tail = envelope.attachments?.[ITEMS.logTail]
  return { envelope, tail, needleHits, pathHits }
}

async function journey(locale) {
  const t = locale === 'en' ? enFeedbackReport : zhFeedbackReport
  const measure = { locale }
  const intake = await startIntake()
  const tempRoot = makeTempDir(`nomi-feedback-delivery-${locale}-`)
  const logsDir = path.join(tempRoot, 'logs')
  const seededAt = seedLogs(logsDir)
  const endpointEnv = { NOMI_INTAKE_ENDPOINT: intake.url, NOMI_INTAKE_TOKEN: 'walk-token' }
  const instance = await launch(`feedback-delivery-${locale}`, locale, tempRoot, endpointEnv)
  const { app, win, settingsDir } = instance
  const roots = [tempRoot, instance.settingsDir, instance.projectsDir, instance.userDataDir, logsDir]
  const queueFile = path.join(settingsDir, 'intake-queue-feedback.json')
  const queueText = () => { try { return fs.readFileSync(queueFile, 'utf8') } catch { return '' } }
  let shotNumber = 0
  const shot = async (name) => {
    shotNumber += 1
    const tag = `${locale}-${String(shotNumber).padStart(2, '0')}-${name}`
    await screenshotSettled(win, { path: path.join(shotsDir, `${tag}.png`) })
    console.log(`  · shot ${tag}`)
  }
  const card = win.locator('[data-feedback-card]').first()
  const receipt = win.locator('[data-feedback-receipt]').first()
  const phase = (name) => win.locator(`[data-feedback-card][data-feedback-phase="${name}"]`).first()
  const send = card.locator('[data-feedback-send]').first()
  const note = card.locator('input[data-feedback-note], [data-feedback-note] input').first()
  const summaries = locale === 'en'
    ? { import: 'That file type is not supported', agent: 'The conversation stopped' }
    : { import: '已跳过 1 个不支持的文件', agent: '这次对话停下了' }
  // 重试第一次在一分钟后，挂住的请求还要先等它自己超时：两分半够了，不重启 App。
  const arrived = (text) => expect.poll(() => intake.state.accepted.some((body) => body.includes(text)), { message: `不重启的情况下接收端应当收到「${text}」`, timeout: stationTimeout({ operations: 10 }), intervals: [500] }).toBe(true)
  const queueDrained = (text) => expect.poll(() => queueText().includes(text), { message: `「${text}」送达后应当离开队列`, timeout: stationTimeout(), intervals: [200] }).toBe(false)
  // 回执折行也要留在图标右边：英文那句长，图标曾经独占一行。
  const checkReceiptRow = async (label) => {
    const [icon, text] = await Promise.all([card.locator('svg').first().boundingBox(), receipt.boundingBox()])
    check(icon && text && icon.x + icon.width <= text.x && text.y <= icon.y + icon.height, `${locale}：${label}：图标不该独占一行`)
  }

  try {
    // 必须在第一次发送之前：之后主进程写日志、读日志都到这里。
    await app.evaluate(({ app: electronApp }, dir) => electronApp.setAppLogsPath(dir), logsDir)

    // ── ① 成功 ────────────────────────────────────────────────────────────────
    const checkbox = card.locator('input[type="checkbox"]').first()
    await openCard(win, { surface: 'agent', summary: summaries.agent, errorKind: 'lane-failed', laneName: 'walk-lane' })
    const checkboxProof = await proveProbe(checkbox, '对话里的问题有勾选框')
    await openCard(win, { surface: 'import', summary: summaries.import, errorKind: 'asset-import-unsupported' })
    await expectVisible(card, '反馈卡应当打开')
    await expectAbsent(checkbox, { provenBy: checkboxProof, message: `${locale}：不在对话里的问题不该有勾选框` })
    const attaches = await textOf(card.locator('[data-feedback-attaches]').first())
    check(attaches.startsWith(t.attachesLead) && attaches.includes(t.attachItem.logs) && attaches.includes(t.attachItem.catalog), `${locale}：「附带」行应当写日志和目录：${attaches}`)
    check(!attaches.includes(t.attachItem.trace), `${locale}：不在对话里的问题「附带」行不该写工具轨迹：${attaches}`)
    await shot('idle-no-conversation')

    await clickOrFail(card.locator('[data-feedback-view]').first(), '点「查看」')
    await expectVisible(card.locator(`[data-feedback-entry="${ITEMS.logTail}"]`).first(), '清单应当列出日志尾巴')
    const manifestRows = await card.locator('[data-feedback-excluded]').evaluateAll((nodes) => nodes.map((node) => ({
      what: node.getAttribute('data-feedback-excluded'), why: node.getAttribute('data-feedback-why'), text: node.textContent ?? '',
    })))
    for (const row of manifestRows) check(row.text.includes(t.manifestWhy[row.why]), `${locale}：清单「${row.what}」的原因应当是当前语言：${row.text}`)
    const whyOf = (what) => manifestRows.find((row) => row.what === what)?.why
    check(whyOf(ITEMS.secrets) === 'never-collected-by-design', `${locale}：清单应当写明密钥从不收集`)
    check(whyOf(ITEMS.paths) === 'never-collected-by-design', `${locale}：清单应当写明路径从不收集`)
    check(whyOf(ITEMS.content) === 'no-conversation-in-context', `${locale}：没有对话时内容的原因不该是「没勾选」，实际 ${whyOf(ITEMS.content)}`)
    await checkLanguage(card, locale, '清单')
    await shot('manifest')

    const okNote = `walk-note-ok-${locale}`
    await note.fill(okNote)
    await clickOrFail(send, '点「发送」')
    await expectVisible(receipt, '发完应当收成一行编号')
    const okReceipt = await textOf(receipt)
    check(/NF-\d{4}-\d{4}/.test(okReceipt), `${locale}：应当给编号：${okReceipt}`)
    check(okReceipt === t.sentWithId.replace('{{id}}', okReceipt.match(/NF-\d{4}-\d{4}/)?.[0] ?? ''), `${locale}：回执文案不对：${okReceipt}`)
    await shot('sent')

    const okBody = intake.state.accepted.find((body) => body.includes(okNote))
    check(Boolean(okBody), `${locale}：接收端没有收到这一份`)
    if (okBody) {
      const { envelope, tail, needleHits, pathHits } = inspectBody(okBody, roots)
      check(intake.state.attempts.at(-1).authorization === 'Bearer walk-token', `${locale}：应当带 bearer 令牌`)
      check(Array.isArray(tail) && tail.length > 0, `${locale}：logs/tail.txt 应当有行（线上 29 份全是空的）`)
      check(envelope.manifest.entries.some((entry) => entry.path === ITEMS.logTail), `${locale}：清单应当列出日志尾巴`)
      check(!envelope.manifest.excluded.some((item) => item.what === ITEMS.logTail), `${locale}：日志尾巴不该被排除`)
      check(needleHits.length === 0, `${locale}：包里有不该出门的东西：${needleHits.join('、')}`)
      check(pathHits.length === 0, `${locale}：包里有本机路径：${pathHits.length} 处`)
      const joined = (tail ?? []).join('\n')
      for (const { expected } of KEPT) check(joined.includes(expected), `${locale}：排查要用的这一行不该丢：${expected}`)
      measure.firstReport = {
        bodyBytes: Buffer.byteLength(okBody, 'utf8'),
        entries: envelope.manifest.entries.map(({ path: item, bytes }) => ({ path: item, bytes })),
        logTailLines: tail?.length ?? 0,
        logTailBytes: Buffer.byteLength(JSON.stringify(tail ?? null), 'utf8'),
        plantedLines: PLANTED.length,
        keptLines: KEPT.length,
      }
    }

    // ── ② 对话里的问题 ────────────────────────────────────────────────────────
    await openCard(win, { surface: 'agent', summary: summaries.agent, errorKind: 'lane-failed', laneName: 'walk-lane' })
    await expectVisible(checkbox, '对话里的问题应当有勾选框')
    check(!(await checkbox.isChecked()), `${locale}：内容默认不勾`)
    check((await textOf(card)).includes(t.includeContent), `${locale}：勾选框文案应当说清带什么`)
    const laneAttaches = await textOf(card.locator('[data-feedback-attaches]').first())
    check(laneAttaches.includes(t.attachItem.trace), `${locale}：对话里的问题「附带」行应当写工具轨迹：${laneAttaches}`)
    await shot('idle-conversation')
    await checkbox.check()
    await clickOrFail(card.locator('[data-feedback-view]').first(), '点「查看」')
    const contentRow = card.locator(`[data-feedback-excluded="${ITEMS.content}"]`).first()
    await expectVisible(contentRow, '勾了但轨迹读不到，清单应当写明内容没带上')
    check(await contentRow.getAttribute('data-feedback-why') === 'trajectory-unavailable', `${locale}：内容没带上的原因应当是轨迹读不到`)
    await checkLanguage(card, locale, '勾选后的清单')
    await shot('manifest-content-ticked')

    // 这张卡最高的样子放到 App 允许的最小窗口：留言框和「发送」还得点得到。
    const browserWindow = await app.browserWindow(win)
    const resizeContent = async (size) => {
      await browserWindow.evaluate((nativeWindow, next) => nativeWindow.setContentSize(next.width, next.height), size)
      await win.setViewportSize(size)
    }
    const [minWidth, minHeight] = await browserWindow.evaluate((nativeWindow) => nativeWindow.getMinimumSize())
    await resizeContent({ width: minWidth, height: minHeight })
    measure.minWindow = { width: minWidth, height: minHeight, cardHeight: await card.evaluate((node) => Math.round(node.getBoundingClientRect().height)) }
    await expectHittable(note, `${locale}：最小窗口下留言框应当点得到`)
    await expectHittable(send, `${locale}：最小窗口下「发送」应当点得到`)
    await shot('manifest-min-window')
    await resizeContent(ACCEPTANCE_VIEWPORT)

    const laneNote = `walk-note-lane-${locale}`
    await note.fill(laneNote)
    await clickOrFail(send, '在对话的卡上点「发送」')
    await expectVisible(receipt, '发完应当收成一行编号')
    const laneBody = intake.state.accepted.find((body) => body.includes(laneNote))
    if (laneBody) {
      const { envelope } = inspectBody(laneBody, roots)
      check(envelope.context.contentIncluded === false, `${locale}：勾了但没带上，contentIncluded 必须是 false`)
    } else check(false, `${locale}：接收端没有收到对话那一份`)

    // ── ③ 超限 ────────────────────────────────────────────────────────────────
    // 上一张卡还在「留一会儿再收」：这时打开的新卡不能被它的定时器关掉。
    await openCard(win, { surface: 'import', summary: summaries.import, errorKind: 'asset-import-unsupported' })
    await expectVisible(phase('idle'), '新卡应当打开')
    await win.waitForTimeout(3_000)
    await expectVisible(phase('idle'), '上一张卡的定时器不该把新卡关掉')
    intake.state.mode = '413-once'
    const trimmedNote = `walk-note-413-${locale}`
    await note.fill(trimmedNote)
    await clickOrFail(send, '在 413 那张卡上点「发送」')
    await expectVisible(receipt, '413 之后应当拿到编号')
    await expectVisible(win.locator('[data-feedback-trimmed]').first(), '界面应当说明有东西没带上')
    check(await textOf(win.locator('[data-feedback-trimmed]').first()) === t.trimmedNote, `${locale}：超限提示文案不对`)
    check(/NF-\d{4}-\d{4}/.test(await textOf(receipt)), `${locale}：413 之后也要给编号`)
    await checkReceiptRow('超限的回执')
    await shot('sent-trimmed')
    const sentTrimmed = intake.state.attempts.filter((attempt) => attempt.body.includes(trimmedNote))
    check(sentTrimmed.length === 2 && sentTrimmed[0].mode === '413-once', `${locale}：应当正好发两次（第一次 413），实际 ${sentTrimmed.length} 次`)
    const smaller = sentTrimmed.at(-1) ? JSON.parse(sentTrimmed.at(-1).body) : null
    check(smaller && Object.keys(smaller.attachments).length === 0, `${locale}：第二次应当去掉附件`)
    check(smaller?.context.summary === summaries.import && smaller?.context.note === trimmedNote, `${locale}：摘要和留言必须还在`)
    check(smaller?.manifest.excluded.some((item) => item.what === ITEMS.logTail && item.why === 'report-size-limit'), `${locale}：清单应当写明日志是因为超限没带上`)
    await expectHidden(card, '回执留一会儿之后窗口自己收起')

    // ── ④ 断线：不等满时间 ────────────────────────────────────────────────────
    intake.state.mode = 'reset'
    await openCard(win, { surface: 'import', summary: summaries.import })
    await expectVisible(phase('idle'), '断线那张卡应当打开')
    const resetNote = `walk-note-reset-${locale}`
    await note.fill(resetNote)
    const resetClicked = performance.now()
    await clickOrFail(send, '断线时点「发送」')
    await expectVisible(phase('queued'), '断线时应当告诉用户已存本机')
    measure.queuedAfterResetMs = Math.round(performance.now() - resetClicked)
    check(measure.queuedAfterResetMs < 8_000, `${locale}：断线不该等满 8 秒，实际 ${measure.queuedAfterResetMs}ms`)
    check(await textOf(receipt) === t.queued, `${locale}：排队文案不对：${await textOf(receipt)}`)
    check(queueText().includes(resetNote), `${locale}：断线时这份必须已经在本机队列里`)
    await checkReceiptRow('排队的回执')
    await shot('queued-disconnected')
    await expectHidden(card, '排队的提示留一会儿之后窗口自己收起')
    intake.state.mode = 'ok'
    await arrived(resetNote)
    await queueDrained(resetNote)
    measure.resetDeliveredAfterMs = Math.round(performance.now() - resetClicked)

    // ── ④ 接收端不回答：最多等 8 秒 ───────────────────────────────────────────
    intake.state.mode = 'hang'
    await openCard(win, { surface: 'import', summary: summaries.import })
    await expectVisible(phase('idle'), '不回答那张卡应当打开')
    const hangNote = `walk-note-hang-${locale}`
    await note.fill(hangNote)
    const hangClicked = performance.now()
    await clickOrFail(send, '接收端不回答时点「发送」')
    await expectVisible(phase('sending'), '等回答时应当显示正在发送')
    check((await textOf(send)) === t.sending, `${locale}：发送中的文案不对`)
    check(await send.isDisabled(), `${locale}：发送中按钮要禁用，防连点`)
    await shot('sending')
    await expectVisible(phase('queued'), '等不到回答时应当告诉用户已存本机')
    measure.queuedAfterHangMs = Math.round(performance.now() - hangClicked)
    check(measure.queuedAfterHangMs < 13_000, `${locale}：界面最多等 8 秒网络再加组包，实际 ${measure.queuedAfterHangMs}ms`)
    check(queueText().includes(hangNote), `${locale}：等不到回答时这份必须已经在本机队列里`)
    await shot('queued-no-answer')
    await expectHidden(card, '排队的提示留一会儿之后窗口自己收起')
    intake.state.mode = 'ok'
    await arrived(hangNote)
    await queueDrained(hangNote)
    measure.hangDeliveredAfterMs = Math.round(performance.now() - hangClicked)
    const hangAttempts = intake.state.attempts.filter((attempt) => attempt.body.includes(hangNote))
    check(hangAttempts.length === 2, `${locale}：同一份应当正好发两次（挂住的 + 重试），实际 ${hangAttempts.length} 次`)

    // ── ⑤ 存不下来也发不出去 ──────────────────────────────────────────────────
    fs.rmSync(queueFile, { recursive: true, force: true })
    fs.mkdirSync(queueFile)
    intake.state.mode = 'reset'
    await openCard(win, { surface: 'import', summary: summaries.import })
    await expectVisible(phase('idle'), '双重故障那张卡应当打开')
    const lostNote = `walk-note-lost-${locale}`
    await note.fill(lostNote)
    await clickOrFail(send, '存不下来也发不出去时点「发送」')
    await expectVisible(phase('failed'), '存不下来也发不出去时应当说没能确认')
    check(await textOf(card.locator('[data-feedback-error]').first()) === t.failed, `${locale}：失败文案不对`)
    check(await note.inputValue() === lostNote, `${locale}：留言必须还在`)
    check(!(await send.isDisabled()), `${locale}：按钮必须能再点`)
    await shot('failed')
    fs.rmSync(queueFile, { recursive: true, force: true })
    intake.state.mode = 'ok'
    await clickOrFail(send, '恢复后再点一次「发送」')
    await expectVisible(receipt, '再点一次应当成功')
    check(intake.state.accepted.some((body) => body.includes(lostNote)), `${locale}：再点一次之后接收端应当收到`)
    await expectHidden(card, '回执留一会儿之后窗口自己收起')

    // ── ⑥ 排着队就关掉 App ────────────────────────────────────────────────────
    intake.state.mode = 'reset'
    await openCard(win, { surface: 'import', summary: summaries.import })
    await expectVisible(phase('idle'), '重开那张卡应当打开')
    const reopenNote = `walk-note-reopen-${locale}`
    await note.fill(reopenNote)
    await clickOrFail(send, '断线时点「发送」，接着关掉 App')
    await expectVisible(phase('queued'), '断线时应当告诉用户已存本机')
    check(queueText().includes(reopenNote), `${locale}：关 App 之前这份必须已经在本机队列里`)
    // app.close 而不是 instance.close：后者连临时目录一起删，队列也就没了。
    await app.close()
    intake.state.mode = 'ok'
    const reopenedAt = performance.now()
    const reopened = await launch(`feedback-delivery-reopen-${locale}`, locale, tempRoot, endpointEnv)
    try {
      await arrived(reopenNote)
      await queueDrained(reopenNote)
      measure.reopenDeliveredAfterMs = Math.round(performance.now() - reopenedAt)
      check(intake.state.accepted.filter((body) => body.includes(reopenNote)).length === 1, `${locale}：重开后应当只送达一份`)
    } finally {
      await reopened.close().catch(() => undefined)
    }

    measure.accepted = intake.state.accepted.length
    measure.attempts = intake.state.attempts.length

    // 接收端收到的每一份都扫一遍：后面几份的尾巴里有这一轮真日志写手写的行（发送失败的记录、错误栈）。
    const scans = intake.state.attempts.map(({ body }) => inspectBody(body, roots))
    measure.scan = {
      bodies: scans.length,
      bytes: intake.state.attempts.reduce((sum, { body }) => sum + Buffer.byteLength(body, 'utf8'), 0),
      needleHits: scans.flatMap((scan) => scan.needleHits).length,
      pathHits: scans.flatMap((scan) => scan.pathHits).length,
    }
    check(measure.scan.needleHits === 0, `${locale}：有一份包里有不该出门的东西：${[...new Set(scans.flatMap((scan) => scan.needleHits))].join('、')}`)
    check(measure.scan.pathHits === 0, `${locale}：有一份包里有本机路径：${measure.scan.pathHits} 处`)
    const lastTail = scans.map((scan) => scan.tail).filter(Array.isArray).at(-1) ?? []
    const realLines = lastTail.filter((line) => !line.startsWith(`[${seededAt}]`))
    measure.realLoggerLines = realLines.length
    check(realLines.some((line) => line.includes('intake-send-failed')), `${locale}：这一轮真日志写手写的发送失败记录应当在尾巴里`)
    if (locale === 'zh-CN') fs.writeFileSync(path.join(shotsDir, 'log-tail-sample.txt'), `${lastTail.join('\n')}\n`)
  } finally {
    await instance.close().catch(() => undefined)
    intake.close()
  }

  // ── ⑦ 这个构建没配接收端 ────────────────────────────────────────────────────
  const bareRoot = makeTempDir(`nomi-feedback-delivery-bare-${locale}-`)
  const bare = await launch(`feedback-delivery-bare-${locale}`, locale, bareRoot, { NOMI_INTAKE_ENDPOINT: '', NOMI_INTAKE_TOKEN: '' })
  try {
    await openCard(bare.win, { surface: 'import', summary: summaries.import })
    const bareCard = bare.win.locator('[data-feedback-card]').first()
    await expectVisible(bareCard, '没配接收端时卡也要能打开')
    await clickOrFail(bareCard.locator('[data-feedback-send]').first(), '没配接收端时点「发送」')
    await expectVisible(bare.win.locator('[data-feedback-card][data-feedback-phase="unconfigured"]').first(), '没配接收端时应当说清楚')
    check(await textOf(bareCard.locator('[data-feedback-error]').first()) === t.unconfigured, `${locale}：没配接收端的文案不对`)
    await screenshotSettled(bare.win, { path: path.join(shotsDir, `${locale}-${String(shotNumber + 1).padStart(2, '0')}-unconfigured.png`) })
  } finally {
    await bare.close().catch(() => undefined)
  }
  return measure
}

const measures = []
try {
  for (const locale of ['zh-CN', 'en']) {
    console.log(`== ${locale}`)
    measures.push(await journey(locale))
  }
  fs.writeFileSync(path.join(shotsDir, 'measure.json'), `${JSON.stringify({ failures, measures }, null, 2)}\n`)
  if (failures.length) throw new Error(failures.join('\n'))
  console.log(`PASS: feedback delivery walk → ${path.relative(repoRoot, shotsDir)}`)
  console.log(JSON.stringify(measures))
} catch (error) {
  console.error(`FEEDBACK DELIVERY WALK FAIL: ${error?.stack || error}`)
  fs.writeFileSync(path.join(shotsDir, 'measure.json'), `${JSON.stringify({ failures, measures, error: String(error?.message ?? error) }, null, 2)}\n`)
  process.exitCode = 1
}
