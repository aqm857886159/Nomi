// 工具结果收口（A2 结果重写 + A6 错误契约 · plan 2026-08-11-mcp-conversation-native-p0）。
//
// 这里产出的 text 是「模型转述的原材料」= 用户在 CLI 里真正读到的内容（R15 可见文字）：
// 首行=状态一句话（✓/✗ + 关键事实），次行=参数回显（获批样张①⑧：模型/比例/时长/预算一眼可读，
// Higgsfield chips 的文本版），尾行=下一步动作与深链。双语（zh-CN/en）按 locale 出一份，不混排。
// structuredContent.nomiOutcome 给模型稳定字段（runId/params/nextActions/error），不再让它从文本里抠 ID。
// 纯逻辑、不碰 electron —— 与 mcpProtocol 同边界，可裸 node 单测。

import { ACTIVE_JOB_STATUSES } from '../productionRun/productionRunControl'
import { isAnchorCheckpointGate } from '../productionRun/anchorCheckpoint'
import { projectGenerationRecovery } from './generationRecoveryProjection'

export { buildToolErrorOutcome } from './mcpToolErrorResults'
export { buildCanonicalMcpToolResult, type CanonicalMcpToolResult } from './mcpCanonicalToolResult'

export type ResultLocale = 'zh-CN' | 'en'

type Ctx = { locale: ResultLocale }
const L = (ctx: Ctx, zh: string, en: string): string => (ctx.locale === 'en' ? en : zh)

/** run 状态 → 人话 + 下一步动作（状态机 productionRunState.ts 的对外翻译，缺省透传原状态）。 */
const RUN_STATUS_HINT: Record<string, { zh: string; en: string; nextZh: string; nextEn: string; action: string }> = {
  draft: { zh: '草稿', en: 'draft', nextZh: '下一步：定创意方向（尚未花费）', nextEn: 'Next: pick a creative direction (nothing spent yet)', action: 'pick_direction' },
  awaiting_direction: { zh: '等你定方向', en: 'awaiting direction', nextZh: '下一步：在对话里选一个创意方向', nextEn: 'Next: choose a creative direction in the conversation', action: 'pick_direction' },
  awaiting_script_review: { zh: '剧本等你审阅', en: 'script awaiting review', nextZh: '下一步：审阅剧本；批准后才会拟分镜', nextEn: 'Next: review the script; the storyboard is drafted only after approval', action: 'review_script' },
  awaiting_storyboard_review: { zh: '分镜等你审阅', en: 'storyboard awaiting review', nextZh: '下一步：审阅分镜；确认后才会生成制作合同', nextEn: 'Next: review the storyboard; the contract is created after you confirm', action: 'review_storyboard' },
  awaiting_contract: { zh: '等待批准预算', en: 'awaiting budget approval', nextZh: '下一步：批准制作合同后才会开始付费生成', nextEn: 'Next: approve the production contract before any paid generation', action: 'approve_contract' },
  ready: { zh: '已就绪', en: 'ready', nextZh: '合同已批准，生成即将开始', nextEn: 'Contract approved; generation starts shortly', action: 'watch_or_pause' },
  running: { zh: '制作进行中', en: 'running', nextZh: '可随时说「先停一下」暂停', nextEn: 'Say "pause" anytime to pause the run', action: 'watch_or_pause' },
  pausing: { zh: '正在暂停', en: 'pausing', nextZh: '正在安全停下，已提交的镜头会先收尾', nextEn: 'Stopping safely; in-flight shots will settle first', action: 'wait' },
  paused: { zh: '已暂停', en: 'paused', nextZh: '已提交的花费不退但产物保留；未提交的不再花钱。可继续或取消', nextEn: 'Submitted spend is not refundable but its output is kept; nothing new will be charged. Resume or cancel', action: 'resume_or_cancel' },
  awaiting_rough_cut_review: { zh: '粗剪等你审阅', en: 'rough cut awaiting review', nextZh: '下一步：在 Nomi 里过一遍粗剪', nextEn: 'Next: review the rough cut in Nomi', action: 'review_rough_cut' },
  needs_attention: { zh: '需要处理', en: 'needs attention', nextZh: '有任务卡住了，看错误详情选恢复动作', nextEn: 'A job is stuck; check the error details for recovery actions', action: 'recover' },
  completed: { zh: '已完成', en: 'completed', nextZh: '产物已保存到项目，可在 Nomi 里查看', nextEn: 'Artifacts are saved to the project; open them in Nomi', action: 'open_in_nomi' },
  cancelled: { zh: '已取消', en: 'cancelled', nextZh: '未提交的任务不计费', nextEn: 'Unsubmitted jobs are not charged', action: 'none' },
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/**
 * 历史遗留的坏 Run：`draft` 且一个阶段一道门都没有——起草时用的 playbook 没实现，流水线一格都没
 * 建起来（2026-08-18 已在 repository 层堵死，见 productionPlaybooks.ts；盘上已有的仍读得到）。
 * 它永远不会自己往前走，所以转述必须说实话：不能再按 draft 的默认提示叫 agent 去「定创意方向」
 * ——根本没有方向门可定，那只会让它空转。
 */
function stalledDraftHint(value: Record<string, unknown>): (typeof RUN_STATUS_HINT)[string] | null {
  if (str(value.status) !== 'draft') return null
  const gates = Array.isArray(value.gates) ? value.gates : []
  const stages = Array.isArray(value.stages) ? value.stages : []
  if (gates.length > 0 || stages.length > 0) return null
  return {
    zh: '起不来的草稿',
    en: 'stalled draft',
    nextZh: '这个制作没建起任何阶段（起草时用的 playbook 未实现），不会自己往前走。用 nomi_run_control（action=cancel）取消它，再用受支持的 playbook 重新发起。',
    nextEn: 'This run has no stages (its playbook was never implemented), so it will never progress. Cancel it with nomi_run_control (action=cancel), then start again with a supported playbook.',
    action: 'cancel_run',
  }
}

/** 参数回显行（样张⑧）：只回显真实收到的参数，缺的不编。 */
function echoLine(ctx: Ctx, parts: Array<string | null | undefined>): string | null {
  const kept = parts.filter((p): p is string => Boolean(p && p.trim()))
  return kept.length ? kept.join(' · ') : null
}

function truncate(text: string, max = 40): string {
  const trimmed = text.trim()
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed
}

/** Artifact bodies are already sanitized by the production projection, but this final MCP boundary
 * still drops credential/path-shaped fields if a legacy run contains one. Never expose a local path,
 * provider URL, token, or API key merely because an old snapshot carried it. */
function safeArtifactValue(value: unknown, key = ''): unknown {
  if (Array.isArray(value)) return value.map((item) => safeArtifactValue(item))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      if (/api.?key|secret|authorization|provider.?url|private.?url|access.?token/i.test(childKey)) continue
      out[childKey] = safeArtifactValue(childValue, childKey)
    }
    return out
  }
  if (typeof value === 'string' && /path|file/i.test(key) && (/^(?:\/|[A-Za-z]:[\\/])/.test(value) || value.includes('\\'))) return '[redacted]'
  if (typeof value === 'string' && /^https?:\/\//i.test(value) && /provider|vendor|source/i.test(key)) return '[redacted]'
  return value
}

/** Final redaction seam shared by tool results and the versioned artifact resource reader. */
export function sanitizeArtifactResource(value: unknown): unknown {
  return safeArtifactValue(value)
}

function safeNomiDeepLink(value: string): string {
  if (/^nomi:\/\/project\/[A-Za-z0-9._-]{1,160}(?:\/run\/[A-Za-z0-9._-]{1,160}(?:\?artifact=[A-Za-z0-9._-]{1,160})?|\/node\/[A-Za-z0-9._-]{1,160})?$/.test(value)) return value
  return ''
}

function artifactVersionValue(value: Record<string, unknown>): number | null {
  return Number.isInteger(value.version) && Number(value.version) > 0 ? Number(value.version) : null
}

function buildArtifactBodyOutcome(
  ctx: Ctx,
  toolName: string,
  args: Record<string, unknown>,
  value: Record<string, unknown>,
  openInNomi: string,
  runId: string,
  projectId: string,
): ToolOutcome {
  const artifactId = str(value.artifactId) || str(args.artifactId)
  const kind = str(value.kind) || str(args.kind) || 'artifact'
  const status = str(value.status) || 'unknown'
  const version = artifactVersionValue(value)
  const contentHash = str(value.contentHash)
  const content = value.content === undefined ? undefined : safeArtifactValue(value.content)
  const bodyText = content === undefined ? null : JSON.stringify(content, null, 2)
  const preview = rec(value.preview)
  const previewUrl = str(preview.url)
  // 面收敛：修订/审阅并入 nomi_artifact_review（action=revise / approve|request_changes|reject）；读全文=nomi_read target=artifact_content。
  const isRevision = toolName === 'nomi_artifact_review' && str(args.action) === 'revise'
  const isReview = toolName === 'nomi_artifact_review' && (str(args.action) === 'approve' || str(args.action) === 'request_changes' || str(args.action) === 'reject')
  const head = isRevision
    ? L(ctx, '✓ 修订候选已创建', '✓ Revision candidate created')
    : isReview
      ? (status === 'adopted' || str(args.action) === 'approve'
          ? L(ctx, '✓ 产物版本已批准', '✓ Artifact version approved')
          : L(ctx, '✓ 产物审阅决定已记录', '✓ Artifact review decision recorded'))
      : `[Nomi] ${kind} · ${status}`
  const text = [
    `${head} · ${artifactId}`,
    `${L(ctx, '状态', 'status')} ${status}`,
    version !== null ? `${L(ctx, '版本', 'version')} ${version}` : null,
    contentHash ? `${L(ctx, '内容 hash', 'content hash')} ${contentHash}` : null,
    previewUrl ? `${L(ctx, '预览', 'preview')} ${previewUrl}` : null,
    isRevision && str(value.parentArtifactId) ? `${L(ctx, '基于', 'based on')} ${str(value.parentArtifactId)}${value.sourceVersion ? ` @${String(value.sourceVersion)}` : ''}` : null,
    bodyText ? `${L(ctx, '内容', 'content')}\n${bodyText}` : null,
  ].filter(Boolean).join('\n') + (openInNomi ? `\n${L(ctx, '在 Nomi 打开', 'Open in Nomi')} ${openInNomi}` : '')
  return {
    text,
    outcome: {
      kind: isRevision ? 'artifact_revision' : isReview ? 'artifact_review' : 'artifact',
      operation: isRevision ? 'revise' : isReview ? 'review' : 'read',
      runId, projectId, artifactId, artifactKind: kind, status,
      ...(version !== null ? { version } : {}),
      ...(contentHash ? { contentHash } : {}),
      ...(previewUrl ? { previewUrl } : {}),
      ...(str(value.parentArtifactId) ? { parentArtifactId: str(value.parentArtifactId) } : {}),
      ...(value.sourceVersion !== undefined ? { sourceVersion: value.sourceVersion } : {}),
      ...(content !== undefined ? { content } : {}),
      ...(openInNomi ? { openInNomi } : {}),
      nextActions: isRevision ? ['review_artifact'] : ['open_in_nomi'],
    },
  }
}

type DirectionCandidate = { key: string; title: string; oneLiner: string }

/** B1：从投影里挑出「waiting 的方向门 + 其候选」（用于转述三选一 + 结构化字段）。 */
function waitingDirectionGate(value: Record<string, unknown>): { gateId: string; candidates: DirectionCandidate[] } | null {
  const gates = Array.isArray(value.gates) ? (value.gates as Array<Record<string, unknown>>) : []
  const gate = gates.find((item) => str(item.gateId).startsWith('gate-direction-') && str(item.status) === 'waiting')
  if (!gate) return null
  const rawCandidates = Array.isArray(gate.directionCandidates) ? (gate.directionCandidates as Array<Record<string, unknown>>) : []
  const candidates = rawCandidates
    .map((candidate) => ({ key: str(candidate.key), title: str(candidate.title), oneLiner: str(candidate.oneLiner) }))
    .filter((candidate) => candidate.key && candidate.title)
  return { gateId: str(gate.gateId), candidates }
}

/** B1：候选清单转述（每行一句话方向 + 兜底「都不要，我来描述」）——给模型走 elicitation 前的原材料。 */
function directionCandidateLines(ctx: Ctx, candidates: DirectionCandidate[]): string[] {
  if (!candidates.length) return []
  return [
    L(ctx, '定方向（三选一，选完我再拟分镜）：', 'Pick a direction (choose one; I will draft the storyboard after):'),
    ...candidates.map((candidate) => `  · ${candidate.title} —— ${candidate.oneLiner}`),
    `  · ${L(ctx, '都不要，我来描述', 'None of these — I will describe my own')}`,
  ]
}

/** B2：waiting 的样片门 id（首镜出来了，等用户过目）。 */
function waitingSampleGateId(value: Record<string, unknown>): string | null {
  const gates = Array.isArray(value.gates) ? (value.gates as Array<Record<string, unknown>>) : []
  const gate = gates.find((item) => str(item.gateId).startsWith('gate-sample-') && str(item.status) === 'waiting')
  return gate ? str(gate.gateId) : null
}

/** P4 §3.2：waiting 的锚定妆照检查点（定妆照就绪，等真人过目后开拍镜头批）。 */
function waitingAnchorCheckpointGate(value: Record<string, unknown>): { gateId: string; jobIds: string[] } | null {
  const gates = Array.isArray(value.gates) ? (value.gates as Array<Record<string, unknown>>) : []
  const gate = gates.find((item) => isAnchorCheckpointGate({ gateId: str(item.gateId), scope: str(item.scope) })
    && str(item.status) === 'waiting')
  if (!gate) return null
  const jobIds = Array.isArray(gate.jobIds) ? gate.jobIds.map((id) => str(id)).filter(Boolean) : []
  return { gateId: str(gate.gateId), jobIds }
}

function waitingShotGate(value: Record<string, unknown>): {
  gateId: string
  jobId: string
  index: number
  nodeId: string
  provider: string
  model: string
} | null {
  const gates = Array.isArray(value.gates) ? value.gates as Array<Record<string, unknown>> : []
  const jobs = Array.isArray(value.jobs) ? value.jobs as Array<Record<string, unknown>> : []
  const gate = gates.find((item) => str(item.gateId).startsWith('gate-shot-')
    && str(item.scope) === 'job_set' && str(item.status) === 'waiting')
  const jobId = gate && Array.isArray(gate.jobIds) ? str(gate.jobIds[0]) : ''
  const index = jobs.findIndex((job) => str(job.jobId) === jobId)
  const job = index >= 0 ? jobs[index] : null
  if (!gate || !jobId || !job) return null
  return {
    gateId: str(gate.gateId),
    jobId,
    index: index + 1,
    nodeId: str(job.nodeId) || jobId,
    provider: str(job.provider),
    model: str(job.model),
  }
}

/** B3：信任档位人话标签（合同/状态/改档转述都用这一处）。 */
const TRUST_LABEL: Record<string, { zh: string; en: string }> = {
  key_confirm: { zh: '关键确认（默认，五门全开）', en: 'key confirmations (default; all gates on)' },
  budget_only: { zh: '只管钱（跳过创意与样片门）', en: 'budget only (skips creative + sample gates)' },
  confirm_all: { zh: '全程确认（每镜提交前都停）', en: 'confirm everything (stops before each shot)' },
}
function trustLabel(ctx: Ctx, level: string): string {
  const hint = TRUST_LABEL[level] || TRUST_LABEL.key_confirm
  return L(ctx, hint.zh, hint.en)
}

export type ToolOutcome = {
  /** CLI 文本（模型转述原材料）。null = 该工具维持 JSON 直出（画布低层工具）。 */
  text: string | null
  /** structuredContent.nomiOutcome：模型可靠读取的稳定字段。null = 不附加。 */
  outcome: Record<string, unknown> | null
}

const KEY_STATUS_LABEL: Record<string, { zh: string; en: string }> = {
  ok: { zh: '可用', en: 'usable' },
  missing: { zh: '未配 Key', en: 'no API key' },
  locked: { zh: 'Key 解不开', en: 'key locked' },
}

/** 一个模型的参考能力压成一句短标签（只在真能带参考时出，纯文生模型不占字）。 */
function referenceTag(ctx: Ctx, references: Record<string, unknown>): string {
  const kinds: string[] = []
  if (references.image) kinds.push(L(ctx, references.multiImage ? '多图' : '图', references.multiImage ? 'multi-image' : 'image'))
  if (references.video) kinds.push(L(ctx, '视频', 'video'))
  if (references.audio) kinds.push(L(ctx, '音频', 'audio'))
  if (kinds.length === 0) return ''
  const modes = Array.isArray(references.referenceModes) ? (references.referenceModes as string[]) : []
  const modeHint = modes.length ? `@${modes.join('/')}` : ''
  return `${L(ctx, '参考', 'refs')}:${kinds.join('+')}${modeHint}`
}

/** 交付1 · 模型清单 → 双语转述（按 keyStatus 分组，只有 ok 说可用）+ 结构化透传（模型精确读）。 */
function buildListModelsOutcome(ctx: Ctx, value: Record<string, unknown>): ToolOutcome {
  const models = Array.isArray(value.models) ? (value.models as Array<Record<string, unknown>>) : []
  if (models.length === 0) {
    return {
      text: L(ctx, '没有已启用的模型。请先在 Nomi 应用的模型接入里添加并配置 API Key。', 'No enabled models. Add and configure one in Nomi settings first.'),
      outcome: { kind: 'model_list', total: 0, usable: 0, models: [] },
    }
  }
  const line = (m: Record<string, unknown>): string => {
    const status = str(m.keyStatus) || 'missing'
    const label = KEY_STATUS_LABEL[status] || KEY_STATUS_LABEL.missing
    const refTag = referenceTag(ctx, rec(m.references))
    const head = `${str(m.vendor)} · ${str(m.modelKey)}（${str(m.label)}, ${str(m.kind)}）`
    const tail = status === 'ok'
      ? `✓ ${L(ctx, label.zh, label.en)}${refTag ? ' · ' + refTag : ''}`
      : `✗ ${L(ctx, label.zh, label.en)}——${str(m.statusReason)}`
    return `  ${head} ${tail}`
  }
  const usable = models.filter((m) => str(m.keyStatus) === 'ok')
  const blocked = models.filter((m) => str(m.keyStatus) !== 'ok')
  const text = [
    L(ctx, `可用模型 ${usable.length} 个（keyStatus=ok，选型只挑这些）：`, `${usable.length} usable model(s) (keyStatus=ok — pick from these):`),
    ...(usable.length ? usable.map(line) : [L(ctx, '  （无——请先配置 API Key）', '  (none — configure an API key first)')]),
    ...(blocked.length ? [L(ctx, `另有 ${blocked.length} 个已列出但暂不可用（缺 Key / Key 解不开）：`, `${blocked.length} listed but not usable (missing / locked key):`), ...blocked.map(line)] : []),
  ].join('\n')
  return {
    text,
    outcome: {
      kind: 'model_list',
      total: models.length,
      usable: usable.length,
      // 结构化原样透传逐模型真话字段（模型精确读，不必从文本抠）。
      models: models.map((m) => ({
        vendor: str(m.vendor), modelKey: str(m.modelKey), kind: str(m.kind), label: str(m.label),
        keyStatus: str(m.keyStatus) || 'missing', statusReason: str(m.statusReason),
        references: rec(m.references),
      })),
      nextActions: usable.length ? ['pick_model'] : ['configure_api_key'],
    },
  }
}

/** A2 · 生产类工具结果 → 文本 + 稳定结构化字段。 */
export function buildToolOutcome(
  toolName: string,
  args: Record<string, unknown>,
  result: unknown,
  locale: ResultLocale = 'zh-CN',
): ToolOutcome {
  const ctx: Ctx = { locale }
  const value = rec(result)
  const openInNomi = str(value.openInNomi)
  const runId = str(value.runId) || str(args.runId)
  const projectId = str(value.projectId) || str(args.projectId)
  const openLine = openInNomi ? `\n${L(ctx, '在 Nomi 打开', 'Open in Nomi')} ${openInNomi}` : ''

  // 面收敛：读侧全部并入 nomi_read（target 区分）；模型清单 = target=models。
  const readTarget = toolName === 'nomi_read' ? str(args.target) : ''
  if (toolName === 'nomi_read' && readTarget === 'models') {
    // 交付1：模型清单转述——**只把 keyStatus=ok 的说成"可用"**，missing/locked 各带缺口一句话（R15 双语）。
    // 参考能力也点出来（能带图/视频/音频/多图 + 哪个模式），让选型不必再猜。结构化字段原样透传给模型精确读。
    return buildListModelsOutcome(ctx, value)
  }

  if (toolName === 'nomi_run_start') {
    const brief = rec(args.brief)
    const goal = str(brief.goal)
    const duration = typeof brief.durationSeconds === 'number' ? `${brief.durationSeconds}s` : null
    const echo = echoLine(ctx, [
      str(args.playbook) || null,
      goal ? `${L(ctx, '目标', 'goal')}「${truncate(goal)}」` : null,
      duration,
    ])
    // B3：合同转述带信任档位——budget_only 时明说创意/样片门会自动过，agent 别再多问。
    const trustLevel = str(value.trustLevel) || 'key_confirm'
    const text = [
      `✓ ${L(ctx, '制作草稿已创建', 'Production draft created')} ${runId} · ${L(ctx, '未花费', 'nothing spent')}`,
      echo ? `  ${echo}` : null,
      `  ${L(ctx, '信任档位', 'Trust level')}：${trustLabel(ctx, trustLevel)}`,
      trustLevel === 'budget_only'
        ? L(ctx, '还没批准预算，也没有调用付费生成。已按「只管钱」自动跳过创意与样片门，下一步等预算门。', 'No budget approved and no paid generation yet. Under budget-only, creative and sample gates auto-approve — next stop is the budget gate.')
        : L(ctx, '还没批准预算，也没有调用付费生成。下一步：定创意方向。', 'No budget approved and no paid generation yet. Next: settle the creative direction.'),
    ].filter(Boolean).join('\n') + openLine
    return {
      text,
      outcome: {
        kind: 'run_draft', runId, projectId, trustLevel,
        params: { playbook: str(args.playbook), goal, durationSeconds: brief.durationSeconds ?? null },
        nextActions: ['pick_direction'],
        openInNomi: openInNomi || null,
      },
    }
  }

  if (toolName === 'nomi_read' && readTarget === 'run') {
    const status = str(value.status) || 'unknown'
    const hint = stalledDraftHint(value) ?? RUN_STATUS_HINT[status]
    const artifacts = Array.isArray(value.artifacts) ? (value.artifacts as Array<Record<string, unknown>>) : []
    const latest = artifacts.at(-1)
    const preview = latest ? rec(latest.preview) : {}
    const budget = rec(value.budget)
    const budgetLine = echoLine(ctx, [
      typeof budget.authorized === 'number' ? `${L(ctx, '预算上限', 'budget cap')} ${budget.authorized}` : null,
      typeof budget.actual === 'number' ? `${L(ctx, '已花费', 'spent')} ${budget.actual}` : null,
    ])
    // B1：方向门在等 + 已有候选 → 把三选一清单摊进转述（模型据此走 elicitation 问真人）。
    const direction = waitingDirectionGate(value)
    const candidateLines = direction ? directionCandidateLines(ctx, direction.candidates) : []
    // B2：样片门在等 → 提示样片就绪、去 Nomi 过目、满意批量 / 换风格重来（终端看不了图，给深链）。
    const sampleGateId = waitingSampleGateId(value)
    const sampleLines = sampleGateId ? [
      L(ctx, '样片就绪：首镜已生成，先过目再批量剩余镜头。', 'Sample ready: the first shot is generated — review it before the full batch.'),
      L(ctx, '  满意就批准继续；想改风格就否决（会暂停，改提示词后可继续）。', '  Approve to continue, or reject to pause and adjust the prompt.'),
    ] : []
    // P4 §3.2：定妆照检查点在等 → 指路「先看图再表态」（定妆照 = 本门 jobIds 对应的 artifacts）。
    const checkpoint = waitingAnchorCheckpointGate(value)
    const checkpointLines = checkpoint ? [
      L(ctx,
        '定妆照就绪：先过目再开拍。用 nomi_read（target=artifact）逐张预览本门 jobIds 对应的 artifacts，展示给用户看。',
        'Character stills ready: review before shooting. Preview the artifacts matching this gate\'s jobIds via nomi_read (target=artifact) and show them to the user.'),
      L(ctx,
        `  满意 → nomi_run_gate（action=decide, decision=approved）开拍剩余镜头（在已批预算内，不新增授权）；不满意 → rejected 停在检查点，可重出形象。门 id：${checkpoint.gateId}`,
        `  Happy → nomi_run_gate (action=decide, decision=approved) starts the remaining shots (within the approved budget, no new authorization); otherwise rejected keeps the batch parked for a re-shoot. Gate id: ${checkpoint.gateId}`),
    ] : []
    const shotGate = waitingShotGate(value)
    const shotTarget = shotGate ? [shotGate.provider, shotGate.model].filter(Boolean).join(' · ') : ''
    const shotLines = shotGate ? [
      L(ctx,
        `第 ${shotGate.index} 镜（${shotGate.nodeId}）提交前正在等你确认。`,
        `Shot ${shotGate.index} (${shotGate.nodeId}) is waiting for approval before provider submission.`),
      L(ctx,
        `  ${shotTarget ? `${shotTarget}；` : ''}批准前不会调用供应商，也不会产生这镜的费用。请回 Nomi 决定。`,
        `  ${shotTarget ? `${shotTarget}; ` : ''}no provider call or charge occurs before approval. Decide in Nomi.`),
    ] : []
    const jobsArr = Array.isArray(value.jobs) ? (value.jobs as Array<Record<string, unknown>>) : []
    const unknownJobs = jobsArr.filter((job) => str(job.status) === 'submission_unknown')
    const recoveryProfile = value.providerCapabilityProfile === 'full_recovery' || value.providerCapabilityProfile === 'observe_only'
      ? value.providerCapabilityProfile
      : 'submit_only'
    const recovery = unknownJobs.length
      ? projectGenerationRecovery({ state: 'submission_unknown', profile: recoveryProfile, locale: ctx.locale })
      : undefined
    const reconciliationLines = unknownJobs.length ? [
      L(ctx,
        `有 ${unknownJobs.length} 个任务的供应商状态还没核实；正在等待对账，Nomi 不会自动重提。`,
        `${unknownJobs.length} job(s) have an unverified provider state; waiting for reconciliation and no automatic resubmit.`,
      ),
      `  ${recovery?.message}`,
    ] : []
    // B3：状态转述带当前信任档位（非默认时才占一行，避免默认档噪音）。
    const trustLevel = str(value.trustLevel) || 'key_confirm'
    const text = [
      `[Nomi] ${runId} · ${hint ? L(ctx, hint.zh, hint.en) : status} · ${str(value.stageId) || 'unknown'}`,
      budgetLine ? `  ${budgetLine}` : null,
      trustLevel !== 'key_confirm' ? `  ${L(ctx, '信任档位', 'Trust level')}：${trustLabel(ctx, trustLevel)}` : null,
      preview.url ? `${L(ctx, '最新预览', 'Latest preview')} ${str(preview.url)}（${str(preview.expiresAt) || L(ctx, '限时', 'expiring')}）` : null,
      ...candidateLines,
      ...sampleLines,
      ...checkpointLines,
      ...shotLines,
      ...reconciliationLines,
      hint ? L(ctx, hint.nextZh, hint.nextEn) : null,
    ].filter(Boolean).join('\n') + openLine
    return {
      text,
      outcome: {
        kind: 'run_status', runId, projectId, status, stageId: str(value.stageId) || null, trustLevel,
        budget: { authorized: budget.authorized ?? null, actual: budget.actual ?? null },
        latestPreviewUrl: str(preview.url) || null,
        ...(direction && direction.candidates.length ? { directionGateId: direction.gateId, directionCandidates: direction.candidates } : {}),
        ...(sampleGateId ? { sampleGateId } : {}),
        ...(checkpoint ? { anchorCheckpointGateId: checkpoint.gateId, anchorCheckpointJobIds: checkpoint.jobIds } : {}),
        ...(shotGate ? { shotGateId: shotGate.gateId, shotJobId: shotGate.jobId } : {}),
        ...(recovery ? { recovery } : {}),
        nextActions: recovery
          ? ['wait_reconciliation']
          : direction && direction.candidates.length
          ? ['decide_direction']
          : sampleGateId
            ? ['review_sample']
            : checkpoint
              ? ['review_anchor_checkpoint']
              : shotGate
                ? ['review_shot_in_nomi']
                : hint
                  ? [hint.action]
                  : [],
        openInNomi: openInNomi || null,
      },
    }
  }

  if (toolName === 'nomi_read' && readTarget === 'run_events') {
    const events = Array.isArray(value.events) ? (value.events as Array<Record<string, unknown>>) : []
    const lines = events.map((event) => `[Nomi] ${str(event.type) || 'event'} · ${str(event.message)}`)
    const text = `${lines.length ? lines.join('\n') : `[Nomi] ${L(ctx, '暂无新的重要事件', 'no new meaningful events')}`}\nnext cursor ${String(value.nextCursor ?? 0)}`
    return {
      text,
      outcome: {
        kind: 'run_events', runId, projectId,
        eventCount: events.length, nextCursor: value.nextCursor ?? 0,
        nextActions: events.length ? [] : ['wait_or_poll'],
      },
    }
  }

  if (toolName === 'nomi_read' && readTarget === 'artifact') {
    const preview = rec(value.preview)
    const nomiUri = str(value.nomiUri)
    const artifactOpenInNomi = safeNomiDeepLink(openInNomi)
    const text = [
      `[Nomi] ${str(value.kind) || 'artifact'} · ${str(value.status) || 'unknown'} · ${str(value.artifactId)}`,
      nomiUri ? `${L(ctx, '产物', 'Artifact')} ${nomiUri}` : null,
      preview.url ? `${L(ctx, '预览', 'Preview')} ${str(preview.url)}（${str(preview.expiresAt) || L(ctx, '限时', 'expiring')}）` : null,
    ].filter(Boolean).join('\n') + (artifactOpenInNomi ? `\n${L(ctx, '在 Nomi 打开', 'Open in Nomi')} ${artifactOpenInNomi}` : '')
    return {
      text,
      outcome: {
        kind: 'artifact', runId, projectId,
        artifactId: str(value.artifactId), artifactKind: str(value.kind) || null,
        previewUrl: str(preview.url) || null, nomiUri: nomiUri || null,
        nextActions: ['open_in_nomi'],
        openInNomi: artifactOpenInNomi || null,
      },
    }
  }

  // 面收敛：读全文（target=artifact_content）与审阅/修订（nomi_artifact_review 任意 action）共用 body 转述。
  if ((toolName === 'nomi_read' && readTarget === 'artifact_content') || toolName === 'nomi_artifact_review') {
    return buildArtifactBodyOutcome(ctx, toolName, args, value, safeNomiDeepLink(openInNomi), runId, projectId)
  }

  // 面收敛：物化落地并入 nomi_run_gate（action=materialize）。
  if (toolName === 'nomi_run_gate' && str(args.action) === 'materialize') {
    const artifactId = str(value.artifactId) || str(args.artifactId)
    const rawArtifactVersion = value.artifactVersion
    const version = artifactVersionValue(value)
      ?? (Number.isInteger(rawArtifactVersion) && Number(rawArtifactVersion) > 0 ? Number(rawArtifactVersion) : null)
    const createdNodeIds = Array.isArray(value.createdNodeIds)
      ? value.createdNodeIds.filter((nodeId): nodeId is string => typeof nodeId === 'string' && Boolean(nodeId.trim()))
      : []
    const bindings = Array.isArray(value.bindings) ? value.bindings : []
    const text = [
      `✓ ${L(ctx, '分镜已落到 Nomi 画布', 'Storyboard materialized into the Nomi canvas')} · ${artifactId}`,
      version !== null ? `${L(ctx, '分镜版本', 'storyboard version')} ${version}` : null,
      `${L(ctx, '画布节点', 'canvas nodes')} ${createdNodeIds.length} · ${L(ctx, '制作绑定', 'production bindings')} ${bindings.length}`,
      createdNodeIds.length ? `${L(ctx, '节点 id', 'node ids')} ${createdNodeIds.slice(0, 12).join(', ')}${createdNodeIds.length > 12 ? '…' : ''}` : null,
      L(ctx, '还没有批准预算，也没有调用付费模型；下一步在 Nomi 查看画布并批准制作合同。', 'No budget was approved and no paid model was called; next, review the canvas in Nomi and approve the production contract.'),
    ].filter(Boolean).join('\n') + openLine
    return {
      text,
      outcome: {
        kind: 'storyboard_materialized', operation: 'materialize', runId, projectId, artifactId,
        ...(version !== null ? { version } : {}),
        createdNodeIds, bindingCount: bindings.length,
        status: str(value.status) || null,
        nextActions: ['open_in_nomi', 'approve_contract'],
        openInNomi: openInNomi || null,
      },
    }
  }

  if (toolName === 'nomi_run_control' && str(args.action) === 'set_trust') {
    // B3 改档转述：报新档位 + 它意味着什么（budget_only=接下来创意/样片门不再打扰；预算门仍在）。
    const trustLevel = str(args.trustLevel) || 'key_confirm'
    const text = [
      `✓ ${L(ctx, '信任档位已改为', 'Trust level set to')}：${trustLabel(ctx, trustLevel)} · ${runId}`,
      trustLevel === 'budget_only'
        ? L(ctx, '接下来的创意方向门与样片门会自动通过；预算门仍会请示，不会偷偷花钱。', 'Creative direction and sample gates will auto-approve from here; the budget gate still asks — nothing is spent silently.')
        : trustLevel === 'confirm_all'
          ? L(ctx, '每镜提交前都会停下确认。', 'The run will stop before each shot for confirmation.')
          : L(ctx, '五门全开，逐项确认。', 'All gates are on; you confirm each step.'),
    ].filter(Boolean).join('\n') + openLine
    return {
      text,
      outcome: {
        kind: 'run_control', runId, projectId, action: 'set_trust', trustLevel,
        nextActions: [],
      },
    }
  }

  if (toolName === 'nomi_run_control') {
    const action = str(args.action)
    const status = str(value.status)
    const hint = RUN_STATUS_HINT[status]
    const budget = rec(value.budget)
    // 诚实敞口（D4）：已提交给供应商的任务收不回、钱已花——如实报数量，别让用户以为「停=零损失」。
    const jobsArr = Array.isArray(value.jobs) ? (value.jobs as Array<Record<string, unknown>>) : []
    const inFlight = jobsArr.filter((job) => ACTIVE_JOB_STATUSES.includes(str(job.status))).length
    const done = action === 'pause'
      ? (status === 'pausing' ? L(ctx, '✓ 正在暂停', '✓ Pausing') : L(ctx, '✓ 已暂停', '✓ Paused'))
      : action === 'resume'
        ? L(ctx, '✓ 已继续', '✓ Resumed')
        : action === 'cancel'
          ? L(ctx, '✓ 已取消', '✓ Cancelled')
          : `✓ ${action}`
    const exposure = inFlight > 0 && (action === 'pause' || action === 'cancel')
      ? L(ctx,
          `⚠ ${inFlight} 个已提交的任务无法撤回，会跑完并计费${action === 'pause' ? '；完成后自动落停' : ''}（结果保留，不浪费已花的钱）`,
          `⚠ ${inFlight} submitted job(s) cannot be recalled and will finish and bill${action === 'pause' ? '; the run settles to paused afterwards' : ''} (results are kept)`)
      : null
    const text = [
      `${done} · ${runId}${str(value.stageId) ? ` · ${str(value.stageId)}` : ''}`,
      exposure,
      echoLine(ctx, [
        typeof budget.actual === 'number' ? `${L(ctx, '已花费', 'spent')} ${budget.actual}` : null,
        action === 'pause' ? L(ctx, '未提交的任务不再提交、不计费', 'unsubmitted jobs will not be submitted or charged') : null,
        action === 'cancel' ? L(ctx, '已完成的产物保留在项目里', 'finished artifacts stay in the project') : null,
      ]),
      hint ? L(ctx, hint.nextZh, hint.nextEn) : null,
    ].filter(Boolean).join('\n') + openLine
    return {
      text,
      outcome: {
        kind: 'run_control', runId, projectId, action, status: status || null,
        budget: { actual: budget.actual ?? null },
        inFlightJobs: inFlight,
        nextActions: hint ? [hint.action] : [],
      },
    }
  }

  // 面收敛：可逆创意门表态并入 nomi_run_gate（action=decide）。
  if (toolName === 'nomi_run_gate' && str(args.action) === 'decide') {
    // B1：门决议回执。方向门批准 → 报选中方向 + 下一步（拟分镜）；否决 → 报「不变、可重来」。
    const decision = str(args.decision)
    const gateId = str(args.gateId)
    const status = str(value.status)
    const hint = RUN_STATUS_HINT[status]
    const isDirection = gateId.startsWith('gate-direction-')
    // 决议后该门已非 waiting → 直接按 gateId 找它（任意状态），从其候选里解析选中项报出。
    const gates = Array.isArray(value.gates) ? (value.gates as Array<Record<string, unknown>>) : []
    const decidedGate = gates.find((item) => str(item.gateId) === gateId)
    const gateCandidates = decidedGate && Array.isArray(decidedGate.directionCandidates)
      ? (decidedGate.directionCandidates as Array<Record<string, unknown>>).map((candidate) => ({ key: str(candidate.key), title: str(candidate.title), oneLiner: str(candidate.oneLiner) }))
      : []
    const chosenKey = str(args.choiceKey) || (decidedGate ? str(decidedGate.decidedChoiceKey) : '')
    const chosen = isDirection && chosenKey
      ? gateCandidates.find((candidate) => candidate.key === chosenKey)
      : undefined
    const isSample = gateId.startsWith('gate-sample-')
    // P4 §3.2：定妆照检查点回执——批准即批次自动续跑（service 钩子已重踢 scheduler，agent 不用再做别的）。
    const isCheckpoint = gateId.startsWith('gate-anchor-checkpoint-')
    const head = decision === 'approved'
      ? (isDirection ? L(ctx, '✓ 方向已定', '✓ Direction settled')
        : isSample ? L(ctx, '✓ 样片通过，批量生成剩余镜头', '✓ Sample approved — generating the rest')
        : isCheckpoint ? L(ctx, '✓ 定妆照通过，开拍镜头批次', '✓ Stills approved — shooting the shot batch')
        : L(ctx, '✓ 已批准', '✓ Approved'))
      : (isSample ? L(ctx, '✓ 样片打回，已暂停', '✓ Sample rejected — run paused')
        : isCheckpoint ? L(ctx, '✓ 定妆照打回，批次停在检查点', '✓ Stills rejected — batch parked at the checkpoint')
        : L(ctx, '✓ 已否决', '✓ Rejected'))
    const text = [
      `${head} · ${gateId}`,
      chosen ? `  ${chosen.title} —— ${chosen.oneLiner}` : null,
      decision === 'rejected' && isDirection ? L(ctx, '方向未变，可重新给方案或让用户自己描述。', 'Direction unchanged; propose again or let the user describe their own.') : null,
      decision === 'rejected' && isSample ? L(ctx, '已生成的样片保留；改提示词后从这里继续，不重付已花的。', 'The generated sample is kept; adjust the prompt and resume — no double charge.') : null,
      decision === 'approved' && isCheckpoint ? L(ctx, '剩余镜头已自动开拍（已批预算内），用 nomi_read（target=run）看进度。', 'The remaining shots are already generating (within the approved budget); track with nomi_read (target=run).') : null,
      decision === 'rejected' && isCheckpoint ? L(ctx, '定妆照保留、镜头不开拍不扣费；重出形象后会再开一道检查点。', 'The stills are kept; no shot generates or charges. Re-shoot the look and a fresh checkpoint opens.') : null,
      hint ? L(ctx, hint.nextZh, hint.nextEn) : null,
    ].filter(Boolean).join('\n') + openLine
    return {
      text,
      outcome: {
        kind: 'gate_decision', runId, projectId, gateId, decision,
        ...(chosen ? { choiceKey: chosen.key } : {}),
        status: status || null,
        nextActions: hint ? [hint.action] : [],
        openInNomi: openInNomi || null,
      },
    }
  }

  return { text: null, outcome: null }
}

/** A1 · 长任务的进度起始帧（参数回显版「已受理 · kling · video」）；null = 该工具不发。 */
export function buildProgressStartMessage(
  toolName: string,
  args: Record<string, unknown>,
  locale: ResultLocale = 'zh-CN',
): string | null {
  const ctx: Ctx = { locale }
  if (toolName === 'nomi_run_start') {
    return [L(ctx, '正在创建制作草稿', 'creating production draft'), str(args.playbook) || null]
      .filter(Boolean).join(' · ')
  }
  return null
}
