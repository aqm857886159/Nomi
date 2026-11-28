import { makeTempDir } from '../../scripts/_test-temp.mjs'
// R16 真实用户任务：「我刚接了个文本模型，三个地方说的得是一回事」。
//
// 2026-09-12 真实付费验收 P0-10 的现场（docs/research/2026-09-12-real-onboarding-acceptance/README.md §6）：
// DeepSeek 的文本模型接进来、**重启之后**——
//   · 设置 → 模型   说「1 个连接 · 2 个模型」「2 个可使用」
//   · 项目库首页横幅 说「创作助手尚未连接模型」
//   · 创作助手模型下拉 说「目录里没有可用的」
// 三份判据各写各的，于是同一时刻给出两个答案。判据现在只有一份
// （electron/shared/modelAvailability.ts），本走查是它的**端到端**证据：真 Electron、真 IPC、
// 真 DOM、真设置页，五个状态里三处必须同进同退。
//
// 为什么要五个状态：只测「都说有」会被一个恒真的实现骗过，只测「都说没有」会被一个恒假的骗过。
// 必须让同一台机器在
//   没钥匙 → MCP 又接进来一行没走完认证的 → 恢复旧连接的钥匙 → 冷重启 → 断开
// 之间走一圈，三处每一步都得跟着一起翻。中间那两步不是凑数：
//   · 「没走完认证的那一行」就是 P0-10 的形状（启用着、钥匙也在、就是没发布）——
//     它必须**不**被算进设置页的「N 个可使用」，而是诚实地落在「M 个待设置」那半句里；
//   · 冷重启是那次事故被发现的时机。
//
// 可证伪性（2026-09-12 实测）：把 `resolveModelHomeStatus` 改回不看 `availability`
// （= 修复前的形状）再跑，「填了钥匙」那一步当场红——设置页写 11，目录说 10。
//
// ── 这条走查为什么用内置的「魔搭社区」，而不是自己捏一个回环供应商（2026-09-12 返工）──────
// 初版在渲染层 bridge 上 `upsertVendor({enabled:true})` + `upsertModel({enabled:true})` 自己造了
// 一家 loopback 供应商。那条路**产品上根本不成立**：渲染层的写入是「配置」，不是「发布」——
//   · `sanitizeRendererVendorMutation`：没有已发布模型时，`enabled:true` 一律被改写成 false；
//   · `sanitizeRendererModelMutation`： 新模型强制挂 `adapter:{state:'unverified'}` 且 enabled:false；
//   · `sanitizeRendererVendorApiKeyMutation`：渲染层给的 `enabled` 恒被改成 false
//     （`manualCertificationBoundary.test.ts` 锁着；真实设置卡传的本来就是 `enabled:false`）。
// 于是那家供应商从第一个阶段起就是 `vendor_disabled`，「没钥匙 ⇒ 0 个可用」**是对的答案配错的理由**
// ——恒假实现能骗过的那种假绿（docs/lessons/assert-you-are-in-the-situation-you-claim.md）。
// ModelSurfaces 只推广 APIMart，魔搭社区作为已有连接保留。用内置种子和测试世界恢复
// 该站已保存的凭据，再检查「以前接的」与真实断开交互。
//
// 零额度、零上游请求：魔搭的种子没有 livenessProbe，`credentialValidationStrategy` 判为
// `first-use`，存 key 不发任何上游请求（electron/catalog/validateCandidateCredential.ts:30）。
// 全程一次生成都不发，填的 key 是假的。
//
// 用法：pnpm run build && node tests/ux/model-availability-agreement.walk.mjs
import { launchNomiApp } from './_launchApp.mjs'
import { encryptFixtureKey } from './_mcpL2Fixture.mjs'
import { clickOrFail, expect, expectVisible, proveProbe, expectAbsent, screenshotSettled } from './_assert.mjs'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { require as requireTs } from 'tsx/cjs/api'
import { backToLibrary, ensureAgentPanelOpen, newProjectEntry, openModelSettings } from './_shell.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = process.env.NOMI_WALK_OUT ? path.resolve(process.env.NOMI_WALK_OUT) : path.join(repoRoot, 'tests/ux/shots/model-availability-agreement')
const tempRoot = makeTempDir('nomi-availability-')
const { buildWorld } = requireTs('../world/index.ts', import.meta.url)
const world = buildWorld({ rootDir: tempRoot, projects: [] })
mkdirSync(shotsDir, { recursive: true })

/** 内置「魔搭社区」：种子自带 10 个预置模型（3 个 Qwen3 文本大脑），只差一把 key。 */
const VENDOR_KEY = 'modelscope'
const VENDOR_LABEL = '魔搭社区'
/**
 * P0-10 现场那两个 DeepSeek 模型的形状：**启用着、钥匙也在、认证没走完**
 * （`meta.adapter` 在，没有 activeRevision，但标准文本请求格式本来就可执行）。
 *
 * 为什么要往目录文件里塞这一行，而不是点界面点出来：这种行只有主进程写得出来
 * （MCP / 认证会话），渲染层写入被 `sanitizeRendererModelMutation` 强制按下 enabled
 * ——也就是说**用户点不出这一行，但 MCP 接入天天写出它**，而它正是那次事故的形状。
 * 关掉 App 后通过测试世界补一行，再冷启动读回。
 */
const MCP_MODEL_KEY = 'nomi-walk-halfway-certified'

let app = null
let win = null
let closeApp = async () => {}

/** 冷启动（首启 / 重启共用）：同一份 profile 目录，真的把进程关掉再起一次。 */
async function coldStart() {
  const launched = await launchNomiApp({
    name: 'model-availability-agreement',
    world,
    syntheticCredentialStorage: true,
    args: ['--no-proxy-server'],
    settleMs: 0,
  })
  app = launched.app
  win = launched.win
  closeApp = launched.close
  await getWin().waitForLoadState('domcontentloaded')
  await getWin().waitForTimeout(1500)
  await dismissFirstRun()
}

/**
 * 重启 = 关掉进程再起一次，**不是** `win.reload()`：原地刷新后活动项目恒 null，
 * 一堆面板会静默空掉，那是走查独有的路径不是用户路径
 * （docs/lessons/walkthrough-no-win-reload.md）。而这条走查要验的恰恰是「重启之后」。
 */
async function restart() {
  await closeApp().catch(() => {})
  app = null
  await coldStart()
}

/** app 关着的时候往目录里补一行「MCP 接了一半」的模型（见 MCP_MODEL_KEY 注释）。 */
function injectHalfCertifiedModel() {
  const now = new Date().toISOString()
  buildWorld({ rootDir: tempRoot, projects: [], catalog: { models: [
    {
      vendorKey: VENDOR_KEY,
      modelKey: MCP_MODEL_KEY,
      labelZh: 'MCP 接了一半的文本模型',
      kind: 'text',
      enabled: true,
      // adapter 在但没有 activeRevision = 认证走到一半停下（P0-10 的那两行就长这样）。
      meta: { adapter: { modes: [], publicationModes: [] } },
      createdAt: now,
      updatedAt: now,
    },
  ] } })
}

function restoreLegacyCredential() {
  const now = new Date().toISOString()
  buildWorld({ rootDir: tempRoot, projects: [], encryptedApiKeys: {
    [VENDOR_KEY]: {
      vendorKey: VENDOR_KEY, apiKey: encryptFixtureKey(world.userDataDir), enc: 'safeStorage',
      enabled: true, createdAt: now, updatedAt: now,
    },
  } })
}

let passed = 0
/** 判定助手（本仓最大的一族写法）：不成立就抛，成立就记一条。 */
function check(condition, label, detail = '') {
  if (!condition) throw new Error(`WALK FAIL: ${label}${detail ? ` — ${detail}` : ''}`)
  passed += 1
  console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`)
}

const getWin = () => {
  const live = app.windows().filter((candidate) => !candidate.isClosed())
  win = live.find((candidate) => /projectId=/.test(candidate.url())) || live[live.length - 1] || win
  return win
}

const snap = async (name) => {
  await screenshotSettled(getWin(), { path: path.join(shotsDir, name) })
  console.log(`  · 截图 ${name}`)
}

async function dismissFirstRun() {
  for (let index = 0; index < 6; index += 1) {
    const action = getWin().locator('button, [role="button"], a', { hasText: /跳过|完成|知道了|开始创作|稍后/ }).first()
    if (await action.isVisible().catch(() => false)) await action.click({ timeout: 900 }).catch(() => {})
    await getWin().keyboard.press('Escape').catch(() => {})
    await getWin().waitForTimeout(180)
  }
}

/** 设置是层叠的页：Escape 一次只退一层，退到没有遮罩为止。 */
async function closeSettings() {
  for (let index = 0; index < 8; index += 1) {
    if (await getWin().locator('[data-settings-overlay="true"]').count() === 0) return
    await getWin().keyboard.press('Escape')
    await getWin().waitForTimeout(400)
  }
  throw new Error('WALK FAIL: 设置浮层关不掉')
}

/** 像真人一样点开设置 → 模型（入口锚点用 data-testid，不认文案）。 */
async function openSettings() {
  await closeSettings()
  await openModelSettings(getWin(), { label: '模型设置入口' })
  await expectVisible(getWin().locator('[data-model-settings-page]').first(), '模型设置页打开')
  await getWin().waitForTimeout(900)
}

const connectionRow = () => getWin().locator(`[data-model-home-connection="${VENDOR_KEY}"]`)

/**
 * ① 首页横幅读的那条：主进程 readiness（resolveTextBrainStatus 经 promptLibrary.textBrain）。
 * ② 目录投影下发给渲染层的每行 availability——助手下拉与画布选择器都吃它。
 * 两条都走真 IPC，不是从渲染层内存里抄一份。
 */
const askMainProcess = () => getWin().evaluate(async ({ vendorKey }) => {
  const brain = await window.nomiDesktop?.promptLibrary?.textBrain?.()
  const rows = (await window.nomiDesktop?.modelCatalog?.listModels({ vendorKey })) || []
  return {
    brainReady: brain?.status === 'ok',
    rowCount: rows.length,
    textRowCount: rows.filter((row) => row.kind === 'text').length,
    usableCount: rows.filter((row) => row.availability?.usable === true).length,
    // 排序过，好让期望值逐字可比（顺序是目录顺序，不是判据的一部分）。
    reasons: [...new Set(rows.map((row) => row.availability?.reason ?? 'usable'))].sort(),
  }
}, { vendorKey: VENDOR_KEY })

/** 真人路径：设置 → 点这家连接行 → 断开 → 确认。 */
async function disconnectLikeAHuman() {
  await openSettings()
  await clickOrFail(connectionRow().first(), `${VENDOR_LABEL} 连接行`)
  await clickOrFail(getWin().locator('button', { hasText: /^断开$/ }).first(), '断开')
  // 确认卡的可量表面是 data-confirm-dialog-surface（落在可见 content 内）；
  // 拿卡片里那颗同名的「断开」会被 Mantine 的遮罩挡住点不到
  // （docs/lessons/assert-you-are-in-the-situation-you-claim.md 的置顶模态那一条）。
  await clickOrFail(getWin().locator('[data-confirm-dialog-confirm="true"]').first(), '确认卡上的「断开」')
  await getWin().waitForTimeout(900)
  passed += 1
  await closeSettings()
}

/**
 * 一个状态 = 三处各问一遍，答案必须是同一个。
 *
 * `reasons` 是**逐字**对照的，不只是数目对：上一版走查栽的正是「答案对、理由错」——
 * 一家被悄悄停用（`vendor_disabled`）同样能让「可用数 = 0」成立，于是那条判据恒真。
 */
async function assertAgentDropdown(brainReady, shot) {
  await closeSettings()
  await clickOrFail(newProjectEntry(getWin()), '创建真实项目检查 Agent 模型')
  await ensureAgentPanelOpen(getWin())
  await expectVisible(getWin().locator('[data-v4-panel]').first(), '项目 Agent 面板')
  await clickOrFail(getWin().locator('[data-v4-control="model"]:visible').first(), 'Agent 模型入口')
  const popover = getWin().locator('[data-v4-popover="model"]:visible').first()
  await expectVisible(popover, 'Agent 模型弹层')
  let labels = []
  if (brainReady) {
    const trigger = popover.locator('[data-v4-model-row]').first().locator('button').first()
    await clickOrFail(trigger, '对话模型下拉')
    const menu = getWin().locator('[data-nomi-select-dropdown]:visible').first()
    await expectVisible(menu, '真实模型候选菜单')
    labels = await menu.locator('[data-nomi-select-option-label]').allTextContents()
    check(labels.some(x => /Qwen/i.test(x)), '保存凭据后真实 Agent 下拉提供文本模型', JSON.stringify(labels))
  } else {
    await expectVisible(popover.getByText('目录里没有可用的', { exact: true }).first(), '没有凭据时 Agent 明确显示不可用')
    check(await popover.locator('[data-nomi-select-option-label]').count() === 0, '无凭据时没有可选模型')
  }
  console.log('AGENT_MENU', shot, JSON.stringify(labels))
  await snap('agent-' + shot)
  check(labels.some(x => x.includes('MCP 接了一半')) === brainReady, '标准文本格式的未验证模型只随凭据可用性进入 Agent 候选', JSON.stringify(labels))
  await getWin().keyboard.press('Escape')
  await getWin().keyboard.press('Escape')
  await backToLibrary(getWin(), { label: '返回真实项目库' })
  await expectVisible(newProjectEntry(getWin()), '已返回项目库')
}

async function assertAgreement(label, { usable, reasons, brainReady, shot }) {
  const main = await askMainProcess()
  await openSettings()
  if (brainReady) {
    await expect(connectionRow().locator('[data-model-status]')).toHaveText(`${usable} 个可使用`)
  } else {
    const apimart = await proveProbe(getWin().locator('[data-model-home-available="apimart"]'), '新接入的 APIMart 入口可见')
    await expectAbsent(connectionRow(), { provenBy: apimart, message: '无凭据的旧供应商不在模型首页' })
  }
  await snap(shot)
  await closeSettings()
  const detail = `目录=${main.usableCount}/${main.rowCount} 原因=${JSON.stringify(main.reasons)} `
    + `readiness=${main.brainReady}`
  check(main.rowCount > 0, `${label}：目录里确实有这家的模型（否则测的是「空目录」）`, detail)
  check(main.usableCount === usable, `${label}：目录说这家有 ${usable} 个能用`, detail)
  check(
    JSON.stringify(main.reasons) === JSON.stringify(reasons),
    `${label}：每一行不可用的理由都对得上（不是「答案对、理由错」）`,
    `${JSON.stringify(main.reasons)} vs 期望 ${JSON.stringify(reasons)}`,
  )
  check(main.brainReady === brainReady, `${label}：首页横幅那条 readiness 说${brainReady ? '「已接上」' : '「还没接上」'}`, detail)
  await assertAgentDropdown(brainReady, shot)
  return main
}

try {
  await coldStart()

  // ── 状态一：模型已随内置种子躺在目录里，但钥匙还没填 ────────────────────────
  const empty = await assertAgreement('没钥匙', {
    usable: 0, reasons: ['credential_missing'], brainReady: false,
    shot: '01-no-key-settings.png',
  })
  check(empty.textRowCount > 0, '这家里确实有文本模型（否则验不到首页横幅那条 readiness）', `text=${empty.textRowCount}`)
  const seededRows = empty.rowCount

  // ── 状态二：MCP 又接了一行、但认证没走完，然后冷启动（P0-10 的现场）────────────
  await closeApp()
  injectHalfCertifiedModel()
  await coldStart()
  const halfway = await assertAgreement('多了一行没走完认证的模型 · 仍没钥匙', {
    usable: 0, reasons: ['credential_missing'], brainReady: false,
    shot: '02-mcp-halfway-no-key.png',
  })
  check(halfway.rowCount === seededRows + 1, 'MCP 补的那一行确实进了目录（没被内置种子刷掉）', `${seededRows} → ${halfway.rowCount}`)

  // ── 状态三：恢复已有连接的凭据（ModelSurfaces 的旧用户入口）─────────────────
  await closeApp()
  restoreLegacyCredential()
  await coldStart()
  const connected = await assertAgreement('恢复已存钥匙', {
    usable: seededRows + 1, reasons: ['usable'], brainReady: true,
    shot: '03-with-key-settings.png',
  })

  // ── 状态四：冷重启（P0-10 正是重启之后才暴露的）─────────────────────────────
  await restart()
  const afterRestart = await assertAgreement('重启之后', {
    usable: seededRows + 1, reasons: ['usable'], brainReady: true,
    shot: '04-after-restart.png',
  })
  check(
    afterRestart.usableCount === connected.usableCount,
    '重启前后是同一个数（不是重启后自己漂了一份新答案）',
    `${connected.usableCount} → ${afterRestart.usableCount}`,
  )

  // ── 状态五：用户把这家断开（钥匙没了）──────────────────────────────────────
  await openSettings()
  const rowProof = await proveProbe(connectionRow(), `设置页「已接入」里有 ${VENDOR_LABEL} 这一行`)
  await disconnectLikeAHuman()
  await assertAgreement('拔了钥匙', {
    usable: 0, reasons: ['credential_missing'], brainReady: false,
    shot: '05-key-removed-settings.png',
  })
  await openSettings()
  await expectAbsent(connectionRow(), { provenBy: rowProof, message: `断开后「已接入」里不该还留着 ${VENDOR_LABEL}` })
  passed += 1
  await closeSettings()

  console.log(`\n✅ 走查通过：${passed} 条判据`)
} finally {
  if (app) await closeApp().catch(() => {})
}
