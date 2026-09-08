// 设计实验室 · primitive 陈列「菜单」屏（2026-09-08，刀 1 随 `src/design/menu.tsx` 一起立）。
//
// 陈列的是 `WorkbenchMenu` **本体**（从 `src/design` 导出口进来），不是照着它另画一份。
// 四格钉住的是原语声明的全部形态，且每一格都镜像一个**现役调用点的真实形状**：
//   · pm-01 = 画布节点右键菜单（已迁）——图标 + 右对齐快捷键 + 两处禁用+原因 + 分隔线 + 危险项；
//   · pm-02 = 时间轴 clip 右键菜单（已迁）——**无图标**、`text-micro` 皮肤、连排 4 个危险项；
//     它和 pm-01 并排就是清单 C9/C11/C13/C14 那几条「同一套 token 里各写各的」的活证据，
//     刀 1 **不统一它们**（用户 2026-09-08：设计是之前定好的），只把差异摆出来给人看；
//   · pm-03 = 分组标题 + checkbox + radio（现役形状取自剪辑顶栏「布局」菜单，**尚未迁**）；
//   · pm-04 = 项内第二行灰字（现役形状取自画布框菜单的「解散」，**尚未迁**）。
//
// 为什么全部 `capture: 'viewport'`：菜单走 Radix Portal 到 body + fixed 定位，
// 根本不在舞台的 DOM 子树里；按元素截会截出一张「菜单没打开」的假证据
// （labScreen.ts 的 capture 字段就是为这一族留的）。
// 为什么 `open` 恒真、`point` 是写死的视口坐标：陈列要的是**展开后长什么样**，
// 而截图必须确定性——点位一随机，基线每次都不一样。
import React from 'react'
import {
  IconClipboard,
  IconCopy,
  IconCut,
  IconFrameOff,
  IconLayersSubtract,
  IconPencil,
  IconPlayerPlay,
  IconTrash,
} from '@tabler/icons-react'

import { WorkbenchMenu, type WorkbenchMenuNode } from '../../../../design'
import { PrimitiveStage, Specimen, Stateful } from '../../primitives/primitivesLabKit'
import type { LabState } from '../../labScreen'

const SOURCE_MENU = 'src/design/menu.tsx · docs/plan/2026-09-08-menu-primitive-inventory.md §3.1'

/**
 * 菜单钉在视口的这个点上（写死＝确定性；点位一随机，基线每次都不一样）。
 * y=112 是量出来的：说明卡（舞台）到 y≈88 结束，再往下 24px 起菜单，两者不叠；
 * 最高的一格（pm-03，6 项 + 2 段标题 + 1 条分隔线 ≈ 257px）落在 520×420 的视口内不触底，
 * 触底 Radix 会翻到上方去——那样陈列的就不是「贴点位往下展开」这个真实形态了。
 */
const MENU_POINT = { x: 24, y: 112 }

/**
 * 一格的舞台：菜单本体 Portal 出去了，舞台里留的是「这一格在陈列什么」的说明。
 * 舞台仍要有真实尺寸——走查会量 boundingBox，塌成 0 就报「这一格没渲染」。
 */
function MenuStage({ note }: { note: string }): JSX.Element {
  return (
    <PrimitiveStage>
      <Specimen label="菜单本体 Portal 到 body（fixed 贴视口点位），所以这一格截的是整屏" align="stretch">
        <div className="text-caption text-nomi-ink-60">{note}</div>
      </Specimen>
    </PrimitiveStage>
  )
}

const noop = () => undefined

export const PRIMITIVES_MENU_STATES: readonly LabState[] = [
  {
    id: 'pm-01-canvas-node-menu',
    name: 'WorkbenchMenu · 画布节点右键（图标 + 快捷键 + 禁用+原因 + 分隔线 + 危险项）',
    source: SOURCE_MENU,
    mirrors: 'src/workbench/generationCanvas/components/NodeContextMenu.tsx:71',
    coverage: 'shell',
    capture: 'viewport',
    render: () => (
      <>
        <WorkbenchMenu
          open
          onOpenChange={noop}
          point={MENU_POINT}
          ariaLabel="节点操作"
          className="w-[172px]"
          items={[
            { id: 'copy', label: '复制', shortcut: '⌘ C', icon: IconCopy, onSelect: noop },
            { id: 'cut', label: '剪切', shortcut: '⌘ X', icon: IconCut, onSelect: noop },
            // 禁用 + 原因：真实形状就是这两项（剪贴板空 / 选中不足两个）。
            { id: 'paste', label: '粘贴', shortcut: '⌘ V', icon: IconClipboard, disabled: true, disabledReason: '剪贴板是空的', onSelect: noop },
            { id: 'group', label: '建组', shortcut: '⌘ G', icon: IconLayersSubtract, disabled: true, disabledReason: '至少选中两个节点才能建组', onSelect: noop },
            { kind: 'separator', id: 'before-delete' },
            { id: 'delete', label: '删除', shortcut: 'Del', icon: IconTrash, danger: true, onSelect: noop },
          ]}
        />
        <MenuStage note="画布节点右键菜单：5 项、倒数第 2 项前一条分隔线、删除是危险项、粘贴与建组禁用并带 title 说明。" />
      </>
    ),
  },
  {
    id: 'pm-02-timeline-context-menu',
    name: 'WorkbenchMenu · 时间轴 clip 右键（无图标 · text-micro 皮肤 · 连排 4 个危险项）',
    source: SOURCE_MENU,
    mirrors: 'src/workbench/timeline/TimelineContextMenu.tsx:68',
    coverage: 'shell',
    capture: 'viewport',
    render: () => (
      <>
        <WorkbenchMenu
          open
          onOpenChange={noop}
          point={MENU_POINT}
          className="min-w-52 gap-0 rounded-nomi-lg p-1"
          itemClassName="min-h-0 gap-5 rounded-nomi-sm py-1.5 text-micro data-[highlighted]:bg-workbench-hover"
          shortcutClassName="font-mono text-workbench-muted"
          items={[
            { id: 'split', label: '分割', shortcut: 'S', onSelect: noop },
            { id: 'duplicate', label: '复制', shortcut: '⌘D', onSelect: noop },
            { id: 'regenerate', label: '重新生成', onSelect: noop },
            { id: 'mute', label: '静音', onSelect: noop },
            { id: 'delete', label: '删除', shortcut: '⌫', danger: true, onSelect: noop },
            { id: 'ripple-delete', label: '涟漪删除', shortcut: '⇧⌫', danger: true, onSelect: noop },
            { id: 'delete-left', label: '删除播放头左侧', shortcut: 'Q', danger: true, onSelect: noop },
            { id: 'delete-right', label: '删除播放头右侧', shortcut: 'W', danger: true, onSelect: noop },
          ]}
        />
        <MenuStage note="时间轴 clip 右键菜单：与 pm-01 同一个原语、不同皮肤（无图标 / 11px / 圆角 16 / hover 底色另一档），4 个危险项连排且没有分隔线——现状原样，刀 1 不统一。" />
      </>
    ),
  },
  {
    id: 'pm-03-groups-checkbox-radio',
    name: 'WorkbenchMenu · 分组标题 + checkbox + radio（选完不关 / 选完就关）',
    source: SOURCE_MENU,
    // 这个形状现役长在剪辑顶栏「布局」菜单里（手写 role="menuitemcheckbox"/"menuitemradio"），
    // 还没迁到原语——所以 coverage 是 component-only：能力在，生产尚无调用点走它。
    mirrors: ['src/workbench/preview/EditingLayoutMenu.tsx:87', 'src/workbench/preview/EditingLayoutMenu.tsx:108'],
    coverage: 'component-only',
    capture: 'viewport',
    render: () => (
      <Stateful initial={{ panels: ['inspector'], preset: 'edit' }}>
        {(value, setValue) => (
          <>
            <WorkbenchMenu
              open
              onOpenChange={noop}
              point={MENU_POINT}
              ariaLabel="布局"
              className="w-[188px]"
              items={[
                {
                  kind: 'group',
                  id: 'panels',
                  label: '面板',
                  items: (['inspector', 'assets', 'timeline'] as const).map((panel): WorkbenchMenuNode => ({
                    kind: 'checkbox',
                    id: panel,
                    label: { inspector: '属性', assets: '素材', timeline: '时间轴' }[panel],
                    checked: value.panels.includes(panel),
                    // 面板开关是多选：选完**不关**（现役 EditingLayoutMenu.tsx:93 有意如此）。
                    closeOnSelect: false,
                    onCheckedChange: (checked) => setValue({
                      ...value,
                      panels: checked ? [...value.panels, panel] : value.panels.filter((item) => item !== panel),
                    }),
                  })),
                },
                { kind: 'separator', id: 'sep' },
                {
                  kind: 'radio',
                  id: 'presets',
                  label: '预设',
                  value: value.preset,
                  onValueChange: (preset) => setValue({ ...value, preset }),
                  options: [
                    { id: 'edit', value: 'edit', label: '剪辑' },
                    { id: 'review', value: 'review', label: '审片' },
                    { id: 'focus', value: 'focus', label: '专注' },
                  ],
                },
              ]}
            />
            <MenuStage note="分组标题（面板 / 预设）+ checkbox（多选、选完不关）+ radio（单选、选完就关）。勾选槽固定占 16px，勾与不勾的行不会左右错开。" />
          </>
        )}
      </Stateful>
    ),
  },
  {
    id: 'pm-04-description-row',
    name: 'WorkbenchMenu · 项内第二行灰字（会被误当删除的那一项）',
    source: SOURCE_MENU,
    // 现役唯一消费者是画布框菜单的「解散」，尚未迁到原语。
    mirrors: 'src/workbench/generationCanvas/components/FrameContextMenu.tsx:124',
    coverage: 'component-only',
    capture: 'viewport',
    render: () => (
      <>
        <WorkbenchMenu
          open
          onOpenChange={noop}
          point={MENU_POINT}
          ariaLabel="框操作"
          className="w-[212px]"
          items={[
            // 图标与文案照抄现役框菜单：「解散」用 IconFrameOff 且**不是红的**——
            // 它不删东西，那正是第二行灰字要讲清楚的事。
            { id: 'edit', label: '改名 / 说明', icon: IconPencil, onSelect: noop },
            { id: 'generate', label: '生成这一框', icon: IconPlayerPlay, disabled: true, disabledReason: '框里还没有可生成的节点', onSelect: noop },
            { kind: 'separator', id: 'sep' },
            { id: 'dissolve', label: '解散', icon: IconFrameOff, description: '框没了，节点和连线都留着', onSelect: noop },
          ]}
        />
        <MenuStage note="第二行灰字：它是「解散 ≠ 删除」这句话唯一说得出口的地方，灰字对齐在图标之后（与现役框菜单的 pl-[22px] 同一列）。" />
      </>
    ),
  },
]
