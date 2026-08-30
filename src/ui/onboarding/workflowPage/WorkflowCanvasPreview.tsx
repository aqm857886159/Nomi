/**
 * 「画布节点预览 · 实时」：这条工作流在生成画布上会长成什么样，当场画出来、可填、可试跑。
 * plan: docs/plan/2026-08-12-model-settings-home-and-comfyui-workflow-page.md
 *
 * 为什么值得占左栏一格（D1 effect-first）：配完绑定到「知道自己配出了什么」中间隔着
 * 保存 → 关设置 → 建节点 → 选模型 四步，配错要走完全程才发现。把结果搬到手边，改一下看见一下。
 *
 * 控件清单由 buildCanvasPreview 纯函数算（口径与画布一致，见那份文件头），这里只负责画 + 收值。
 *
 * 「运行测试」是**真跑**，不是假的连通检查：走既有 runWorkbenchTaskByVendor（后端零改动），
 * 把用户填的值当 extras 发给这台 ComfyUI。本地后端不花钱，所以默认就给真效果。
 * 媒体槽（首帧/尾帧/源视频）试跑时不带素材——那需要先上传资产，属于画布的活；
 * 槽位仍然画出来，并明说「试跑不带素材」（D4：缺口明着标，不藏）。
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconPlayerPlay } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import { translateModelDisplayText } from '../../../i18n/modelDisplayText'
import { NomiSelect } from '../../../design'
import type { PreviewField } from '../comfyuiCanvasPreview'
import { ROLE_TONES } from './roleTone'

type WorkflowCanvasPreviewProps = {
  fields: PreviewField[]
  isEmpty: boolean
  values: Record<string, string>
  onChangeValue: (key: string, value: string) => void
  /** 试跑被挡住的原因（null = 可以跑）。C1：挡住就 disabled + title 说清为什么。 */
  blockedReason: string | null
  running: boolean
  onRun: () => void
}

const MEDIA_LABEL_KEY: Record<'image' | 'video', string> = {
  image: 'comfyuiWorkflowPage.preview.mediaImage',
  video: 'comfyuiWorkflowPage.preview.mediaVideo',
}

export function WorkflowCanvasPreview({
  fields,
  isEmpty,
  values,
  onChangeValue,
  blockedReason,
  running,
  onRun,
}: WorkflowCanvasPreviewProps): JSX.Element {
  const { t } = useTranslation()

  return (
    <section
      className="flex shrink-0 flex-col gap-2 rounded-nomi border border-nomi-line bg-nomi-paper p-2.5"
      data-workflow-preview
      aria-label={t('comfyuiWorkflowPage.preview.title')}
    >
      <div className="flex items-center gap-1.5">
        <span className="flex-1 text-micro font-semibold text-nomi-ink-40">{t('comfyuiWorkflowPage.preview.title')}</span>
        <span className="rounded-full bg-nomi-accent-soft px-1.5 text-micro font-semibold text-nomi-accent">
          {t('comfyuiWorkflowPage.preview.live')}
        </span>
      </div>

      {isEmpty ? (
        <p className="text-micro leading-relaxed text-nomi-ink-40">{t('comfyuiWorkflowPage.preview.empty')}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {fields.map((field) => (
            <PreviewControl
              key={field.key}
              field={field}
              value={values[field.key]}
              onChange={(next) => onChangeValue(field.key, next)}
            />
          ))}
        </div>
      )}

      {/* 禁用的 <button> 自己不触发 title（浏览器行为）→ 外层包一层（设计系统 §1.6 C1 的既有范式）。 */}
      <span title={blockedReason ?? t('comfyuiWorkflowPage.preview.runHint')} style={{ display: 'contents' }}>
        <button
          type="button"
          onClick={onRun}
          disabled={Boolean(blockedReason) || running}
          data-workflow-test-run
          className={cn(
            'mt-0.5 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-nomi-sm',
            'bg-nomi-ink text-caption font-semibold text-nomi-paper hover:bg-nomi-accent disabled:opacity-45',
          )}
        >
          <IconPlayerPlay size={13} stroke={1.9} aria-hidden="true" />
          {running ? t('comfyuiWorkflowPage.preview.running') : t('comfyuiWorkflowPage.preview.run')}
        </button>
      </span>
    </section>
  )
}

function PreviewControl({
  field,
  value,
  onChange,
}: {
  field: PreviewField
  value: string | undefined
  onChange: (value: string) => void
}): JSX.Element {
  const { t } = useTranslation()
  const label = translateModelDisplayText(field.label ?? (field.labelKey ? t(ROLE_TONES[field.labelKey as keyof typeof ROLE_TONES].labelKey) : field.key))
  const from = t('comfyuiWorkflowPage.preview.fromNode', { id: field.nodeId })

  const head = (
    <div className="mb-1 flex items-baseline gap-1.5">
      <span className="min-w-0 truncate text-micro text-nomi-ink-60">{label}</span>
      <span className="shrink-0 font-nomi-mono text-micro text-nomi-ink-30">{from}</span>
    </div>
  )

  if (field.kind === 'prompt') {
    return (
      <div>
        {head}
        <textarea
          value={value ?? ''}
          onChange={(event) => onChange(event.target.value)}
          rows={2}
          aria-label={label}
          placeholder={t('comfyuiWorkflowPage.preview.promptPlaceholder')}
          className={cn(
            'w-full resize-y rounded-nomi-sm border border-nomi-line bg-nomi-bg px-2 py-1.5',
            'text-caption text-nomi-ink outline-none placeholder:text-nomi-ink-30 focus:border-nomi-accent',
          )}
        />
      </div>
    )
  }

  if (field.kind === 'image' || field.kind === 'video') {
    return (
      <div>
        {head}
        <div
          className="grid h-11 place-items-center rounded-nomi-sm border border-dashed border-nomi-line text-micro text-nomi-ink-30"
          title={t('comfyuiWorkflowPage.preview.mediaHint')}
        >
          {t(MEDIA_LABEL_KEY[field.kind])}
        </div>
      </div>
    )
  }

  if (field.kind === 'boolean') {
    const checked = value !== undefined ? value === 'true' : field.defaultValue === true
    return (
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(String(event.target.checked))}
          className="size-3.5 accent-nomi-accent"
        />
        <span className="min-w-0 flex-1 truncate text-micro text-nomi-ink-60">{label}</span>
        <span className="shrink-0 font-nomi-mono text-micro text-nomi-ink-30">{from}</span>
      </label>
    )
  }

  // combo 参数在画布是真实文件下拉（enumOptions 随导入烤进控件）——这里同样给下拉，不假装自由输入。
  if (field.options?.length) {
    return (
      <div>
        {head}
        <NomiSelect
          ariaLabel={label}
          size="xs"
          value={value ?? String(field.defaultValue ?? field.options[0])}
          options={field.options.map((option) => ({ value: option, label: option }))}
          onChange={onChange}
          triggerMaxWidth={170}
          className="w-full max-w-full justify-between"
        />
      </div>
    )
  }

  return (
    <div>
      {head}
      <input
        value={value ?? String(field.defaultValue ?? '')}
        onChange={(event) => onChange(event.target.value)}
        inputMode={field.kind === 'number' ? 'decimal' : undefined}
        aria-label={label}
        className={cn(
          'h-7 w-full rounded-nomi-sm border border-nomi-line bg-nomi-bg px-2',
          'font-nomi-mono text-caption text-nomi-ink outline-none focus:border-nomi-accent',
        )}
      />
    </div>
  )
}
