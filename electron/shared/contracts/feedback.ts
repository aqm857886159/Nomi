/**
 * 一键反馈的中立契约（渲染层只依赖这里）。
 *
 * 2026-09-15 用户拍板的两条形状约束，写在类型里而不是写在文档里：
 *   ·「一键反馈里的东西大部分不能让用户填」→ 除了可空的 `note`，没有任何用户输入位；
 *     `summary` 是**调用处所在域的错误码 owner 已经派生好的那句人话**，不是让用户写的。
 *   ·「创作内容默认不带、勾选才带」→ `includeContent` 没有默认 true 的路径，
 *     且它只控制轨迹投影里那两个可选键（见 `electron/shared/agentLane/laneTrajectory.ts`）。
 */
import type { DiagnosticsBundleManifest } from './diagnostics'
import type { PerfSummaryProps } from './perfTelemetry'

/**
 * 这份反馈是从哪儿来的。前四个是**失败面**，**这四个字面量就是「四处共用同一组件」的机器
 * 保证**：新增一个失败面必须来这里加一次，加不进来就说明它该复用现有的某一个。
 *
 * 第五个 `unspecified` 是**规范入口**（设置 → 关于 → 反馈）——那一刻没有任何失败上下文。
 * 它必须存在而不是让那条路复用 `generation`：走查真跑完之后，落到接收端的报文里写着
 * `"surface":"generation"`（见 docs/evidence 的 posted-feedback.summary.json 第一版），
 * 而那份报告跟生成一点关系都没有。分诊时把「用户主动来说一件事」读成「生成坏了」，
 * 比没有这一格更糟——一个编错的标签会一直骗人，而一个诚实的 `unspecified` 只是少一点信息。
 */
export const FEEDBACK_SURFACES = ['agent', 'generation', 'import', 'model-validation', 'unspecified'] as const
export type FeedbackSurface = (typeof FEEDBACK_SURFACES)[number]

export type FeedbackReportRequest = {
  surface: FeedbackSurface
  /**
   * 摘要行里那句人话。**由调用处用它所在域的 owner 算出来**
   * （Agent 域 `laneFailureText()` / 生成域 `classifyGenerationError()` / 模型域
   * `certificationFailureMessage` / 适配器域 `adapterFailureAdvice`）。
   * 反馈这一侧刻意**不带**自己的错误码→人话表——那会是仓库里的第六张，而前五张各有门岗。
   */
  summary: string
  /** 机器码（有的话）。它不参与显示，只让我们能按码聚类。 */
  errorCode?: string
  /** 用户可空的一行留言。空串与 undefined 等价。 */
  note?: string
  /** 「也附带最近几轮的提示词和回复」那个勾。默认 false。只有带轨迹的请求才有东西可带。 */
  includeContent?: boolean
  /** 已经过渲染层脱敏的供应商身份（`buildFeedbackDiagnostics` 的产物形状）。 */
  provider?: string
  model?: string
  /** 哪条对话的轨迹。给不出就不带轨迹，清单里写明原因。 */
  laneName?: string
  /**
   * 这份反馈属于哪个项目。**由知情的那一侧（发起的那个窗口/面）给**，主进程不自己去读
   * 「当前项目」——2026-09-17 起「当前项目」在主进程没有读者（项目身份单点签发，
   * 合同 docs/plan/2026-09-17-project-surface-session.md）；那种读法会把「用户点反馈时
   * 正开着的项目」和「这条失败当时所在的项目」混成一个。给不出就不带（轨迹随之缺席，
   * 清单里写明 why）。
   */
  projectId?: string | null
  /**
   * 本机界面流畅度分档数字（卡不卡）。用户点「发送」这一下就是同意带上，不受「帮 Nomi 变好」开关管；
   * 只有分档标签（见 perfTelemetry.ts），反馈卡上写明「会附带卡顿数字」。给不出（窗口太短 / 接口不支持）就不带。
   */
  perf?: PerfSummaryProps
}

/**
 * 清单条目的名字。主进程照这张表写，渲染层照这张表翻译：清单是给用户看的同意书，
 * 界面是什么语言它就得是什么语言（`src/i18n/locales/feedbackReport.ts` 按它穷尽，缺一项编译就红）。
 */
export const FEEDBACK_MANIFEST_ITEMS = {
  logTail: 'logs/tail.txt',
  modelCatalog: 'model-catalog.json',
  trajectory: 'trajectory/turns.json',
  perf: 'perf/summary.json',
  secrets: 'API keys / tokens / proxy credentials',
  paths: 'file paths / project paths / asset paths',
  content: 'prompts / manuscripts / tool results',
  fullLogs: 'full logs / Agent command ledger / project artifacts',
} as const
export type FeedbackManifestItem = keyof typeof FEEDBACK_MANIFEST_ITEMS

/** 某一项没带上的原因。同样穷尽翻译，也是雷达聚类的键。 */
export const FEEDBACK_EXCLUSION_REASONS = [
  'logs-unavailable',
  'logs-empty',
  'catalog-unavailable',
  'no-conversation-in-context',
  'trajectory-unavailable',
  'trajectory-timeout',
  'perf-unavailable',
  'report-size-limit',
  'legacy-catalog-dropped',
  'never-collected-by-design',
  'content-checkbox-not-ticked',
  'available-only-via-settings-diagnostics-export',
] as const
export type FeedbackExclusionReason = (typeof FEEDBACK_EXCLUSION_REASONS)[number]

/** 「查看」看到的东西：清单本身。每项一行 what，排除项一行 why。 */
export type FeedbackReportPreview = {
  manifest: DiagnosticsBundleManifest
}

export type FeedbackSendResult =
  /** `queued` = 已存在本机、之后自动重发；`trimmed` = 有附件超过大小上限没带上，界面要明说。 */
  | { ok: true; id: string | null; queued: boolean; trimmed: boolean }
  /**
   * `endpoint-unconfigured` 是**明着标的缺口**（D4），不是假装排队。
   * 这个构建没配接收端就是真的发不出去，跟用户说「已排队」等于骗他。
   */
  | { ok: false; reason: 'invalid' | 'endpoint-unconfigured' | 'failed' }
