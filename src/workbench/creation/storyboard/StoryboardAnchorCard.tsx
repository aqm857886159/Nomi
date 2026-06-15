import React from 'react'
import { IconBox, IconCamera, IconChevronUp, IconLetterCase, IconPalette, IconPhoto, IconTrash, IconUser } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import { AutoGrowTextarea } from '../../ai/composer/AutoGrowTextarea'
import type { PlanAnchor, PlanAnchorKind } from '../../generationCanvas/agent/storyboardPlan'
import { ANCHOR_KIND_LABELS, ANCHOR_KINDS } from '../../generationCanvas/agent/storyboardPlanEdits'

/**
 * 锚行（跨镜头要一致的「设定」）。重设计 v4：去掉每锚的灰底块，改成「设定区分组面」里的一行
 * （分隔线由父容器 divide-y 提供，不再各自描边）。类型=可点图标徽标(内联展开 4 类选择器,不走 portal)；
 * carrier=图标+小字(相机/参考图 · 字母/文字)；描述默认收成一行预览,点开才编辑。安静、像配料。
 */

const KIND_ICON: Record<PlanAnchorKind, typeof IconUser> = {
  character: IconUser,
  scene: IconPhoto,
  prop: IconBox,
  style: IconPalette,
}

type Props = {
  anchor: PlanAnchor
  onUpdate: (patch: Partial<PlanAnchor>) => void
  onChangeKind: (kind: PlanAnchorKind) => void
  onRemove: () => void
  /** 视觉锚缺名字 → 校验高亮（名字是落画布的卡片标题）。 */
  nameInvalid?: boolean
}

export default function StoryboardAnchorCard({ anchor, onUpdate, onChangeKind, onRemove, nameInvalid }: Props): JSX.Element {
  // 空描述（新加的锚）默认展开好直接写；AI 填好的默认收起，让列表紧凑、分镜浮上来。
  const [expanded, setExpanded] = React.useState(() => !anchor.description.trim())
  const [kindPickerOpen, setKindPickerOpen] = React.useState(false)
  const KindIcon = KIND_ICON[anchor.kind]
  const desc = anchor.description.trim()

  return (
    <div className="px-2.5 py-2">
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          aria-label={`类型：${ANCHOR_KIND_LABELS[anchor.kind]}，点击切换`}
          title="点击切换类型"
          onClick={() => setKindPickerOpen((open) => !open)}
          className="shrink-0 size-[22px] grid place-items-center rounded-nomi-sm bg-nomi-ink-05 text-nomi-ink-60 hover:bg-nomi-ink-10 hover:text-nomi-ink-80"
        >
          <KindIcon size={13} stroke={1.6} />
        </button>
        <input
          value={anchor.name}
          onChange={(event) => onUpdate({ name: event.target.value })}
          placeholder="起个名字"
          aria-label="锚名字"
          className={cn(
            'shrink-0 w-[124px] h-7 px-2 rounded-nomi-sm border bg-nomi-paper',
            'text-body-sm font-medium text-nomi-ink outline-none focus:border-nomi-accent',
            nameInvalid ? 'border-workbench-danger' : 'border-transparent hover:border-nomi-line',
          )}
        />
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-label="编辑描述"
          className="flex-1 min-w-0 text-left text-caption text-nomi-ink-40 truncate hover:text-nomi-ink-60"
        >
          {desc || '添加描述…'}
        </button>
        <CarrierToggle value={anchor.carrier} onChange={(carrier) => onUpdate({ carrier })} />
        <button
          type="button"
          aria-label="删除锚"
          onClick={onRemove}
          className="shrink-0 size-7 grid place-items-center rounded-nomi-sm text-nomi-ink-30 hover:bg-nomi-ink-10 hover:text-nomi-ink-60"
        >
          <IconTrash size={15} stroke={1.6} />
        </button>
      </div>

      {kindPickerOpen ? (
        <div className="flex items-center gap-1.5 flex-wrap mt-2 pl-[32px]">
          {ANCHOR_KINDS.map((kind) => {
            const Icon = KIND_ICON[kind]
            const active = kind === anchor.kind
            return (
              <button
                key={kind}
                type="button"
                onClick={() => { onChangeKind(kind); setKindPickerOpen(false) }}
                className={cn(
                  'h-6 px-2 rounded-full text-caption inline-flex items-center gap-1',
                  active
                    ? 'bg-nomi-accent-soft text-nomi-accent'
                    : 'border border-nomi-line text-nomi-ink-60 hover:text-nomi-ink-80 hover:border-nomi-ink-20',
                )}
              >
                <Icon size={12} stroke={1.8} />
                {ANCHOR_KIND_LABELS[kind]}
              </button>
            )
          })}
        </div>
      ) : null}

      {expanded ? (
        <div className="mt-1.5 pl-[32px]">
          <AutoGrowTextarea
            value={anchor.description}
            onChange={(event) => onUpdate({ description: event.target.value })}
            aria-label="锚描述"
            autoFocus={!desc}
            placeholder={anchor.carrier === 'visual' ? '外貌/服装/光线，给生成模型的参考描述' : '能用文字说清的特征（色调/品牌色/服装词），会拼进每个引用它的镜头'}
            className="px-2 py-2 rounded-nomi-sm bg-nomi-paper border border-nomi-line text-body-sm text-nomi-ink-60 leading-normal focus:border-nomi-accent"
          />
          <div className="flex justify-end mt-0.5">
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="text-micro text-nomi-ink-40 inline-flex items-center gap-1 hover:text-nomi-ink-60"
            >
              收起
              <IconChevronUp size={12} stroke={1.8} />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/** carrier 切换：图标 + 小字（视觉锚=相机·参考图 accent-soft / 文本锚=字母·文字 描边）。 */
function CarrierToggle({ value, onChange }: { value: PlanAnchor['carrier']; onChange: (v: PlanAnchor['carrier']) => void }): JSX.Element {
  const isVisual = value === 'visual'
  return (
    <button
      type="button"
      onClick={() => onChange(isVisual ? 'text' : 'visual')}
      title={isVisual ? '点切换为「仅提示词」' : '点切换为「生成参考图」'}
      className={cn(
        'shrink-0 h-6 px-2 rounded-full text-caption inline-flex items-center gap-1',
        isVisual
          ? 'bg-nomi-accent-soft text-nomi-accent'
          : 'border border-nomi-line text-nomi-ink-60 hover:text-nomi-ink-80',
      )}
    >
      {isVisual ? <IconCamera size={13} stroke={1.7} /> : <IconLetterCase size={13} stroke={1.7} />}
      {isVisual ? '参考图' : '文字'}
    </button>
  )
}
