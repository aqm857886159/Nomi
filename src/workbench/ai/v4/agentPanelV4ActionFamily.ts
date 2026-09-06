// Agent 面板 v4 · capability → icon 家族的**唯一**映射。
//
// 定稿 Process 板的规则是「icon 标**动的那个对象**」（文稿 / 时间轴 / 节点 / 图 / 视频 /
// 音频 / 剪辑 / 转场字幕音量 / 技能 / 起草 / 导出），不是工具名。所以这张表的键是
// **契约 id**（`timeline.write`、`canvas.delete`…）而不是工具别名：同一个能力在 pi 侧叫
// `apply_edit_plan`、在 MCP 侧叫 `nomi_timeline_edit`，按名字匹配就是让这张表跟着别名漂。
// `resolveCapabilityAlias` 已经是那个「一个名字不动」的收口处，这里接着它往下走。
//
// 为什么不并进 `residentToolDisplay.ts`：那份表回答的是「这一行写什么字」，这份回答的是
// 「这一行画哪个 icon」。两件事共用一个 `switch` 时，加一个新 icon 家族就得动文案分支，
// 而文案分支有 452 行。分开之后 icon 家族的唯一 owner 是 `AgentPanelV4Icons.ACTION_ICONS`
// 的键集，TypeScript 会在这里替我们对齐。
import { resolveCapabilityAlias } from '../../../../electron/shared/agentCapabilities/registry'
import type { V4ActionFamily } from './agentPanelV4Types'

/** 契约 id → 家族。缺省项走 `refineByOperation` / `FALLBACK`。 */
const CAPABILITY_ACTION_FAMILY: Readonly<Record<string, V4ActionFamily>> = {
  'document.read': 'document',
  'document.write': 'document',
  'timeline.read': 'timeline',
  'timeline.write': 'edit',
  'canvas.read': 'canvas',
  'canvas.write': 'canvas',
  'canvas.delete': 'canvas',
  'skill.read': 'skill',
  'skill.write': 'skill',
  'asset.read': 'attachment',
  'export.read': 'export',
  'export.write': 'export',
  'layout.read': 'layout',
  'layout.write': 'layout',
  'generation.context.read': 'canvas',
  'generation.plan': 'plan',
  'generation.gate': 'spend',
  'generation.control': 'video',
  'generation.run.read': 'search',
  'production.run.read': 'search',
  'production.run.write': 'video',
  'production.artifact.write': 'image',
}

/**
 * 时间轴上的「剪辑」和「转场 / 字幕 / 音量」在定稿里是**两个** icon。契约 id 只到
 * `timeline.write`，分不出来——分辨它们的信息在 `args.operation` 里，那也是能力契约自己
 * 用来区分 effectClass 的同一个字段（`operationEffectClasses`）。用同一个字段，不另立判据。
 */
const TRANSITION_OPERATIONS = /transition|caption|subtitle|volume|audio_level|fade/

/** 生成类能力动的是图 / 视频 / 音频，具体哪种由请求自己说。说不清就不猜。 */
function mediaFamily(record: Readonly<Record<string, unknown>>): V4ActionFamily | undefined {
  const hay = [record.kind, record.mediaKind, record.modelKind, record.operation, record.assetKind]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase()
  if (!hay) return undefined
  if (hay.includes('video')) return 'video'
  if (hay.includes('audio') || hay.includes('music') || hay.includes('voice')) return 'audio'
  if (hay.includes('image') || hay.includes('frame') || hay.includes('picture')) return 'image'
  return undefined
}

function asRecord(args: unknown): Readonly<Record<string, unknown>> {
  return args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : {}
}

/**
 * 最后的兜底是 `think`（脑子那个 icon），不是 `search` 也不是一个通用齿轮：
 * 一行收据说不出它动了什么对象时，诚实的说法是「Nomi 在想事情」，而不是假装它在搜索。
 */
const FALLBACK: V4ActionFamily = 'think'

/**
 * 一次工具调用属于哪个 icon 家族。
 * `capabilityId` 传契约 id（终态 tool item 上就是它）；传工具别名也行，会先过 registry。
 */
export function actionFamilyForCapability(capabilityId: string, args?: unknown): V4ActionFamily {
  const canonical = resolveCapabilityAlias(capabilityId)?.contract.id ?? capabilityId
  const record = asRecord(args)
  const operation = typeof record.operation === 'string' ? record.operation.toLowerCase() : ''
  if (canonical === 'timeline.write') {
    return TRANSITION_OPERATIONS.test(operation) ? 'transition' : 'edit'
  }
  if (canonical.startsWith('generation.') || canonical.startsWith('production.')) {
    const media = mediaFamily(record)
    if (media) return media
  }
  return CAPABILITY_ACTION_FAMILY[canonical] ?? FALLBACK
}

/** 介入槽的 icon 家族：付费 / 缺凭证 / 反问三种自己有家，其余跟着能力走。 */
export function actionFamilyForIntervention(
  kind: 'spend' | 'credential' | 'question' | 'capability',
  capabilityId: string,
  args?: unknown,
): V4ActionFamily {
  if (kind === 'spend') return 'spend'
  if (kind === 'credential') return 'credential'
  if (kind === 'question') return 'question'
  return actionFamilyForCapability(capabilityId, args)
}
