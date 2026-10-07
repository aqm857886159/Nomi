import { CANVAS_READ_CAPABILITY } from '../shared/agentCapabilities/canvasRead'
import { RpcError } from './dispatcher'

export const PROJECT_SESSION_ONLY_METHODS: ReadonlySet<string> = new Set([
  CANVAS_READ_CAPABILITY.id,
  'canvas.write',
  'canvas.delete',
  'document.read',
  'document.write',
  'timeline.read',
  'timeline.write',
  'asset.read',
  'export.read',
  'layout.read',
  'layout.write',
  'nomi_session_open',
])

/**
 * 项目内容（画布节点/连线/提示词/文稿）的写执行点。
 *
 * 类根因（2026-09-21，与 `docs/fixes/2026-09-11-legacy-spend-door.root-cause.json` 同形）：上面那张表是
 * **「需要会话的方法」白名单**，`assertLocalBearerProjectSessionRoute` 对名单外的方法直接 return ——
 * 名单式白名单 = fail-open。`canvas.addNodes/connect/setPrompt/deleteNodes` 四个 legacy case 就是这样
 * 在名单外活了下来：任何读得到 `<NOMI_CAPABILITY_DIR>/instance*.json` 的本机进程，拿裸 bearer 就能删掉
 * 用户的节点，而同一件事走 `canvas.write`/`canvas.delete` 是 403。
 *
 * 四个 case 已随本次修复删除。让它不再长回来的机器判据在
 * `dispatcherRouteClosure.test.ts`：dispatcher 的每一个 `case` 都必须在
 * `PROJECT_SESSION_ONLY_METHODS` 或下面这张登记表里被点名，且凡是能走到
 * `PROJECT_CONTENT_MUTATORS` 的 case 必须拿租约或进会话名单——**新 case 不登记即红**。
 */
export const PROJECT_CONTENT_MUTATORS: readonly string[] = Object.freeze([
  'addProjectNodes',
  'connectProjectNodes',
  'setProjectNodePrompt',
  'deleteProjectNodes',
  'writeProjectDocument',
])

/**
 * 裸 bearer 够得到的 dispatcher 方法 —— 每一行写的是「这一格现在靠什么把关」，不是「为什么可以不把关」。
 * 只减不增：要加一行，先说清它写的是哪个对象、那个对象的门在哪一层。
 */
export const LOCAL_BEARER_ROUTE_REGISTER: Readonly<Record<string, string>> = Object.freeze({
  // 只读投影，不落任何状态。
  'ping': '只回存活',
  'project.list': '只读项目列表；handle 签发要 ctx.projectSession，裸 bearer 拿不到 handle',
  'models.list': '只读模型目录投影（分级披露第一档：薄名单）',
  'models.read': '只读单个模型的说明书（分级披露第二档）；与 models.list 同一份投影、同一层判词，不落任何状态',
  'skills.list': '只读技能元数据，按 origin 分级（mcpSkillAccess）',
  'skills.read': '只读技能正文，按 origin 分级（mcpSkillAccess）',
  'brief.intake': '只组题给默认，不落状态（见 case 内注释）',
  'production.get': '只读 Run 投影',
  'production.events': '只读 Run 事件',
  'production.artifact': '只读产物元数据',
  'production.artifact.read': '只读产物正文',
  'integration.get': '只读接入会话（owner=ctx.origin.host，读不到别人的）',

  // 写，但写的不是项目内容；各自的门在自己那一层。
  'project.create': '新建空项目，不触碰既有项目内容',
  'production.start': 'Run 生命周期；方向门/付费门在 productionRunService（信任档只能由用户设置产生）',
  'production.control': 'Run 生命周期；control 动作由 productionRunService 自己判权',
  'production.decide-gate': '门裁决；收据由主进程 createGateApprovalOwner 背书，调用方自报不算',
  'production.trust-challenge': '铸挑战串，供真人在 Nomi 里确认',
  'production.artifact.revise': '改 Run 自己的产物草稿，不落项目记录',
  'production.artifact.review': '改 Run 自己的产物评审，不落项目记录',
  'production.storyboard.materialize': '落画布走 Run 的物化路径，节点归属由 Run 记录背书',
  'asset.import': '导入本机文件为项目素材；安全判据在 importAssetGuard（纯函数，逐条单测）',
  'integration.begin': '接入会话，owner=ctx.origin.host',
  'integration.open_credentials': '开凭证页；密钥只由用户在 Nomi 窗口里贴',
  'integration.propose': '接入会话内的候选提案，owner=ctx.origin.host',
  'integration.start': '接入会话推进，owner=ctx.origin.host',
  'integration.cancel': '接入会话取消，owner=ctx.origin.host',
  // 2026-09-21 合并 ①：MCP 接模型 lane 新长出来的两个 case，被本文件的闭包测试当场点名。
  // 它们不写项目内容，但各自的门必须说得出在哪一层——「不写项目内容」不是一条判词。
  'model.onboarding.kit': '只读进程常量（声明卡 schema + 撰写规范 + 样例卡）；零用户数据、零凭据、不落盘',
  'task.read': '只读单个已提交任务的现状：只走 fetchTaskResult（与画布同一条查询链路），模块里没有提交入口，不花钱、不重提交；任务号不认得就如实说不认得',
  'model.onboarding.try': '试跑一次真实生成，会花钱：钱闸在 spendDecidedByPolicy（用户档位的单一 owner，调用方自报的档位一律不认）+ assertAndConsumeQuotedSpend；非全自动档必须由真人在 Nomi 窗口按下确认，Nomi 没开就诚实失败',
  'model.onboarding.setup': '模型档案接入（modelOnboarding/dispatch 自己判权）',
  'model.onboarding.remove': '删模型档案要 ifUnchanged 指纹（与 models.list 同一个函数算）',
})

/**
 * A local capability bearer authenticates a process, not an MCP transport
 * principal or connection. Until the internal VerifiedCaller binding lands,
 * these routes must fail closed instead of accepting a bare project id or
 * inventing an MCP session.
 */
export function assertLocalBearerProjectSessionRoute(method: string): void {
  if (!PROJECT_SESSION_ONLY_METHODS.has(method)) return
  throw new RpcError('A verified project-session transport is required for this method', 403)
}
