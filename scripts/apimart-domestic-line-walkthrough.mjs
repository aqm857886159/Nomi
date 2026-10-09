import { makeTempDir } from './_test-temp.mjs'
// R13 真机走查 · 设置页亲手改 APIMart 接口地址（2026-09-29 用户反馈：新电脑上改成国内地址，保存报
// 「Certification-owned connection changes require a new integration session」；主域不翻墙用不了）。
//
// 零额度、零真 key：主进程出站全部经 scripts/apimart-line-netsim.cjs——api.apimart.ai 像被墙一样连接
// 超时，国内线路 api.apib.ai 由一个 APIMart 形状的假服务应答，其余域名一律「DNS 查不到」。
// 每一次出站都记账，走查按账本核对「请求到底发去了哪台主机」。临时资料目录，从不碰用户真实的 %APPDATA%\Nomi。
//
// 六个场景（编号与测试表 D:\tmp\apimart-endpoint-test\测试表.md 一一对应）：
//   new-zh        新装机·中文：接入页上改地址 → 保存验证 → 重开还在 → 画布生成发往国内域 → Agent 生成一次（对照组）
//                 → 写错地址的两种提示；外加连接卡的体检结论（照真实 APIMart 应答，应是「已连通」）
//   keyfirst-zh   新装机·中文：先填 key（主域被墙 → 已保存·未验证）→ 再改地址 → 重新保存验证 → 接上
//   trap-zh       新装机·中文：点过「继续验证 → 自检」的连接（报错用户的真实状态）→ 改地址能存 → 画布生成
//                 → Agent 生成（结构修复后应直接通过）→ 对照：只删掉自检加的那个模型，Agent 再生成
//   old-zh        老装机升级·中文：APIMart 早已接好（官方默认地址 + 占位 key）→ 改地址 → 重开还在 → 生成发往国内域
//   new-en        新装机·英文界面：同 new-zh 的地址/验证/生成几步，外加「A APIMart key」那句语法（旧问题）
//   old-en        老装机升级·英文界面：同 old-zh，外加写错提示②（域名拼错）
//
// 用法：pnpm build 后  node scripts/apimart-domestic-line-walkthrough.mjs [--packaged <Nomi.exe>] [场景…]
//       --packaged 指向打好的安装包里的 Nomi 可执行文件：整套走查改在那个包上跑（网络模拟照样在主入口前装上）；
//       截图目录可用 NOMI_WALK_OUT 指定（默认仓库根 .apimart-line-walk/）；
//       NOMI_WALK_OLD_CATALOG 指向一份老版本写下的 model-catalog.json 时，老装机场景从它起步。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchNomiApp } from '../tests/ux/_launchApp.mjs'
import { APPROVAL_CARD, CANVAS_PANEL, INTERVENTION_CONFIRM, chooseAssistantModel, closeSpendCard, expandResidentPanel, sendCanvas } from '../tests/ux/agent-runtime-walk-support.mjs'
import {
  DOMESTIC, NETSIM, PRIMARY, UI, cancelAddressEdit, closeSettings, generateOnce, healthSettled, modelsSectionText, netLog, openModels,
  repoRoot, saveAddress, takePackagedFlag, until,
} from './apimart-line-walk-steps.mjs'

const outRoot = path.resolve(process.env.NOMI_WALK_OUT || path.join(repoRoot, '.apimart-line-walk'))
const argv = process.argv.slice(2)
/** 被测的打包产物（空串 = 仓库里刚 build 的开发构建）。 */
const PACKAGED = takePackagedFlag(argv)
const build = { packaged: PACKAGED || null, version: null }
const IMAGE = path.join(repoRoot, 'tests', 'ux', 'fixtures', 'hires-detail-1024x1792.png')
const FIXTURE_KEY = 'sk-walkthrough-placeholder-not-a-real-key'
/** Agent 那一步用的对话模型：APIMart 自己的文本模型（走同一条线路、同一把 key）。 */
const AGENT_TEXT_MODEL = 'DeepSeek V4 Flash'
/** 连接卡体检「没有清单接口」时的那句（真实 APIMart 两条线路都有清单接口，出现它就说明体检没走通）。 */
const NO_PROBE_NOTICE = '这家没有可预检的接口，第一次生成时才知道通不通'

const OLD_ERROR = /Certification-owned connection changes require a new integration session/

const results = []
/** 每个场景的临时资料目录；跑完一并删掉（里面只有占位 key，也不留）。 */
const profileRoots = new Set()
/**
 * `knownGap`：这次改动之外的旧问题，照实记成「没通过」、单独列出，但不算本次改动的失败
 * （不许把它记成通过，也不许让它把本次改动的判据淹掉）。
 */
function record(id, ok, detail, shots = [], { knownGap = false } = {}) {
  results.push({ id, ok, detail, shots, ...(knownGap ? { knownGap } : {}) })
  console.log(`  ${ok ? '✓' : knownGap ? '△' : '✗'} ${id} ${detail}${shots.length ? `  [${shots.join(', ')}]` : ''}`)
}

function readCatalog(settingsDir) {
  return JSON.parse(fs.readFileSync(path.join(settingsDir, 'model-catalog.json'), 'utf8'))
}
const apimartRow = (settingsDir) => readCatalog(settingsDir).vendors.find((vendor) => vendor.key === 'apimart')

/** 一个场景一份临时资料目录；同一场景的多次启动共用它（「重开 App」就是重启同一份资料）。 */
function profile(name) {
  const root = makeTempDir(`nomi-apimart-line-${name}-`)
  profileRoots.add(root)
  const out = path.join(outRoot, name)
  fs.rmSync(out, { recursive: true, force: true })
  fs.mkdirSync(out, { recursive: true })
  return {
    name, root, out,
    settingsDir: path.join(root, 'settings'),
    projectsDir: path.join(root, 'projects'),
    userDataDir: path.join(root, 'user-data'),
    netLog: path.join(out, 'network.jsonl'),
  }
}

const simulatorLoads = (p) => netLog(p.netLog).filter((entry) => entry.kind === 'netsim-loaded').length

async function launch(p, { locale = 'zh-CN', blocked = 'api.apimart.ai', mocked = 'api.apib.ai,apib.ai', netsim = {} } = {}) {
  const loadsBefore = simulatorLoads(p)
  const launched = await launchNomiApp({
    name: `apimart-line-${p.name}`,
    tempRoot: p.root,
    settingsDir: p.settingsDir,
    projectsDir: p.projectsDir,
    userDataDir: p.userDataDir,
    ...(PACKAGED ? { executablePath: PACKAGED } : {}),
    mainRequire: [NETSIM],
    initialLocalStorage: { 'nomi:locale:v1': locale },
    env: {
      NOMI_NETSIM_LOG: p.netLog,
      NOMI_NETSIM_IMAGE: IMAGE,
      NOMI_NETSIM_BLOCKED: blocked,
      NOMI_NETSIM_MOCK: mocked,
      NOMI_NETSIM_AGENT: '1',
      ...netsim,
      // 打包产物带着自己的渲染层；开发构建才指到仓库 dist/。
      ...(PACKAGED ? {} : { NOMI_RENDERER_URL: `file://${path.join(repoRoot, 'dist', 'index.html')}` }),
    },
    settleMs: 2500,
  })
  build.version ??= await launched.app.evaluate(({ app }) => app.getVersion())
  if (simulatorLoads(p) <= loadsBefore) {
    await launched.app.close().catch(() => undefined)
    throw new Error('network simulator was not loaded before the app started — refusing to run against the real network')
  }
  return launched
}

async function shot(win, p, name) {
  await win.screenshot({ path: path.join(p.out, name) })
  return path.join(p.out, name)
}

async function addressShown(win) {
  return (await modelsSectionText(win)).includes(DOMESTIC)
}

async function saveKeyOnConnectPage(win, t) {
  await win.locator('#key-only-apimart').fill(FIXTURE_KEY)
  await win.getByRole('button', { name: t.saveVerify, exact: true }).click()
  await win.locator('[data-key-only-success]').waitFor({ timeout: 30_000 })
}

/**
 * Agent 用 APIMart 生成一次（大脑是 netsim 里照剧本回话的假模型，NOMI_NETSIM_AGENT=1）：
 * 对话模型选 APIMart 的文本模型 → 说一句 → Agent 建草稿 → 调 generate → 面板出报价卡 → 点主按钮。
 * 返回用户看到了什么（截图）、生成请求发去了哪、宿主回给 Agent 的那句话。
 */
async function agentGenerateOnce(win, p, prefix) {
  await expandResidentPanel(win)
  await chooseAssistantModel(win, AGENT_TEXT_MODEL, CANVAS_PANEL)
  const mark = netLog(p.netLog).length
  const brainSaid = (reply) => netLog(p.netLog).slice(mark).find((entry) => entry.kind === 'agent-brain' && entry.reply === reply)
  // 「图落到了节点上」= 出现了一个之前没有图的节点，里面有一张真解码出来的图（画布只渲染屏上的节点，所以按节点身份比，不按张数比）。
  const imageNodes = () => win.evaluate(() => [...document.querySelectorAll('[data-node-id]')]
    .filter((node) => [...node.querySelectorAll('img')].some((img) => img.complete && img.naturalWidth > 200))
    .map((node) => node.getAttribute('data-node-id')))
  const hadImage = new Set(await imageNodes())
  const landed = async () => (await imageNodes()).some((id) => !hadImage.has(id))
  // 宿主拒绝确认时渲染层只弹一句 toast，原话进控制台（spend-confirm-refused）；两样都留下来当证据。
  const consoleNotes = []
  const onConsole = (message) => {
    const text = message.text()
    if (/spend|refus|certif|provider/i.test(text)) consoleNotes.push(`[${message.type()}] ${text}`.slice(0, 600))
  }
  win.on('console', onConsole)
  await sendCanvas(win, 'WALK_AGENT 帮我画一只坐在窗台上的橘猫')
  const card = win.locator(`${CANVAS_PANEL} ${APPROVAL_CARD}[data-kind="spend"]`)
  // 被拒时 generate 可能根本不出卡、直接把拒绝交回 Agent；两种结局都要等得到。
  await until(win, async () => await card.isVisible().catch(() => false) || brainSaid('WALK_AGENT_DONE') || brainSaid('WALK_AGENT_DRAFT_FAILED'))
  const shots = []
  let confirmed = false
  if (await card.isVisible().catch(() => false)) {
    shots.push(await shot(win, p, `${prefix}-01-agent-spend-card.png`))
    await card.locator(INTERVENTION_CONFIRM).first().click()
    confirmed = true
    // 按下之后两秒：宿主若拒绝，这一刻屏上正好是那句 toast。
    await win.waitForTimeout(2000)
    shots.push(await shot(win, p, `${prefix}-02-agent-just-after-confirm.png`))
  }
  const submitted = () => hostsHit(p, mark).find((entry) => entry.method === 'POST' && entry.url.endsWith('/v1/images/generations'))
  const refused = () => consoleNotes.find((note) => note.includes('spend-confirm-refused'))
  await until(win, async () => brainSaid('WALK_AGENT_DONE') || brainSaid('WALK_AGENT_DRAFT_FAILED') || refused())
  const done = brainSaid('WALK_AGENT_DONE') || brainSaid('WALK_AGENT_DRAFT_FAILED')
  if (submitted()) {
    // 新节点落在视野外时画布只给一颗「新节点在下方」的小钮（节点不在屏上就不渲染）——像用户一样点它过去看。
    const offscreen = win.getByText(/新节点在(下方|上方|左侧|右侧)/).first()
    await until(win, async () => await landed() || await offscreen.isVisible().catch(() => false), 60_000)
    if (await offscreen.isVisible().catch(() => false)) await offscreen.click()
    await until(win, landed, 60_000)
  }
  await win.waitForTimeout(1200)
  shots.push(await shot(win, p, `${prefix}-03-agent-outcome.png`))
  win.off('console', onConsole)
  const panelText = (await win.locator(CANVAS_PANEL).innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
  const traffic = hostsHit(p, mark).filter((entry) => entry.kind !== 'agent-brain')
  fs.writeFileSync(path.join(p.out, `${prefix}-agent-network.json`), JSON.stringify(netLog(p.netLog).slice(mark), null, 2))
  fs.writeFileSync(path.join(p.out, `${prefix}-agent-console.txt`), consoleNotes.join('\n'))
  return {
    shots, confirmed, panelText, consoleNotes,
    submit: submitted()?.url ?? null,
    primaryTouched: traffic.some((entry) => String(entry.url).startsWith(PRIMARY)),
    imageLanded: await landed(),
    hostToldAgent: done ? String(done.detail ?? '') : '（Agent 这一轮没收尾：generate 还挂在那张卡上）',
    hostRefusal: refused() ?? '',
  }
}

function hostsHit(p, since = 0) {
  return netLog(p.netLog).slice(since).filter((entry) => entry.kind !== 'netsim-loaded' && !String(entry.url).includes('raw.githubusercontent'))
}

// ── 新装机 · 中文 ──────────────────────────────────────────────────────────────────
async function newInstall(locale, name) {
  const t = UI[locale]
  const p = profile(name)
  let { app, win } = await launch(p, { locale })
  try {
    await openModels(win, t)
    await win.locator('[data-model-home-available="apimart"]').click()
    await win.waitForSelector('[data-key-only-vendor="apimart"]')
    const before = await shot(win, p, '01-connect-page-address-row.png')
    record(`${name}/地址行在接入页上`, (await win.locator('[data-key-only-vendor="apimart"]').innerText()).includes(PRIMARY), `接入页显示默认地址 ${PRIMARY} 与「修改」`, [before])

    const malformed = await saveAddress(win, t, 'apib.ai/v1')
    const malformedShot = await shot(win, p, '02-malformed-address.png')
    record(`${name}/写错地址①少了https`, malformed.includes(t.invalidAddress) && apimartRow(p.settingsDir).baseUrlHint === PRIMARY,
      `提示「${t.invalidAddress}」，地址没被改`, [malformedShot])
    await cancelAddressEdit(win)

    const error = await saveAddress(win, t, DOMESTIC)
    const savedShot = await shot(win, p, '03-domestic-address-saved.png')
    record(`${name}/改成国内地址保存`, !error && apimartRow(p.settingsDir).baseUrlHint === DOMESTIC && !OLD_ERROR.test(error),
      `地址行显示 ${DOMESTIC}，没有报错`, [savedShot])

    await saveKeyOnConnectPage(win, t)
    const keyShot = await shot(win, p, '04-key-saved-published.png')
    const probe = hostsHit(p).find((entry) => entry.url.endsWith('/v1/balance'))
    record(`${name}/保存验证走国内线路`, probe?.url === `${DOMESTIC}/v1/balance` && apimartRow(p.settingsDir).enabled === true,
      `验证请求 → ${probe?.url ?? '（没有）'}；APIMart 已接入`, [keyShot])
    if (locale === 'en') {
      const connectText = await win.locator('[data-key-only-vendor="apimart"]').innerText()
      record(`${name}/英文句子「A APIMart key」`, !connectText.includes('A APIMart key'),
        '接入页写「A APIMart key is stored on this machine.」，应为「An APIMart key…」——旧问题（0.22.4 就是这句），本次未改', [keyShot], { knownGap: true })
    }

    await app.close()
    ;({ app, win } = await launch(p, { locale }))
    await openModels(win, t)
    await win.locator('[data-model-home-connection="apimart"]').click()
    await healthSettled(win)
    const reopened = await shot(win, p, '05-reopened-address-kept.png')
    record(`${name}/重开App地址还在`, await addressShown(win) && apimartRow(p.settingsDir).baseUrlHint === DOMESTIC,
      `重开后地址仍是 ${DOMESTIC}`, [reopened])
    if (locale === 'zh-CN') {
      // 体检结论：模拟服务照真实 APIMart 应答（/v1/models 带合法 key 回 200——2026-09-29 真实调用实测国内线路同样如此）。
      const card = await modelsSectionText(win)
      record(`${name}/国内线路上连接卡的体检结论`, card.includes('已连通') && !card.includes(NO_PROBE_NOTICE),
        card.includes('已连通') ? '卡片右上角「已连通」，没有「没有可预检的接口」那句' : `卡片体检结论不对：${card.split('\n').slice(0, 8).join(' | ')}`, [reopened])
    }

    await closeSettings(win)
    const mark = netLog(p.netLog).length
    await generateOnce(win, t)
    const generated = await shot(win, p, '06-generated-via-domestic.png')
    const traffic = hostsHit(p, mark)
    const submit = traffic.find((entry) => entry.method === 'POST' && entry.url.endsWith('/v1/images/generations'))
    const primaryTouched = traffic.some((entry) => entry.url.startsWith(PRIMARY))
    record(`${name}/生成请求发往新地址`, submit?.url === `${DOMESTIC}/v1/images/generations` && !primaryTouched,
      `提交 → ${submit?.url ?? '（没有）'}；轮询/取图 ${traffic.filter((e) => e.url.startsWith(DOMESTIC)).length} 次都在国内域；主域 0 次`, [generated])
    fs.writeFileSync(path.join(p.out, '06-network.json'), JSON.stringify(traffic, null, 2))
    if (locale === 'zh-CN') {
      // 对照组：没点过「自检」的正常连接，Agent 用 APIMart 生成一次应当走得通（与 trap-zh 那一条对比）。
      const agent = await agentGenerateOnce(win, p, '08')
      record(`${name}/Agent用APIMart生成一次（对照）`, agent.confirmed && agent.submit === `${DOMESTIC}/v1/images/generations` && !agent.primaryTouched && agent.imageLanded,
        `报价卡${agent.confirmed ? '出现并点了生成' : '没出现'}；提交 → ${agent.submit ?? '（没有）'}；图${agent.imageLanded ? '落到了节点上' : '没落到节点上'}；主域 ${agent.primaryTouched ? '被碰了' : '0 次'}`, agent.shots)
    }
    return p
  } finally {
    await app.close().catch(() => undefined)
  }
}

/** 写错地址②：域名拼错。格式合法所以能存，已接入卡片上的连接状态要说人话（这里的截图就是证据）。 */
async function typoHost(p, locale) {
  const t = UI[locale]
  const { app, win } = await launch(p, { locale })
  try {
    await openModels(win, t)
    await win.locator('[data-model-home-connection="apimart"]').click()
    await saveAddress(win, t, 'https://api.apib.ai.cn')
    const notice = win.locator('[data-settings-section="models"]').getByText(t.unreachable)
    await notice.first().waitFor({ timeout: 20_000 })
    const text = (await notice.first().innerText()).trim()
    const typoShot = await shot(win, p, '07-typo-host-notice.png')
    const englishLeak = locale === 'zh-CN' && /Network error|Next: check/.test(text)
    record(`${p.name}/写错地址②域名拼错`, text.includes(t.nextStep) && !englishLeak, `连接状态：${text}`, [typoShot])
    if (locale !== 'zh-CN') {
      // 原因那半句来自 systemProxy.describeNetworkError，它只有中文（渲染层还按这些中文子串给错误分类），
      // 不是这次改动引入的；英文界面上照实记一条没通过。
      record(`${p.name}/英文界面的原因句`, !/[一-鿿]/.test(text), '原因句（DNS 解析失败…）仍是中文——旧问题，本次未改', [typoShot], { knownGap: true })
    }
    await saveAddress(win, t, DOMESTIC)
  } finally {
    await app.close().catch(() => undefined)
  }
}

// ── 新装机 · 先填 key 再改地址（主域被墙的用户最可能的顺序）──────────────────────
async function keyFirst() {
  const t = UI['zh-CN']
  const p = profile('keyfirst-zh')
  const { app, win } = await launch(p)
  try {
    await openModels(win, t)
    await win.locator('[data-model-home-available="apimart"]').click()
    await saveKeyOnConnectPage(win, t)
    const pendingShot = await shot(win, p, '01-key-pending.png')
    const pending = readCatalog(p.settingsDir).apiKeysByVendor.apimart
    record('keyfirst-zh/主域被墙时key存成未验证', pending?.verificationPending === true && apimartRow(p.settingsDir).enabled === false,
      '显示「已保存 · 未验证」，APIMart 还没接上（验证请求只发去了被墙的主域）', [pendingShot])
    await win.getByRole('button', { name: t.back }).first().click()
    await win.locator('[data-model-home-available="apimart"]').click()
    await saveAddress(win, t, DOMESTIC)
    await saveKeyOnConnectPage(win, t)
    const doneShot = await shot(win, p, '02-address-then-key-published.png')
    const lastProbe = hostsHit(p).filter((entry) => entry.url.endsWith('/v1/balance')).at(-1)
    record('keyfirst-zh/改地址后重新保存验证', lastProbe?.url === `${DOMESTIC}/v1/balance` && apimartRow(p.settingsDir).enabled === true,
      `第二次验证 → ${lastProbe?.url ?? '（没有）'}；APIMart 接上了`, [doneShot])
  } finally {
    await app.close().catch(() => undefined)
  }
}

// ── 新装机 · 点过「继续验证 → 自检」的连接（报错用户电脑上的真实状态）─────────────
async function selfCheckTrap() {
  const t = UI['zh-CN']
  const p = profile('trap-zh')
  const launched = await launch(p)
  const { app, win } = launched
  try {
    await openModels(win, t)
    await win.locator('[data-model-home-available="apimart"]').click()
    await saveKeyOnConnectPage(win, t)
    await win.getByRole('button', { name: /继续验证/ }).first().click()
    const manual = win.getByPlaceholder('没列出来的，输入模型 id 回车添加')
    await manual.fill('gpt-image-1')
    await manual.press('Enter')
    await win.getByRole('button', { name: /自检 1 个/ }).click()
    await win.getByText('自检没有通过').first().waitFor({ timeout: 30_000 })
    const marked = readCatalog(p.settingsDir).models.some((model) => model.vendorKey === 'apimart' && model.meta && 'adapter' in model.meta)
    for (let i = 0; i < 4 && await win.locator('[data-model-home-connection="apimart"]').count() === 0; i += 1) {
      await win.getByRole('button', { name: t.back }).first().click()
    }
    await win.locator('[data-model-home-connection="apimart"]').click()
    const error = await saveAddress(win, t, DOMESTIC)
    const trapShot = await shot(win, p, '01-self-checked-connection-address-saved.png')
    record('trap-zh/自检过的连接也能改地址', marked && !error && apimartRow(p.settingsDir).baseUrlHint === DOMESTIC,
      `连接带着自检标记（修之前这里报 Certification-owned…）；现在保存成功：${apimartRow(p.settingsDir).baseUrlHint}`, [trapShot])

    // 改完地址之后，这位用户真正要做的两件事：画布上生成一张、让 Agent 生成一张。
    await closeSettings(win)
    const mark = netLog(p.netLog).length
    let canvasError = ''
    try { await generateOnce(win, t) } catch (error) { canvasError = String(error?.message || error).split('\n')[0].slice(0, 200) }
    const canvasShot = await shot(win, p, '02-canvas-generated-via-domestic.png')
    const traffic = hostsHit(p, mark)
    const submit = traffic.find((entry) => entry.method === 'POST' && entry.url.endsWith('/v1/images/generations'))
    record('trap-zh/改完地址画布生成走国内', !canvasError && submit?.url === `${DOMESTIC}/v1/images/generations` && !traffic.some((entry) => entry.url.startsWith(PRIMARY)),
      `提交 → ${submit?.url ?? '（没有）'}；主域 ${traffic.filter((entry) => entry.url.startsWith(PRIMARY)).length} 次；${canvasError ? `没出图：${canvasError}` : '图落到了节点上'}`, [canvasShot])
    fs.writeFileSync(path.join(p.out, '02-network.json'), JSON.stringify(traffic, null, 2))

    const agent = await agentGenerateOnce(win, p, '03')
    const agentOk = agent.confirmed && agent.submit === `${DOMESTIC}/v1/images/generations` && !agent.primaryTouched && agent.imageLanded
    // 2026-09-29 结构修复之后这一条应当直接通过（「这条连接归不归认证管」只剩一份判据，
    // 用户自己加的自检模型只管它自己）；拒了就是本次改动没做到，照实记成没通过。
    record('trap-zh/改完地址Agent生成一次', agentOk,
      agentOk ? `报价卡出现并点了生成；提交 → ${agent.submit}；图落到了节点上；主域 0 次`
        : `报价卡${agent.confirmed ? '出现并点了生成' : '没出现'}；提交 → ${agent.submit ?? '（没有）'}；`
          + `宿主的拒绝（控制台原话）：${agent.hostRefusal.slice(0, 300) || '（没有）'}；${agent.hostToldAgent.slice(0, 200)}`,
      agent.shots)
    fs.writeFileSync(path.join(p.out, '03-main-log.txt'), launched.mainLogTail()
      .filter((line) => /apimart|certif|refus|provider|spend|generation/i.test(line)).join('\n'))

    // 对照（回归）：只删掉「自检」加进来的那个模型，别的都不动，Agent 再来一次——删模型这条路
    // （修复前教给这类用户的绕法）不许被修坏。
    const pendingCard = win.locator(`${CANVAS_PANEL} ${APPROVAL_CARD}[data-kind="spend"]`)
    if (await pendingCard.isVisible().catch(() => false)) await closeSpendCard(pendingCard)
    await openModels(win, t)
    await win.locator('[data-model-home-connection="apimart"]').click()
    await win.getByRole('button', { name: 'gpt-image-1', exact: true }).click()
    await win.getByText('更多操作', { exact: true }).click()
    await win.getByRole('button', { name: '删除模型', exact: true }).click()
    const confirmDelete = win.getByRole('dialog').getByRole('button', { name: '删除', exact: true })
    if (await confirmDelete.count()) await confirmDelete.last().click()
    const unmarked = await until(win, async () => !readCatalog(p.settingsDir).models.some((model) => model.vendorKey === 'apimart' && model.meta && 'adapter' in model.meta), 15_000)
    const deletedShot = await shot(win, p, '04-self-check-model-deleted.png')
    await closeSettings(win)
    const again = await agentGenerateOnce(win, p, '05')
    record('trap-zh/删掉自检加的模型后Agent再生成（对照）',
      Boolean(unmarked) && again.confirmed && again.submit === `${DOMESTIC}/v1/images/generations` && !again.primaryTouched && again.imageLanded,
      `自检标记${unmarked ? '已随模型删掉' : '没删掉'}；报价卡${again.confirmed ? '出现并点了生成' : '没出现'}；提交 → ${again.submit ?? '（没有）'}；图${again.imageLanded ? '落到了节点上' : '没落到节点上'}`,
      [deletedShot, ...again.shots])
  } finally {
    await app.close().catch(() => undefined)
  }
}

// ── 老装机升级 ──────────────────────────────────────────────────────────────────────
/** 造一份「老电脑」资料：主域能通的时候接好的 APIMart（官方默认地址 + 占位 key）。 */
async function buildOldProfile(name, locale) {
  // 界面语言是这份资料自己的偏好（localStorage），造资料时就定下来——之后的启动不会覆盖它。
  const t = UI[locale]
  const p = profile(name)
  // 老版本写下的目录（例如 0.22.4 形状的 model-catalog.json）：给了就先放进资料目录，新版本启动时照常升级它。
  const oldCatalog = process.env.NOMI_WALK_OLD_CATALOG
  if (oldCatalog) {
    fs.mkdirSync(p.settingsDir, { recursive: true })
    fs.copyFileSync(oldCatalog, path.join(p.settingsDir, 'model-catalog.json'))
  }
  const { app, win } = await launch(p, { locale, blocked: '', mocked: 'api.apimart.ai,api.apib.ai,apib.ai' })
  try {
    await openModels(win, t)
    await win.locator('[data-model-home-available="apimart"]').click()
    await saveKeyOnConnectPage(win, t)
  } finally {
    await app.close().catch(() => undefined)
  }
  const row = apimartRow(p.settingsDir)
  if (row.baseUrlHint !== PRIMARY || row.enabled !== true || row.credentialBinding?.origin !== PRIMARY) {
    throw new Error(`old profile was not built as an already-connected APIMart: ${JSON.stringify(row)}`)
  }
  fs.writeFileSync(path.join(p.out, '00-old-profile-before.json'), JSON.stringify({ oldCatalog: oldCatalog || null, baseUrlHint: row.baseUrlHint, binding: row.credentialBinding }, null, 2))
  return p
}

async function oldInstall(locale, name) {
  const t = UI[locale]
  const p = await buildOldProfile(name, locale)
  let { app, win } = await launch(p, { locale })
  try {
    await openModels(win, t)
    await win.locator('[data-model-home-connection="apimart"]').click()
    const before = await shot(win, p, '01-connected-card-before.png')
    const error = await saveAddress(win, t, DOMESTIC)
    const after = await shot(win, p, '02-connected-card-address-saved.png')
    record(`${name}/已接入卡片改成国内地址`, !error && apimartRow(p.settingsDir).baseUrlHint === DOMESTIC,
      `地址 ${PRIMARY} → ${DOMESTIC}，没有报错`, [before, after])

    const malformed = await saveAddress(win, t, 'apib.ai/v1')
    const malformedShot = await shot(win, p, '03-malformed-address.png')
    record(`${name}/写错地址①少了https`, malformed.includes(t.invalidAddress) && apimartRow(p.settingsDir).baseUrlHint === DOMESTIC,
      `提示「${t.invalidAddress}」，地址没被改`, [malformedShot])
    await cancelAddressEdit(win)

    await app.close()
    ;({ app, win } = await launch(p, { locale }))
    await openModels(win, t)
    await win.locator('[data-model-home-connection="apimart"]').click()
    const reopened = await shot(win, p, '04-reopened-address-kept.png')
    record(`${name}/重开App地址还在`, await addressShown(win), `重开后地址仍是 ${DOMESTIC}`, [reopened])

    await closeSettings(win)
    const mark = netLog(p.netLog).length
    await generateOnce(win, t)
    const generated = await shot(win, p, '05-generated-via-domestic.png')
    const traffic = hostsHit(p, mark)
    const submit = traffic.find((entry) => entry.method === 'POST' && entry.url.endsWith('/v1/images/generations'))
    record(`${name}/生成请求发往新地址`, submit?.url === `${DOMESTIC}/v1/images/generations` && !traffic.some((entry) => entry.url.startsWith(PRIMARY)),
      `提交 → ${submit?.url ?? '（没有）'}；主域 0 次`, [generated])
    fs.writeFileSync(path.join(p.out, '05-network.json'), JSON.stringify(traffic, null, 2))
    return p
  } finally {
    await app.close().catch(() => undefined)
  }
}

const SCENARIOS = {
  'new-zh': async () => { const p = await newInstall('zh-CN', 'new-zh'); await typoHost(p, 'zh-CN') },
  'keyfirst-zh': keyFirst,
  'trap-zh': selfCheckTrap,
  'old-zh': async () => { await oldInstall('zh-CN', 'old-zh') },
  'new-en': async () => { await newInstall('en', 'new-en') },
  'old-en': async () => { const p = await oldInstall('en', 'old-en'); await typoHost(p, 'en') },
}

const wanted = argv.length ? argv : Object.keys(SCENARIOS)
for (const name of wanted) {
  if (!SCENARIOS[name]) throw new Error(`unknown scenario: ${name}`)
  console.log(`\n── ${name}`)
  try {
    await SCENARIOS[name]()
  } catch (error) {
    record(`${name}/场景没跑完`, false, String(error?.stack || error).slice(0, 600))
  }
}
for (const root of profileRoots) fs.rmSync(root, { recursive: true, force: true })
fs.mkdirSync(outRoot, { recursive: true })
fs.writeFileSync(path.join(outRoot, 'results.json'), JSON.stringify({ build, results }, null, 2))
console.log(`\n被测构建：${build.packaged ? `安装包 ${build.packaged}` : '开发构建'}（版本 ${build.version ?? '未知'}）`)
const failed = results.filter((entry) => !entry.ok && !entry.knownGap)
const gaps = results.filter((entry) => !entry.ok && entry.knownGap)
if (gaps.length) console.log(`\n△ ${gaps.length} 条旧问题照实记为没通过：${gaps.map((entry) => entry.id).join('、')}`)
console.log(failed.length ? `\n✗ ${failed.length} 条没通过（${results.length} 条）` : `\n✓ 本次改动的 ${results.length - gaps.length} 条全部通过，零真实供应商调用`)
process.exit(failed.length ? 1 : 0)
