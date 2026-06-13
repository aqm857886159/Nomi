import React from 'react'
import { IconBox, IconPalette, IconPhoto, IconTrash, IconTypography, IconUser } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import { NomiSelect } from '../../../design'
import { AutoGrowTextarea } from '../../ai/composer/AutoGrowTextarea'
import type { PlanAnchor, PlanAnchorKind } from '../../generationCanvas/agent/storyboardPlan'
import { ANCHOR_KIND_LABELS, ANCHOR_KINDS } from '../../generationCanvas/agent/storyboardPlanEdits'

/**
 * 锚卡（跨镜头要一致的：角色/场景/道具/风格）。字段直接绑 PlanAnchor，改字段即改对象。
 * 浅底（ink-05）= 「配料」，与白底的镜卡（主轴）靠 surface 对比建层级，不加边框。
 */

const KIND_ICON: Record<PlanAnchorKind, typeof IconUser> = {
  character: IconUser,
  scene: IconPhoto,
  prop: IconBox,
  style: IconPalette,
}

const KIND_OPTIONS = ANCHOR_KINDS.map((kind) => ({ value: kind, label: ANCHOR_KIND_LABELS[kind] }))

type Props = {
  anchor: PlanAnchor
  onUpdate: (patch: Partial<PlanAnchor>) => void
  onChangeKind: (kind: PlanAnchorKind) => void
  onRemove: () => void
  /** 视觉锚缺名字 → 校验高亮（名字是落画布的卡片标题）。 */
  nameInvalid?: boolean
}

export default function StoryboardAnchorCard({ anchor, onUpdate, onChangeKind, onRemove, nameInvalid }: Props): JSX.Element {
  const KindIcon = KIND_ICON[anchor.kind]
  return (
    <div className="bg-nomi-ink-05 rounded-nomi p-[10px]">
      <div className="flex items-center gap-2 flex-wrap">
        <KindIcon size={16} stroke={1.5} className="text-nomi-ink-60 shrink-0" />
        <NomiSelect
          ariaLabel="锚类型"
          value={anchor.kind}
          options={KIND_OPTIONS}
          onChange={(value) => onChangeKind(value as PlanAnchorKind)}
        />
        <input
          value={anchor.name}
          onChange={(event) => onUpdate({ name: event.target.value })}
          placeholder="起个名字"
          aria-label="锚名字"
          className={cn(
            'flex-1 min-w-[80px] h-7 px-[9px] rounded-nomi-sm border bg-nomi-paper',
            'text-bodySm text-nomi-ink outline-none focus:border-nomi-accent',
            nameInvalid ? 'border-workbench-danger' : 'border-nomi-line',
          )}
        />
        <CarrierToggle value={anchor.carrier} onChange={(carrier) => onUpdate({ carrier })} />
        <button
          type="button"
          aria-label="删除锚"
          onClick={onRemove}
          className="size-7 grid place-items-center rounded-nomi-sm text-nomi-ink-40 hover:bg-nomi-ink-10 hover:text-nomi-ink-60"
        >
          <IconTrash size={15} stroke={1.6} />
        </button>
      </div>
      <AutoGrowTextarea
        value={anchor.description}
        onChange={(event) => onUpdate({ description: event.target.value })}
        aria-label="锚描述"
        placeholder={anchor.carrier === 'visual' ? '外貌/服装/光线，给生成模型的参考描述' : '能用文字说清的特征（色调/品牌色/服装词），会拼进每个引用它的镜头'}
        className={cn(
          'mt-2 px-[9px] py-[7px] rounded-nomi-sm border border-nomi-line bg-nomi-paper',
          'text-bodySm text-nomi-ink-80 leading-normal focus:border-nomi-accent',
        )}
      />
    </div>
  )
}

/** carrier 二选一分段开关：生成参考图（视觉锚）｜仅提示词（文本锚）。 */
function CarrierToggle({ value, onChange }: { value: PlanAnchor['carrier']; onChange: (v: PlanAnchor['carrier']) => void }): JSX.Element {
  return (
    <div className="inline-flex border border-nomi-line rounded-full overflow-hidden bg-nomi-paper text-caption">
      <Segment active={value === 'visual'} onClick={() => onChange('visual')} icon={<IconPhoto size={13} stroke={1.6} />} label="生成参考图" />
      <Segment active={value === 'text'} onClick={() => onChange('text')} icon={<IconTypography size={13} stroke={1.6} />} label="仅提示词" />
    </div>
  )
}

function Segment({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1 px-[10px] py-[5px]',
        active ? 'bg-nomi-accent-soft text-nomi-accent' : 'text-nomi-ink-40 hover:text-nomi-ink-60',
      )}
    >
      {icon}
      {label}
    </button>
  )
}
