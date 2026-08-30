import React from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { cn } from '../../../utils/cn'
import { WorkbenchButton } from '../../../design'
import type { ReconcileDeviation } from '../agent/reconcile'
import { SHOT_VERIFY_DIMENSIONS, type ShotVerifyDimensionKey } from '../agent/shotVerify'

type ReconcileDeviationCardProps = {
  deviations: ReconcileDeviation[]
  /** 一键整笔撤销(S6-2 后整笔提议=一个 undo barrier,一次 undo 即全退)。
   *  内容偏差卡(画面校验)不传:verify 没改任何东西,无可撤销。 */
  onUndoAll?: () => void
  onDismiss: () => void
  /** 让 AI 用模型支持的方式把没接上的连接重连;内容偏差=发修复消息让 AI 改 prompt/重生(走确认闸)。 */
  onAiFix?: () => void
  /** 半自动闭环预算耗尽(Stage 2):隐藏「让 AI 修」、改显「已尽力」提示,绝不无限回灌。 */
  exhausted?: boolean
  /** 时间线内嵌(方案三):去外框,导轨提供视觉结构。 */
  flat?: boolean
}

const trunc = (value: unknown, max = 40): string => {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** 边类偏差:where 已是「源标题」→「目标标题」,正文不再重复 field。 */
const isEdgeField = (field: string): boolean => field === '引用边' || field === '边语义'

/** 一条偏差的人话正文:内容(画面校验)→直接显原因;边→为什么没接上;其余结构→批准 vs 实际。 */
function detailLine(d: ReconcileDeviation, t: TFunction): string {
  if (d.kind === 'content') {
    return d.reason
      ? localizedContentReason(d.reason, t)
      : t('generationCommon.reconcile.contentMismatch', { actual: localizedValue(d.actual, t) })
  }
  if (d.field === '引用边') {
    return d.reason
      ? t('generationCommon.reconcile.edgeReason', { reason: localizedReason(d.reason, t) })
      : t('generationCommon.reconcile.edgeMissing')
  }
  if (d.field === '边语义') {
    return t('generationCommon.reconcile.edgeSemantics', {
      actual: localizedValue(d.actual, t),
      expected: localizedValue(d.expected, t),
    })
  }
  if (d.field === '节点') {
    return t('generationCommon.reconcile.nodeChange', {
      expected: localizedValue(d.expected, t),
      actual: localizedValue(d.actual, t),
    })
  }
  return t('generationCommon.reconcile.approvedActual', {
    expected: localizedValue(d.expected, t),
    actual: localizedValue(d.actual, t),
  })
}

function fieldLabel(field: string, t: TFunction): string {
  if (field === '引用边') return t('generationCommon.reconcile.fields.referenceEdge')
  if (field === '边语义') return t('generationCommon.reconcile.fields.edgeSemantics')
  if (field === '节点') return t('generationCommon.reconcile.fields.node')
  if (field === '类型') return t('generationCommon.reconcile.fields.type')
  if (field === '提示词') return t('generationCommon.reconcile.fields.prompt')
  if (field === '标题') return t('generationCommon.reconcile.fields.title')
  if (field === '模型') return t('generationCommon.reconcile.fields.model')
  if (field.startsWith('参数 ')) {
    return t('generationCommon.reconcile.fields.parameter', { name: field.slice('参数 '.length) })
  }
  if (field.startsWith('数组参考槽 ')) {
    return t('generationCommon.reconcile.fields.arrayReferenceSlot', { name: field.slice('数组参考槽 '.length) })
  }
  // 内容偏差(画面校验)的 field 是轴名,同样得译——此前直落 `return field`,英文界面上原样显中文。
  return localizedDimensionName(field, t)
}

const DEVIATION_VALUE_KEYS: Record<string, string> = {
  已连接: 'connected',
  未连接: 'notConnected',
  '(通用参考)': 'genericReference',
  已创建: 'created',
  不存在: 'missing',
  '(回退自动选)': 'autoFallback',
  '(默认值)': 'defaultValue',
  存在: 'exists',
  已删除: 'deleted',
  仍存在: 'stillExists',
  有对应已提交边: 'committedEdge',
  画布内来源应建成有序边: 'edgeBackedSource',
  显示出边参考但无边: 'orphanEdgeReference',
  'meta-only 残留（无边有图）': 'orphanMeta',
  '与设定/描述一致': 'matchesBrief',
}

const DEVIATION_REASON_KEYS: Record<string, string> = {
  所选模型不支持这种参考连接: 'unsupportedReference',
  源节点没有可作参考的产物: 'sourceNotReferenceable',
  连接的一端节点找不到: 'dangling',
}

/**
 * 画面校验(shotVerify)三轴的中文源串 → i18n 键。**derive 自 SHOT_VERIFY_DIMENSIONS**,不手抄第二份:
 * 轴改名时这张表跟着变,不会出现「轴名改了、译名没跟上」的静默漏译。
 *
 * 为什么在这一层译而不是在产出侧:`deviationsFromVerdict` 与 electron/capabilityCore 那份有
 * **逐字节相等**的等价性单测(shotVerify.equivalence.test.ts),核心必须与界面语言无关;
 * 所以核心只产稳定中文源串,翻译一律在这个显示边界做——与结构偏差用的那套词表同一个做法。
 */
const DIMENSION_NAME_KEYS: Record<string, ShotVerifyDimensionKey> = Object.fromEntries(
  SHOT_VERIFY_DIMENSIONS.map((d) => [d.name, d.key]),
) as Record<string, ShotVerifyDimensionKey>

/** `第 N 档`:产出侧拼出来的稳定格式(不是自由文本),显示时按语种重排。 */
const TIER_VALUE = /^第\s*(\d+)\s*档$/
/** `<轴名>不达标(第 N 档)`:判官没给理由时产出侧拼的兜底句,同样是稳定格式。 */
const FALLBACK_REASON = /^(.+?)不达标\(第\s*(\d+)\s*档\)$/

function localizedDimensionName(name: string, t: TFunction): string {
  const key = DIMENSION_NAME_KEYS[name]
  return key
    ? t(`generationCommon.reconcile.fields.${key}` as 'generationCommon.reconcile.fields.identity')
    : name
}

/** 内容偏差的原因:兜底句按语种重组;判官自己写的理由原样显示(它的语言由判官 prompt 决定)。 */
function localizedContentReason(reason: unknown, t: TFunction): string {
  const text = String(reason ?? '')
  const match = FALLBACK_REASON.exec(text)
  if (!match) return text
  return t('generationCommon.reconcile.contentFallbackReason', {
    dimension: localizedDimensionName(match[1], t),
    n: Number(match[2]),
  })
}

function localizedValue(value: unknown, t: TFunction): string {
  const text = trunc(value)
  const valueKey = DEVIATION_VALUE_KEYS[text]
  if (valueKey) {
    return t(`generationCommon.reconcile.values.${valueKey}` as 'generationCommon.reconcile.values.connected')
  }
  const tier = TIER_VALUE.exec(text)
  if (tier) return t('generationCommon.reconcile.values.tier', { n: Number(tier[1]) })
  return text
}

function localizedReason(reason: unknown, t: TFunction): string {
  const text = String(reason ?? '')
  const reasonKey = DEVIATION_REASON_KEYS[text]
  return reasonKey
    ? t(`generationCommon.reconcile.reasons.${reasonKey}` as 'generationCommon.reconcile.reasons.unsupportedReference')
    : text
}

/**
 * 对账偏差卡(S6-3,N12 → 2026-06-13 完整版重设计):用节点标题+人话说明「哪些没按计划生效、
 * 为什么」,而不是甩原始 id + 黑话。正常对账一致时永不出现——它是诚实纪律的兜底面,不是常驻 UI。
 */
export default function ReconcileDeviationCard({
  deviations,
  onUndoAll,
  onDismiss,
  onAiFix,
  exhausted = false,
  flat = false,
}: ReconcileDeviationCardProps): JSX.Element {
  const { t } = useTranslation()
  const hasEdgeMiss = deviations.some((d) => d.field === '引用边')
  const hasContentMiss = deviations.some((d) => d.kind === 'content')
  const hasStructural = deviations.some((d) => d.kind !== 'content')
  // 「让 AI 修」对结构边丢失=重连边;对画面偏差=改 prompt/重生(走确认闸)。预算耗尽则不再给。
  const showAiFix = Boolean(onAiFix) && (hasEdgeMiss || hasContentMiss) && !exhausted
  // 撤销只对结构偏差有意义(verify 没改东西);内容偏差卡无可撤销。
  const showUndo = Boolean(onUndoAll) && hasStructural
  const captionText = hasContentMiss
    ? t('generationCommon.reconcile.contentCaption')
    : t('generationCommon.reconcile.structuralCaption')
  return (
    <div
      className={cn('flex flex-col gap-2', flat ? '' : 'p-3 rounded-nomi border border-nomi-line bg-nomi-paper')}
      data-reconcile-deviation-card="true"
      aria-label={t('generationCommon.reconcile.aria')}
    >
      <div className={cn('text-caption text-nomi-ink-60')}>{captionText}</div>
      <ul className={cn('flex flex-col gap-1 list-none p-0 m-0')}>
        {deviations.map((deviation, index) => (
          <li key={index} className={cn('flex flex-col gap-[2px] p-2 rounded-nomi-sm bg-nomi-ink-05 text-caption')}>
            <span className={cn('text-nomi-ink font-medium')}>
              {deviation.where}
              {isEdgeField(deviation.field) ? '' : ` · ${fieldLabel(deviation.field, t)}`}
            </span>
            <span className={cn('text-nomi-ink-60')}>{detailLine(deviation, t)}</span>
          </li>
        ))}
      </ul>
      {exhausted ? (
        <div className={cn('text-caption text-nomi-ink-40')}>{t('generationCommon.reconcile.exhausted')}</div>
      ) : null}
      {/* flex-wrap + shrink-0:按钮在窄面板放不下时整组换行,不挤压不竖排。 */}
      <div className={cn('flex flex-wrap items-center gap-2')}>
        {showAiFix ? (
          <WorkbenchButton
            className={cn('shrink-0')}
            variant="accent"
            size="sm"
            data-reconcile-ai-fix="true"
            onClick={onAiFix}
          >
            {t('generationCommon.reconcile.aiFix')}
          </WorkbenchButton>
        ) : null}
        <div className={cn('flex items-center gap-2 ml-auto')}>
          <WorkbenchButton className={cn('shrink-0')} variant="default" size="sm" onClick={onDismiss}>
            {showUndo ? t('generationCommon.reconcile.keep') : t('generationCommon.reconcile.acknowledge')}
          </WorkbenchButton>
          {showUndo ? (
            <WorkbenchButton
              className={cn('shrink-0')}
              variant="primary"
              size="sm"
              data-reconcile-undo-all="true"
              onClick={onUndoAll}
            >
              {t('generationCommon.reconcile.undo')}
            </WorkbenchButton>
          ) : null}
        </div>
      </div>
    </div>
  )
}
