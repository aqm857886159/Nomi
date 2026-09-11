// Agent lane · 失败原因的**机器码**（中立契约层，electron-free：主进程 throw、渲染层显示都要引）。
//
// 为什么要它（root-cause，2026-09-11 用户真机截图：Agent 面板顶部飘出一行红色英文原文
// 「The agent is opening a conversation. Try again after it opens.」）：
//
//   主进程在 laneIpc 的 catch 里把 `error.message` **原样**当成 `message` 送过桥；渲染层
//   `checked()` 又把它重新包成 `new Error(result.message)`、丢掉同一份结果里**已经带着的**
//   `code`；最后 `friendlyError` 在分类表里找不到这句英文散句，就把它当「服务商原话」印进了
//   那条红色横幅。三层各自只做了一点点「转手」，合起来就是「主进程的内部不变量断言变成了
//   用户界面文案」。
//
//   `check:i18n` 拦不住它，是因为那条门岗在 electron/ 侧只扫**中文**——写中文 throw 会红，
//   写英文 throw 反而安全。等于把「别让原文漏出去」这条规矩教成了「换成英文就行」。
//
// 解法（最早共享边界）：桥上本来就有 `code` 这一格，把它从 `string` 收紧成**枚举**，让
//   ① 主进程负责把每一种失败判成一个码（`laneErrorCodeOf`）；
//   ② 渲染层**只读码**、按 `LANE_ERROR_TEXT_KEY[code]` 取本地化文案（诊断串只进日志/技术详情）。
//   码不随人话翻译而变，人话不再穿过进程边界。
//
// 与 `nomiErrorCodes.ts` 的分工：那份管**生成域**里「供应商/素材」那一族（码嵌在 message 里
// 穿透 IPC rejection）；这份管**对话域**里 lane 命令的成败（桥的返回值本来就是结构化对象，
// 不需要往字符串里塞标记）。两者都不做「按人话子串分类」。

/**
 * lane 命令可能失败的全部原因。**新增一种失败必须在这里加一个码**，并在
 * `src/i18n/locales/agentLaneError.ts` 里给出两种语言的文案 + `LANE_ERROR_TEXT_KEY` 的整键
 * ——少一样 `check:error-surface` 当场红。
 *
 * 键表住渲染层而不是这里，是因为**整键字面量**才是死键门岗认的精确引用：
 * 在这边拼 `agentLaneError.${code}` 会被判成「覆盖整个命名空间的动态前缀」，
 * 那等于主动放弃整个命名空间的死键检测（`scripts/check-i18n-dead-keys.ts` 的判据）。
 *
 * 码的形状（`agent_lane_*` / `project_*`）与主进程既有的 throw 字面量一致，因此
 * `laneErrorCodeOf` 认得出它们，不需要把几十处 throw 全改一遍。
 */
export const LANE_ERROR_CODES = [
  /** 这个构建没有把 lane 桥暴露给渲染层（浏览器实验室 / 未打包）。 */
  'agent_lane_bridge_absent',
  /** 这个窗口没有打开的对话——命令无处可去。 */
  'agent_lane_closed',
  /** 整条 lane IPC 已随 app 退出注销。 */
  'agent_lane_disposed',
  /** 对话正在开/关的中途；命令没有确定的归属。 */
  'agent_lane_opening',
  /** 另一个窗口正持有这个项目的对话。 */
  'agent_lane_owner_mismatch',
  /** 命令说的那条对话已经被换掉/关掉了（切项目、切对话）。 */
  'agent_lane_workspace_stale',
  /** 过桥的命令本身解不出来（形状/长度/字符集）。 */
  'agent_lane_invalid_command',
  /** 同一个 requestId 的单发请求已经在跑。 */
  'agent_lane_request_duplicate',
  /** 模型侧回了 error 但没给任何可读原因。 */
  'agent_lane_provider_error',
  /** 本地没有可用的文本模型。 */
  'agent_lane_model_unconfigured',
  /** 这条消息引用的技能已经不在了。 */
  'agent_skill_unavailable',
  /** 项目身份在命令飞行途中变了（切项目/重新绑定）。 */
  'project_binding_stale',
  /** 拿不到项目目录。 */
  'project_identity_unavailable',
  /** 项目 Agent 这一侧整体不可用。 */
  'project_agent_unavailable',
  /** 面板点进了一条盘上已经没有的对话（列表过期）。 */
  'agent_lane_conversation_missing',
  /** 「新建对话」撞上同名的一条——静默打开旧的会让他以为自己在白纸上开始。 */
  'agent_lane_conversation_exists',
  /** 要删的正是当前这条。 */
  'agent_lane_conversation_in_use',
  /** 这一轮还在跑，换模型得先停。 */
  'agent_lane_busy_running',
  /** 答的那张审批卡已经不在等了（切走/超时/已答过）。 */
  'agent_lane_approval_missing',
  /** 兜底：没被上面任何一条认领的失败。**它的诊断串不是给用户看的**。 */
  'agent_lane_execute_failed',
] as const

export type LaneErrorCode = (typeof LANE_ERROR_CODES)[number]

const CODE_SET: ReadonlySet<string> = new Set(LANE_ERROR_CODES)

export function isLaneErrorCode(value: unknown): value is LaneErrorCode {
  return typeof value === 'string' && CODE_SET.has(value)
}

/**
 * 「这串文本是一个机器码，不是一句给人看的话」。
 *
 * 判据是**形状**（无空白、小写字母/数字/`_-.`），不是子串匹配：一句英文/中文散句永远不满足它，
 * 所以这条规则不会随文案改动而漂。渲染层用它来决定「这串能不能进日志当诊断信息」——
 * 但**任何**情况下它都不会被当成界面文案。
 */
export function looksLikeMachineCode(message: string): boolean {
  return /^[a-z][a-z0-9_.-]*$/.test(message.trim())
}

/**
 * 主进程侧：把抛出来的任意东西判成一个码。
 *
 * 三档，从确定到兜底：
 *   ① 错误对象自己带 `code`（如 `LaneCommandError`）→ 认它；
 *   ② message 恰好是一个已登记的码（仓库里几十处 `throw new Error('agent_lane_workspace_stale')`
 *      就是这么写的）→ 认它；
 *   ③ 其余一律 `agent_lane_execute_failed`。**兜底档的 message 不许进界面**——它可能是
 *      一句内部不变量断言、也可能是第三方栈里的任意文本，两者都不是用户能据以行动的事实。
 */
export function laneErrorCodeOf(error: unknown): LaneErrorCode {
  const carried = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined
  if (isLaneErrorCode(carried)) return carried
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  const trimmed = message.trim()
  if (isLaneErrorCode(trimmed)) return trimmed
  return 'agent_lane_execute_failed'
}

