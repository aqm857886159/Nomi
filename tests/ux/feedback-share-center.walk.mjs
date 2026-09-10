// 2026-09-01 · 反馈与分享中心（PR #271 → 内嵌 placement 修复）真机走查。
//
// 锁三件用户看得见的事：
//   ① PLACEMENT（本次事故的正解）：规范入口（设置→关于→「反馈与分享」）点开后，反馈主体**内嵌在设置弹窗内**，
//      不是脱离设置的独立浮层——获批样张画的就是它长在设置右栏。上一版只验「对话框可见」（存在≠位置），
//      于是交付漂成独立框还全绿；这里断言反馈主体是 [data-settings-dialog] 的后代、设置没被关、屏上无另开的反馈 dialog。
//   ② 分享给朋友拿到的是**一段可直接转发的话**（推荐语 + 真实链接）并能一键复制到剪贴板，不是一条裸 URL（问题 #2）。
//   ③ 情境入口（生成失败卡上「反馈问题」）仍能打开反馈（画布里无设置外壳，走独立 DesignModal 是对的），
//      且其构造的外发 URL（私密 Tally / 公开 GitHub）只带**有界字段**，**永不携带用户自定义供应商的字符串**——
//      失败卡的 vendorKey 由用户 base-url 派生（deriveVendorKeyFromBaseUrl → 主机名 slug，可能是内网地址），
//      必须在信封边界被映射成字面量 "custom"。
//
// 为什么用真 Electron + 隔离 profile：这条路径跨「设置弹窗外壳 / About 区块 / 画布失败卡 /
// 全局 FeedbackShareHost / feedbackDiagnostics 信封 / communityLinks URL 构造」六处，
// 单测各测一段证不了「点进去真的不漏」。这里把六段串起来跑一遍。
//
// 外发拦截：openExternal 走 window.open('_blank')，生产里被 electron/main.ts setWindowOpenHandler
// 拦成 shell.openExternal。走查在渲染层把 window.open **替换成记录器**——只记 URL、不真的开浏览器
// （任务红线：不代用户外发，URL 构造断言即可）。记录器装在 window.__nomiOpenLog 上，从主流程外取。
import { launchNomiApp } from './_launchApp.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { clickOrFail, expectVisible, proveProbe, expectAbsent, screenshotSettled } from './_assert.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const outDir = path.join(repoRoot, '.feedback-share-center-walk')
const profileRoot = path.join(os.tmpdir(), 'nomi-feedback-share-center-profile')
for (const target of [outDir, profileRoot]) fs.rmSync(target, { recursive: true, force: true })
for (const target of [outDir, profileRoot]) fs.mkdirSync(target, { recursive: true })

// A user-defined relay/custom vendor: its catalog key is minted from the user's own base URL
// (deriveVendorKeyFromBaseUrl → hostname slug). This one carries a *private internal* address.
const PRIVATE_VENDOR_KEY = 'internal-proxy-corp-local'
const PRIVATE_MODEL_KEY = 'exec-secret-model'

const settingsDir = path.join(profileRoot, 'settings')
const projectsDir = path.join(profileRoot, 'projects')
const userDataDir = path.join(profileRoot, 'user-data')
const capabilityDir = path.join(profileRoot, 'capability')

const launch = () =>
  launchNomiApp({
    name: 'feedback-share-center',
    tempRoot: profileRoot,
    settingsDir,
    projectsDir,
    userDataDir,
    capabilityDir,
    env: { NOMI_RENDERER_URL: `file://${path.join(repoRoot, 'dist', 'index.html')}` },
    settleMs: 1600,
  })

const shot = async (target, name) => {
  await screenshotSettled(target, { path: path.join(outDir, name) })
  console.log(`  📸 ${name}`)
}

// Install a renderer-side window.open recorder that swallows the real external open
// and records the URL. Returns nothing; read via drainOpenLog().
async function installOpenRecorder(win) {
  await win.evaluate(() => {
    const w = /** @type {any} */ (window)
    w.__nomiOpenLog = []
    if (!w.__nomiOpenPatched) {
      w.__nomiOpenPatched = true
      w.open = (url) => {
        w.__nomiOpenLog.push(String(url))
        return null // never actually open a browser (test asserts construction only)
      }
    }
  })
}
async function drainOpenLog(win) {
  return win.evaluate(() => {
    const w = /** @type {any} */ (window)
    const log = Array.isArray(w.__nomiOpenLog) ? w.__nomiOpenLog.slice() : []
    w.__nomiOpenLog = []
    return log
  })
}
async function readOutbox(win) {
  return win.evaluate(() => {
    try {
      return JSON.parse(window.localStorage.getItem('nomi:feedback-outbox:v1') || '[]')
    } catch {
      return null
    }
  })
}

// A bounded URL is only allowed to carry these query keys (communityLinks buildPrivateFeedbackUrl).
const ALLOWED_TALLY_KEYS = new Set(['nomi_version', 'nomi_platform', 'nomi_arch', 'nomi_stage', 'nomi_provider', 'nomi_model'])

/** Fail hard if any private user string appears in a captured URL, or an unexpected key rides along. */
function assertUrlIsBoundedAndClean(url, label) {
  if (!url) throw new Error(`${label}：一个外发 URL 都没被记录到——提交按钮没走到 openExternal，或记录器没装上。`)
  for (const needle of [PRIVATE_VENDOR_KEY, PRIVATE_MODEL_KEY, 'corp-local', 'exec-secret']) {
    if (url.includes(needle)) {
      throw new Error(`${label}：外发 URL 里出现了用户私有字符串「${needle}」——脱敏边界漏了。\n  URL: ${url}`)
    }
  }
  const parsed = new URL(url)
  if (parsed.hostname === 'tally.so') {
    for (const key of parsed.searchParams.keys()) {
      if (!ALLOWED_TALLY_KEYS.has(key)) {
        throw new Error(`${label}：Tally URL 出现了预算外的查询键「${key}」——只允许有界上下文字段。\n  URL: ${url}`)
      }
    }
  }
  return parsed
}

// ─────────────────────────────────────────────────────────────────────────────
// 先建一个真实注册的工作区（首启空白项目），再把画布内容替换成一个「失败节点」，
// 其 meta.modelVendor = 用户 base-url 派生的私有 key。
// ─────────────────────────────────────────────────────────────────────────────
{
  const { app, win } = await launch()
  const skip = win.getByText('跳过', { exact: true }).first()
  if (await skip.isVisible().catch(() => false)) await skip.click()
  await clickOrFail(win.getByText('新建空白项目', { exact: false }).first(), '新建空白项目')
  await win.waitForTimeout(1700)
  await win.keyboard.press('Escape').catch(() => {})
  await app.close()
}

const projectRoot = fs
  .readdirSync(projectsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(projectsDir, entry.name))[0]
if (!projectRoot) throw new Error('首启没有创建出注册工作区——无法继续走查')
const projectFile = path.join(projectRoot, '.nomi', 'project.json')
const project = JSON.parse(fs.readFileSync(projectFile, 'utf8'))
project.payload.generationCanvas = {
  nodes: [
    {
      id: 'failed-shot',
      kind: 'image',
      title: '镜头一',
      categoryId: 'shots',
      position: { x: 320, y: 240 },
      size: { width: 420, height: 250 },
      status: 'error',
      error: 'Provider request failed: 502 Bad Gateway',
      prompt: '雨夜街道，角色回头',
      // 用户自定义中转家：vendorKey 由 base-url 派生（内网主机名），modelKey 是用户填的私有别名。
      meta: { modelVendor: PRIVATE_VENDOR_KEY, modelKey: PRIVATE_MODEL_KEY, imageModel: PRIVATE_MODEL_KEY },
    },
  ],
  edges: [],
  groups: [],
  selectedNodeIds: [],
}
fs.writeFileSync(projectFile, `${JSON.stringify(project, null, 2)}\n`)

// ─────────────────────────────────────────────────────────────────────────────
// 路径 A：规范入口（设置 → 关于 → 反馈与分享），全 UI 驱动，走私密 Tally 提交。
// ─────────────────────────────────────────────────────────────────────────────
{
  const { app, win } = await launch()
  const continueButton = win.getByText('继续创作', { exact: true }).first()
  if (await continueButton.isVisible().catch(() => false)) await continueButton.click()
  await win.waitForTimeout(2000)
  await installOpenRecorder(win)

  // 打开设置并落在「关于」tab（生产事件约定 nomi-open-settings + detail.tab）。
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('nomi-open-settings', { detail: { tab: 'about' } })))
  const settingsDialog = win.getByRole('dialog', { name: '设置' })
  await expectVisible(settingsDialog, '设置弹窗没打开')
  await shot(settingsDialog, 'A01-settings-about.png')

  // 规范入口按钮（About 区块里的行；此时设置弹窗仍在，用 About 区块内的标题定位避免歧义）。
  await clickOrFail(
    settingsDialog.getByText('反馈与分享', { exact: true }).first(),
    '关于页「反馈与分享」入口',
  )

  // ── PLACEMENT 断言（本次事故的正解）─────────────────────────────────────────
  // 用户反馈：「反馈与分享点开变成独立框，不在设置页面里」。获批样张画的是它**长在设置弹窗右栏**。
  // 上一版走查只验「反馈对话框可见」——存在≠位置，那个洞正是让这次交付漂了还全绿的原因。
  // 这里把位置焊死：① 反馈主体必须是设置弹窗的**后代**（DOM 内嵌）；② 设置弹窗**没被关掉**
  // （旧 bug 里入口会 onClose 设置）；③ 屏上**没有**另开一个 role=dialog 的反馈浮层。
  const feedbackContent = win.locator('[data-feedback-share-content]')
  await expectVisible(feedbackContent, '反馈主体没渲染（从 About 入口点进去后）')
  await expectVisible(win.getByText('告诉我们哪里卡住了', { exact: false }), '反馈 home 页没渲染')

  // ① 内嵌：反馈主体在 [data-settings-dialog] 之内（用同一节点同时命中两个选择器来证明祖先关系）。
  const embeddedInSettings = await win
    .locator('[data-settings-dialog] [data-feedback-share-content]')
    .count()
  if (embeddedInSettings < 1) {
    throw new Error(
      '反馈主体没长在设置弹窗内（[data-settings-dialog] 里找不到 [data-feedback-share-content]）——\n'
        + '  这正是用户反馈的「点开变成独立框」：它应当内嵌在设置右栏，不是脱离设置的浮层。',
    )
  }
  // ② 设置弹窗仍在（入口没把设置关掉）。
  await expectVisible(settingsDialog, '点反馈入口后设置弹窗被关掉了——内嵌形态下设置必须仍在')
  // ③ 没有另开一个反馈浮层：反馈**不再**是独立 role=dialog。先证探针活着（设置弹窗这个 dialog 找得到），
  //    再断言「名为反馈与分享的 dialog」不存在——这才是「独立框」bug 的反向对照。
  const dialogProbe = await proveProbe(win.getByRole('dialog'), '页面上至少有一个 role=dialog（设置弹窗）')
  await expectAbsent(win.getByRole('dialog', { name: '反馈与分享' }), {
    provenBy: dialogProbe,
    message: '反馈与分享不该是独立浮层（role=dialog）——它必须内嵌在设置弹窗里',
  })
  await shot(settingsDialog, 'A02-feedback-embedded-in-settings.png')
  console.log('  ✓ A 路径 PLACEMENT：反馈主体内嵌在设置弹窗内，非独立浮层')

  // ── 分享子流：一段可直接转发的话 + 一键复制（问题 #2 的验证）───────────────────
  await clickOrFail(settingsDialog.getByText('分享 Nomi', { exact: true }).first(), '反馈首页「分享 Nomi」')
  const shareMessageBox = settingsDialog.locator('[data-share-message]')
  await expectVisible(shareMessageBox, '分享页没渲染可转发文案框')
  const shareText = await shareMessageBox.innerText()
  // 不是裸 URL：既有真实链接，又有一句人话（长度足以承载推荐语，且含产品名）。
  if (!shareText.includes('nomiaqm.com') || !shareText.includes('github.com/aqm857886159/Nomi')) {
    throw new Error(`分享文案没带上真实链接：\n${shareText}`)
  }
  if (!shareText.includes('Nomi') || shareText.replace(/https?:\/\/\S+/g, '').trim().length < 20) {
    throw new Error(`分享文案像是裸链接、没有可转发的人话推荐语：\n${shareText}`)
  }
  // 一键复制：点按后剪贴板里就是这段话。
  await win.evaluate(() => navigator.clipboard.writeText('__cleared__').catch(() => {}))
  await clickOrFail(settingsDialog.locator('[data-share-copy]'), '复制分享文案按钮')
  await expectVisible(settingsDialog.getByText('已复制，去粘给朋友吧', { exact: false }), '复制后没给出已复制反馈')
  const clip = await win.evaluate(() => navigator.clipboard.readText().catch(() => '')).catch(() => '')
  if (clip && !clip.includes('nomiaqm.com')) {
    throw new Error(`点复制后剪贴板里不是那段可转发的话（拿到：${JSON.stringify(clip.slice(0, 60))}）`)
  }
  await shot(settingsDialog, 'A03-share-message-copied.png')
  console.log('  ✓ A 路径 分享：可转发文案 + 一键复制到剪贴板，非裸 URL')

  // 回反馈首页，进「告诉我们一件事」表单。
  await clickOrFail(settingsDialog.getByText('返回', { exact: true }).first(), '分享页返回')
  await clickOrFail(win.getByText('告诉我们一件事', { exact: true }).first(), '反馈首页「告诉我们一件事」')
  await expectVisible(win.getByText('一句话说说发生了什么', { exact: true }), '反馈表单没出现（缺 summary 字段）')

  // 填一句话，选一个阶段。
  await win.getByPlaceholder('例如：接入模型后，点击生成一直没有反应').fill('从关于页进来测试反馈入口')

  // 展开「查看将附带的脱敏信息」——用户在此亲眼核对将带走的字段。
  await clickOrFail(win.getByText('查看将附带的脱敏信息', { exact: true }).first(), '展开脱敏信息 details')
  const diagPre = win.locator('details pre').first()
  await expectVisible(diagPre, '脱敏诊断预览没展开')
  const diagText = await diagPre.innerText()
  await shot(settingsDialog, 'A04-feedback-diagnostics-expanded.png')

  // About 入口无 vendor 上下文 → 诊断包里根本不该出现 provider/model 键，更不该有任何私有串。
  for (const needle of [PRIVATE_VENDOR_KEY, PRIVATE_MODEL_KEY, 'corp-local']) {
    if (diagText.includes(needle)) {
      throw new Error(`About 入口的诊断预览里出现了不该有的私有串「${needle}」：\n${diagText}`)
    }
  }
  if (!/"stage"/.test(diagText) || !/"version"/.test(diagText)) {
    throw new Error(`诊断预览缺有界字段（应含 stage/version）：\n${diagText}`)
  }

  // 私密提交 → 记录外发 URL。
  await clickOrFail(win.getByRole('button', { name: '私密提交' }).first(), '私密提交')
  await expectVisible(win.getByText('反馈草稿已保存在本机，浏览器页面会继续提交', { exact: false }), '提交后没到 success 屏')
  // 成功屏仍应在设置弹窗内（内嵌形态贯穿 home→feedback→success，不会中途冒出独立浮层）。
  await expectVisible(settingsDialog.locator('[data-feedback-share-content]'), '成功屏脱离了设置弹窗')
  await shot(settingsDialog, 'A05-feedback-success.png')

  const openedA = await drainOpenLog(win)
  const tallyUrlA = openedA.find((u) => u.includes('tally.so'))
  const parsedA = assertUrlIsBoundedAndClean(tallyUrlA, 'A 路径私密提交')
  if (parsedA.searchParams.get('nomi_stage') == null) throw new Error('A 路径 Tally URL 缺 nomi_stage')
  console.log(`  ✓ A 路径 Tally URL 有界且干净：${parsedA.origin}${parsedA.pathname}?…（${[...parsedA.searchParams.keys()].join(',')}）`)

  // 本地草稿留痕：outbox 里有一条，destination=tally，且不含私有串。
  const outboxA = await readOutbox(win)
  if (!Array.isArray(outboxA) || outboxA.length < 1) throw new Error('A 路径提交后 outbox 没留下草稿')
  if (JSON.stringify(outboxA).includes(PRIVATE_VENDOR_KEY)) throw new Error('A 路径 outbox 草稿里混入了私有 vendor 串')

  await app.close()
}

// ─────────────────────────────────────────────────────────────────────────────
// 路径 B：情境入口（生成失败卡上「反馈问题」）——vendorKey 是私有 base-url 派生 key。
// 这条是本走查的核心断言：私有字符串必须在信封边界被换成 "custom"，不进 URL、不进 outbox。
// ─────────────────────────────────────────────────────────────────────────────
{
  const { app, win } = await launch()
  const continueButton = win.getByText('继续创作', { exact: true }).first()
  if (await continueButton.isVisible().catch(() => false)) await continueButton.click()
  await win.waitForTimeout(2200)
  await installOpenRecorder(win)

  // 切到「生成」工作区，让画布挂载。
  await clickOrFail(win.locator('[aria-label="工作区切换"]').getByText('生成', { exact: true }), '工作区切换→生成')
  await win.waitForTimeout(1200)

  // 失败节点应渲染出错误卡与「反馈问题」。先证探针在这一屏是活的（基线），再截图。
  const failedNode = win.locator('[data-node-id="failed-shot"]')
  await expectVisible(failedNode, '失败节点没渲染出来（种子工程没被读到？）')
  const feedbackLink = failedNode.getByText('反馈问题', { exact: true })
  const proof = await proveProbe(feedbackLink, '失败卡上「反馈问题」链接存在')
  await shot(win, 'B01-canvas-failed-node.png')

  // 点情境入口。
  await clickOrFail(feedbackLink, '失败卡「反馈问题」')
  const feedbackDialog = win.getByRole('dialog', { name: '反馈与分享' })
  await expectVisible(feedbackDialog, '失败卡没打开反馈对话框')
  await expectVisible(win.getByText('一句话说说发生了什么', { exact: true }), '失败卡进来没直达反馈表单')
  await shot(feedbackDialog, 'B02-feedback-from-failure.png')

  // 展开脱敏预览：私有 vendor / model 串一个都不能出现；provider 必须已是 "custom"。
  await clickOrFail(win.getByText('查看将附带的脱敏信息', { exact: true }).first(), '展开脱敏信息 details（B）')
  const diagPre = win.locator('details pre').first()
  await expectVisible(diagPre, '脱敏诊断预览没展开（B）')
  const diagText = await diagPre.innerText()
  await shot(feedbackDialog, 'B03-feedback-diagnostics-custom.png')
  for (const needle of [PRIVATE_VENDOR_KEY, PRIVATE_MODEL_KEY, 'corp-local', 'exec-secret']) {
    if (diagText.includes(needle)) {
      throw new Error(`失败卡诊断预览泄露了用户私有串「${needle}」——信封边界没把自定义 vendor 换成 custom：\n${diagText}`)
    }
  }
  let diag
  try {
    diag = JSON.parse(diagText)
  } catch {
    throw new Error(`诊断预览不是合法 JSON：\n${diagText}`)
  }
  if (diag?.context?.provider !== 'custom') {
    throw new Error(`失败卡诊断 provider 应为 "custom"，实际为 ${JSON.stringify(diag?.context?.provider)}`)
  }
  if (diag?.context?.model != null) {
    throw new Error(`失败卡诊断 model 应被丢弃（自定义 vendor 的 model 是用户输入），实际为 ${JSON.stringify(diag?.context?.model)}`)
  }

  // 填一句话并私密提交，捕获 URL。
  await win.getByPlaceholder('例如：接入模型后，点击生成一直没有反应').fill('失败卡进来的反馈，vendor 应脱敏')
  await clickOrFail(win.getByRole('button', { name: '私密提交' }).first(), '私密提交（B）')
  await expectVisible(win.getByText('反馈草稿已保存在本机，浏览器页面会继续提交', { exact: false }), '失败卡提交后没到 success 屏')

  const openedB = await drainOpenLog(win)
  const tallyUrlB = openedB.find((u) => u.includes('tally.so'))
  const parsedB = assertUrlIsBoundedAndClean(tallyUrlB, 'B 路径私密提交')
  if (parsedB.searchParams.get('nomi_provider') !== 'custom') {
    throw new Error(`B 路径 Tally URL 的 nomi_provider 应为 "custom"，实际 ${JSON.stringify(parsedB.searchParams.get('nomi_provider'))}\n  URL: ${tallyUrlB}`)
  }
  if (parsedB.searchParams.get('nomi_model') !== '') {
    throw new Error(`B 路径 Tally URL 的 nomi_model 应为空（自定义 model 丢弃），实际 ${JSON.stringify(parsedB.searchParams.get('nomi_model'))}`)
  }
  console.log(`  ✓ B 路径 Tally URL 已脱敏：nomi_provider=custom, nomi_model 空, 无私有串`)

  const outboxB = await readOutbox(win)
  if (JSON.stringify(outboxB).includes(PRIVATE_VENDOR_KEY) || JSON.stringify(outboxB).includes(PRIVATE_MODEL_KEY)) {
    throw new Error('B 路径 outbox 草稿里混入了私有 vendor/model 串')
  }

  // 收尾：关掉对话框后，失败卡上的「反馈问题」应仍在（入口没被这次提交吃掉）。
  await win.keyboard.press('Escape').catch(() => {})
  await win.waitForTimeout(400)
  await expectVisible(win.locator('[data-node-id="failed-shot"]').getByText('反馈问题', { exact: true }), '提交后情境入口消失了')

  // 反向对照：换一个**不含** vendor 串的探针，证明 expectAbsent 这套尺子在这一屏确实测得到——
  // 用同屏必然不存在的私有串做负向断言（provenBy 用上面证过的活探针）。
  await expectAbsent(win.getByText(PRIVATE_VENDOR_KEY, { exact: false }), {
    provenBy: proof,
    message: `画布任何可见文本里都不该出现私有 vendor 主机名「${PRIVATE_VENDOR_KEY}」`,
  })

  await app.close()
}

console.log('\n✓ feedback & share center walkthrough passed')
