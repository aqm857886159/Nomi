// 令牌路付费口的登记表与判定（2026-10-27，docs/plan/2026-10-27-browser-extract-grant.md ★3 系统改进）。
//
// 它在拦哪个真实事故：浏览器「提取提示词」从 2026-09-09（runtime 文本分支补上付费闸）起每次都被闸拒——渲染层直接调任务、
// 没有任何地方为这次调用铸令牌。供应商 0 次、库里 0 条，坏了一个多月没人发现，因为：
//   · scripts/check-run-task-grant.mjs 只认「自己拼了 request: 的 runTask 调用」，渲染层经 IPC 转发的那一下它看不见；
//   · 概念 spend.pending-identity 的例外账（当时是 notes ①–④）是一段文字，写着「提示词提取走 spendConfirmGrant」，代码里根本没有这回事。
// 所以把那段文字变成一张表：令牌路上每一扇能发出付费调用的门（door-map 数出来的 runTask / runWorkbenchTaskByVendor 门）
// 都登记一个角色，说清令牌从哪来；普查测试 electron/spendTokenDoors.census.test.ts 用 scripts/door-map.mjs 数门、
// 用 judgeSpendTokenDoors 判，少接一个口就红。例外的到期日在该概念的 exception_deadlines 里，不在这里抄。
//
// 四条判据（judgeSpendTokenDoors，任一条不满足 = 一条 finding）：
//   ① 代码里有、表里没有的门（新长出一条付费路，没人说令牌从哪来）；
//   ② 表里有、代码里已经没了的行（防表变成永久豁免）；
//   ③ `mints` 行：铸令牌的门（mintSpendGrant / confirmSpendAndMintGrant 的写门）必须真在点名的文件里，且点名一份真入口测试；
//   ④ `forwards` 行：指向的必须是一条 `mints` 行（把函数递下去的门，最后得落到一个真铸令牌的地方）。
// 另：`known-gap` 行必须写缺什么、谁跟。
//
// 看不见的（表管不到，别以为登记全了就全拦住）：数门是按符号名数的，`desktop.tasks.run(...)` 这种成员调用它数不到——
// 渲染层直调那一口由 eslint.config.mjs 的 task-run-bridge 规则拦（只许 src/workbench/api/taskApi.ts）；文本流式门
// nomi:tasks:text:stream 与 testModelCatalogMapping 的 execute: true 既不要令牌也不在表里，范围写在根因合同的 residual_risks。
//
// 和别的门岗的分工：check-run-task-grant 管一个调用点的性质（自拼 request 必须带 grantId）；这里管一份清单（谁在花钱、令牌从哪来）。
// 文本调用方矩阵（tests/fixtures/textTasks/textTaskCallerHarness.ts）管文本任务在各入口的行为；这里只管令牌。三者不互相替代。

/**
 * @typedef {{ kind: string, path: string, symbol: string }} SpendTokenDoor door-map 数出来的一扇门。
 * @typedef {{
 *   door: string, role: string, why: string,
 *   test?: string, mintIn?: string, to?: string, gap?: string, owner?: string,
 * }} SpendTokenDoorRow 登记表的一行；各角色要写哪些字段见 judgeSpendTokenDoors。
 */

/** 能发出一次付费调用的门（door-map 的目标符号）。 */
export const SPEND_TOKEN_DOOR_SYMBOLS = ['runTask', 'runWorkbenchTaskByVendor']
/** 铸令牌的门：同一文件里有它的写门，才算「这一路自己铸了令牌」。 */
export const MINT_SYMBOLS = ['mintSpendGrant', 'confirmSpendAndMintGrant']
export const SPEND_TOKEN_DOOR_ROLES = ['mints', 'forwards', 'run-approved', 'free-local', 'test-utility', 'known-gap']

const TRY_MODEL = 'write|electron/capabilityCore/modelOnboarding/tryModel.ts|runTask'
const CERTIFICATION = 'write|electron/integrationCertification/integrationSession.ts|runTask'
const BROWSER_EXTRACTION = 'write|electron/browser/prompt/browserPromptExtractionRun.ts|runTask'

/**
 * 一扇门一行，身份 = door-map 的 `kind|path|symbol`（不带行号）。
 * 这是概念 spend.pending-identity 的例外账的结构化形状（到期日在该概念的 exception_deadlines）：新增一行要协调会话批准。
 * @type {ReadonlyArray<SpendTokenDoorRow>}
 */
export const SPEND_TOKEN_DOORS = [
  // ── 自己问人 / 自己铸令牌、紧接着发 ──
  { door: BROWSER_EXTRACTION, role: 'mints', test: 'electron/browser/prompt/browserPromptExtraction.ipc.integration.test.ts',
    why: '浏览器「提取提示词」：每次弹卡问人（confirmSpendAndMintGrant），铸一颗只覆盖这一次读图的令牌再发（例外 ③）。' },
  { door: TRY_MODEL, role: 'mints', test: 'electron/capabilityCore/modelOnboarding/tryModelSubmitBudget.test.ts',
    why: 'MCP 试跑：同文件 mintSpendGrant 铸完紧接着发，没带报价的令牌在闸上一定问人（例外 ①）。' },
  { door: CERTIFICATION, role: 'mints', test: 'electron/integrationCertification/integrationSession.test.ts',
    why: '接入认证：注入的 mintSpendGrant 铸完紧接着发（例外 ②）。' },
  { door: 'write|electron/video/deconstructVideo.ts|runTask', role: 'mints', mintIn: 'electron/video/deconstructSpend.ts',
    test: 'electron/video/deconstructSpend.test.ts',
    why: '视频拆解：开跑前在 deconstructSpend.ts 问人、铸一颗覆盖整批的令牌，逐镜带着发（例外 ③）；整条链的整机演练仍是缺口（文本矩阵 #6）。' },

  // ── 把真 runTask 递下去，最后落到上面某一行 ──
  { door: 'read|electron/browser/prompt/browserPromptExtractionRun.ts|runTask', role: 'forwards', to: BROWSER_EXTRACTION,
    why: 'IPC 那一端把懒加载的 runtime.runTask 交给同文件的提取函数。' },
  { door: 'read|electron/capabilityCore/appIntegration.ts|runTask', role: 'forwards', to: TRY_MODEL, why: '能力核装配：把 runTask 递给工具调度。' },
  { door: 'read|electron/capabilityCore/dispatcher.ts|runTask', role: 'forwards', to: TRY_MODEL, why: '工具调度把 runTask 递给模型接入工具。' },
  { door: 'read|electron/capabilityCore/host.ts|runTask', role: 'forwards', to: TRY_MODEL, why: '能力核宿主持有 runTask 并往下递。' },
  { door: 'read|electron/capabilityCore/mcpStdioServer.ts|runTask', role: 'forwards', to: TRY_MODEL, why: 'MCP stdio 服务装配时递 runTask。' },
  { door: 'read|electron/capabilityCore/modelOnboarding/dispatch.ts|runTask', role: 'forwards', to: TRY_MODEL, why: '模型接入工具分派到试跑。' },
  { door: 'read|electron/capabilityCore/rpcServer.ts|runTask', role: 'forwards', to: TRY_MODEL, why: 'RPC 服务装配时递 runTask。' },
  { door: 'write|electron/main.ts|runTask', role: 'forwards', to: TRY_MODEL, why: '启动能力核时注入懒加载的 runtime.runTask。' },
  { door: 'read|electron/integrationCertification/integrationSession.ts|runTask', role: 'forwards', to: CERTIFICATION, why: '认证服务从注入里取出 runTask。' },
  { door: 'write|electron/integrationCertification/integrationSessionRuntimeInstall.ts|runTask', role: 'forwards', to: CERTIFICATION,
    why: '把真 runTask 与真 mintSpendGrant 一起装给认证服务。' },

  // ── 不核令牌的：批准住在 Run 的门上 / 本地 ComfyUI 不花钱 ──
  { door: 'write|electron/capabilityCore/canvasTransportProvider.ts|runTask', role: 'run-approved',
    why: '画布单镜 Run 的传输：RUN_APPROVED_ADMISSION，批准住在单镜 Run 的门上（主进程手势收据）。' },
  { door: 'write|electron/tasks/comfyCandidateTest.ts|runTask', role: 'free-local',
    why: 'ComfyUI 候选试跑：本机显卡，闸对 ComfyUI 放行。新手页的工作流试生成走这条（nomi:tasks:comfy-candidate-test），不经 nomi:tasks:run。' },
  { door: 'read|electron/tasks/taskIpcHandlers.ts|runTask', role: 'free-local', why: '把 runTask 递给 ComfyUI 候选试跑（同上）。' },

  // ── 渲染层经 nomi:tasks:run 的门：没有调用方带令牌，所以只有本地 ComfyUI 能真跑起来 ──
  // 渲染层给 nomi:tasks:run 的请求里不带 grantId（nomi:tasks:grant-spend 的主进程口还在，渲染层已没有人调它）。
  // 付费种类过不了主进程的闸：electron/tasks/taskSpend.ts 的 consumeTaskSpend 只对 ComfyUI 放行，其余走
  // assertAndConsumeQuotedSpend，没有令牌直接抛 SpendNotAuthorizedError（electron/spendGrant.ts），走不到「问人」那一步。
  { door: 'write|electron/tasks/taskIpcHandlers.ts|runTask', role: 'free-local',
    why: 'nomi:tasks:run 的主进程那一端：只转发渲染层的 payload，不铸令牌。渲染层没有任何调用方给它带令牌，所以付费种类在 electron/spendGrant.ts 被拒（SpendNotAuthorizedError），只有本地 ComfyUI（electron/tasks/taskSpend.ts 放行）能真跑起来。' },
  { door: 'write|src/workbench/generationCanvas/runner/catalogTaskActions.ts|runTask', role: 'free-local',
    why: '画布节点 runner 的局部函数（不是 runtime 的 runTask）：Run 路走 canvasRunSubmitter，非 Run 路落到 runWorkbenchTaskByVendor（nomi:tasks:run），那条路上没有人带令牌：付费种类在 electron/spendGrant.ts 被拒，本地 ComfyUI 放行。' },
  { door: 'read|src/workbench/generationCanvas/runner/catalogTaskActions.ts|runTask', role: 'free-local', why: '同上，选哪个提交函数的那一行。' },
  { door: 'read|src/workbench/generationCanvas/runner/catalogTaskActions.ts|runWorkbenchTaskByVendor', role: 'free-local',
    why: '画布非 Run 路，经 nomi:tasks:run：渲染层没有调用方带令牌，付费种类在 electron/spendGrant.ts 被拒（SpendNotAuthorizedError），本地 ComfyUI 放行。runWorkbenchTaskByVendor 只剩这一扇门；渲染层直调 desktop.tasks.run 由 eslint.config.mjs 的 task-run-bridge 规则拦。' },

  // ── 测试工具 ──
  { door: 'write|electron/parity/generationParityTestUtils.ts|runTask', role: 'test-utility', why: '对等矩阵的测试工具，自己铸令牌、不进产品路径。' },
]

/** @param {SpendTokenDoor} door */
export function spendTokenDoorIdentity(door) {
  return `${door.kind}|${door.path}|${door.symbol}`
}

const pathOf = (identity) => String(identity).split('|')[1] ?? ''
const text = (value) => typeof value === 'string' && value.trim().length > 0

/**
 * 纯判定：`doors` = door-map 数出来的 runTask / runWorkbenchTaskByVendor 门，`mintDoors` = 铸令牌符号的门，
 * `exists(path)` = 仓库里有没有这个文件。返回 findings（空数组 = 全部登记、全部配对）。
 * @param {{ doors: SpendTokenDoor[], mintDoors: SpendTokenDoor[], table?: ReadonlyArray<SpendTokenDoorRow>, exists?: (path: string) => boolean }} input
 * @returns {Array<{ kind: string, door: string, message: string }>}
 */
export function judgeSpendTokenDoors({ doors, mintDoors, table = SPEND_TOKEN_DOORS, exists = () => true }) {
  const findings = []
  const live = new Set(doors.map(spendTokenDoorIdentity))
  const minting = new Set(mintDoors.filter((door) => door.kind === 'write' && MINT_SYMBOLS.includes(door.symbol)).map((door) => door.path))
  const rows = new Map()
  for (const row of table) {
    if (rows.has(row.door)) findings.push({ kind: 'invalid-row', door: row.door, message: '同一扇门登记了两行' })
    rows.set(row.door, row)
  }
  for (const identity of live) {
    if (!rows.has(identity)) findings.push({ kind: 'unregistered', door: identity, message: '令牌路上多了一扇付费门，表里没说令牌从哪来' })
  }
  for (const row of table) {
    if (!live.has(row.door)) findings.push({ kind: 'stale', door: row.door, message: '表里登记的门在代码里已经没了（删掉这一行）' })
    if (!SPEND_TOKEN_DOOR_ROLES.includes(row.role)) {
      findings.push({ kind: 'invalid-row', door: row.door, message: `不认识的角色：${row.role}` })
      continue
    }
    if (!text(row.why)) findings.push({ kind: 'invalid-row', door: row.door, message: '每一行都要写 why' })
    if (row.role === 'mints') {
      const mintIn = text(row.mintIn) ? row.mintIn : pathOf(row.door)
      if (!minting.has(mintIn)) findings.push({ kind: 'mints-without-mint', door: row.door, message: `${mintIn} 里没有铸令牌的写门（${MINT_SYMBOLS.join(' / ')}）` })
      if (!text(row.test) || !/\.test\.[cm]?[jt]sx?$/.test(row.test) || !exists(row.test)) {
        findings.push({ kind: 'invalid-row', door: row.door, message: `mints 行必须点名一份存在的真入口测试：${row.test ?? '（没写）'}` })
      }
    }
    if (row.role === 'forwards' && rows.get(row.to)?.role !== 'mints') {
      findings.push({ kind: 'forwards-dangling', door: row.door, message: `forwards 指向的不是一条 mints 行：${row.to ?? '（没写）'}` })
    }
    if (row.role === 'known-gap' && (!text(row.gap) || !text(row.owner))) {
      findings.push({ kind: 'invalid-row', door: row.door, message: 'known-gap 行必须写缺什么（gap）、谁跟（owner）' })
    }
  }
  return findings
}
