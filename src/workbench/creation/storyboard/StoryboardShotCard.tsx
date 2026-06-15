import React from 'react'
import { IconAlertTriangle, IconGripVertical, IconPlus, IconTrash, IconX } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import { NomiSelect } from '../../../design'
import { AutoGrowTextarea } from '../../ai/composer/AutoGrowTextarea'
import type { PlanAnchor, PlanShot } from '../../generationCanvas/agent/storyboardPlan'
import { DURATION_OPTIONS_SEC } from '../../generationCanvas/agent/storyboardPlanEdits'

/**
 * 镜卡（白底主轴）。重设计 v4：白卡 + shadow-nomi-sm + 放大镜号,做成视觉主轴(比锚区设定面更有存在感)。
 * 参考 = 从锚多选,**中性纯文字 chip**(不再满屏 accent-soft 蓝);失效引用红 chip + ×就地移除。
 * 时长走 NomiSelect 预设。
 */

type Props = {
  shot: PlanShot
  anchors: PlanAnchor[]
  /** 这镜引用了、但锚已不存在的 id（红标 + 阻断确认）。 */
  danglingIds: string[]
  onUpdate: (patch: Partial<PlanShot>) => void
  onToggleAnchor: (anchorId: string) => void
  onRemove: () => void
  promptInvalid?: boolean
  // grip 拖拽重排（state 在编辑器，卡只透传）。
  draggable?: boolean
  isDragOver?: boolean
  onDragStart?: () => void
  onDragOver?: (event: React.DragEvent) => void
  onDrop?: () => void
  onDragEnd?: () => void
}

export default function StoryboardShotCard(props: Props): JSX.Element {
  const { shot, anchors, danglingIds, onUpdate, onToggleAnchor, onRemove, promptInvalid } = props
  const [pickerOpen, setPickerOpen] = React.useState(false)
  const byId = new Map(anchors.map((anchor) => [anchor.id, anchor]))
  const selected = shot.anchorIds.filter((id) => byId.has(id))
  const unselected = anchors.filter((anchor) => !shot.anchorIds.includes(anchor.id))

  const durationOptions = [...new Set([...DURATION_OPTIONS_SEC, shot.durationSec])]
    .sort((a, b) => a - b)
    .map((sec) => ({ value: String(sec), label: `${sec} 秒` }))

  return (
    <div
      draggable={props.draggable}
      onDragStart={props.onDragStart}
      onDragOver={props.onDragOver}
      onDrop={props.onDrop}
      onDragEnd={props.onDragEnd}
      className={cn(
        'border rounded-nomi p-3 bg-nomi-paper shadow-nomi-sm',
        props.isDragOver ? 'border-nomi-accent' : 'border-nomi-line',
      )}
    >
      <div className="flex items-center gap-2">
        <span className="shrink-0 cursor-grab text-nomi-ink-20 active:cursor-grabbing" aria-hidden>
          <IconGripVertical size={15} stroke={1.6} />
        </span>
        <span className="text-title font-semibold text-nomi-ink tabular-nums">镜 {shot.index}</span>
        <NomiSelect
          ariaLabel="时长"
          leadingLabel="时长"
          size="xs"
          value={String(shot.durationSec)}
          options={durationOptions}
          onChange={(value) => onUpdate({ durationSec: Number(value) })}
        />
        <span className="flex-1" />
        <button
          type="button"
          aria-label="删除镜头"
          onClick={onRemove}
          className="size-7 grid place-items-center rounded-nomi-sm text-nomi-ink-30 hover:bg-nomi-ink-10 hover:text-nomi-ink-60"
        >
          <IconTrash size={14} stroke={1.6} />
        </button>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap mt-2.5">
        <span className="text-micro text-nomi-ink-40 mr-0.5">参考</span>
        {selected.map((id) => {
          const anchor = byId.get(id)!
          return (
            <button
              key={id}
              type="button"
              onClick={() => onToggleAnchor(id)}
              title={`点一下取消引用 ${anchor.name || '该锚'}`}
              className="h-6 px-2.5 rounded-full bg-nomi-ink-05 text-nomi-ink-80 text-caption inline-flex items-center hover:bg-nomi-ink-10"
            >
              {anchor.name || '未命名'}
            </button>
          )
        })}
        {danglingIds.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => onToggleAnchor(id)}
            title="引用已失效，点一下移除"
            className="h-6 px-2 rounded-full bg-workbench-danger-soft text-workbench-danger text-caption inline-flex items-center gap-1"
          >
            <span className="line-through">失效引用</span>
            <IconX size={12} stroke={1.8} />
          </button>
        ))}
        {unselected.length > 0 && (
          <button
            type="button"
            onClick={() => setPickerOpen((open) => !open)}
            aria-expanded={pickerOpen}
            className="h-6 px-2.5 rounded-full border border-dashed border-nomi-ink-20 text-nomi-ink-60 text-caption inline-flex items-center gap-1 hover:text-nomi-ink-80"
          >
            <IconPlus size={12} stroke={1.8} />
            参考
          </button>
        )}
      </div>

      {pickerOpen && unselected.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap mt-1.5 pl-7">
          {unselected.map((anchor) => (
            <button
              key={anchor.id}
              type="button"
              onClick={() => {
                onToggleAnchor(anchor.id)
                if (unselected.length === 1) setPickerOpen(false)
              }}
              className="h-6 px-2.5 rounded-full border border-nomi-line text-nomi-ink-60 text-caption inline-flex items-center hover:border-nomi-ink-20 hover:text-nomi-ink-80"
            >
              {anchor.name || '未命名'}
            </button>
          ))}
        </div>
      )}

      {danglingIds.length > 0 && (
        <div className="text-micro text-workbench-danger mt-1.5 flex items-center gap-1">
          <IconAlertTriangle size={12} stroke={1.8} />
          有引用的锚已被删除——移除失效标签，或回上面重新加锚
        </div>
      )}

      <AutoGrowTextarea
        value={shot.prompt}
        onChange={(event) => onUpdate({ prompt: event.target.value })}
        aria-label={`镜 ${shot.index} 提示词`}
        placeholder="这镜画什么：运镜 + 动作演进（不复述锚的静态描述）"
        className={cn(
          'mt-2.5 px-2 py-2 rounded-nomi-sm border bg-nomi-paper',
          'text-body-sm text-nomi-ink-80 leading-normal focus:border-nomi-accent',
          promptInvalid ? 'border-workbench-danger' : 'border-nomi-line',
        )}
      />
    </div>
  )
}
