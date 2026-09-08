// 设计实验室 · primitive 陈列 · 动作族（原生实现的那半）。
//
// `WorkbenchButton` / `WorkbenchIconButton` / `ActionCard` 是设计系统里**自己写的**按钮族
// （token + Tailwind，不经 Mantine）。它们是全仓采纳率最高的一支，所以变体×尺寸的全矩阵
// 单独占格：漂移最先从「某处 ad-hoc 覆写一套 className」开始，而那种覆写只有在
// 全矩阵并排时才一眼看得出来。
//
// ⚠️ 2026-09-07 修正（用户抓到的系统性缺陷）：「陈列的是现役组件本体」只管住了**组件**，
// 管不住 **props**。此前三格摆的是「组件声明了哪些变体」的笛卡尔积，而不是「生产真的这么用」：
//   · `accent + size=md`、`accent + disabled`、`accent + loading + sm` —— 全仓 accent 只有
//     **一个**调用点（ReconcileDeviationCard:206，且是 `accent + sm + shrink-0`），
//     其余组合一个都不存在；
//   · `WorkbenchIconButton` 的 md 裸态 —— 42 个真实调用点里 **40 个**传 `className`，
//     而 `cn` 是 tailwind-merge，那些类**赢**。组件自己的默认尺寸几乎没在生产里活过；
//   · `ActionCard` 的 primary 卡此前编了一张「从一句话开始」，而真实 primary 是「新建空项目」，
//     `disabled` 卡则**零实例**。
// 现在每格钉住真实调用点的形状，`mirrors` 写明镜像哪一行（门岗第五项验它）。
// 「组件支持但生产没用」的组合不再摆——那不是陈列，那是把不存在的设计钉成基线。
import React from 'react'
import {
  IconChevronUp,
  IconCut,
  IconFolderOpen,
  IconPlayerPlay,
  IconPlus,
  IconSparkles,
  IconTrash,
} from '@tabler/icons-react'

import { ActionCard, WorkbenchButton, WorkbenchIconButton } from '../../../../design'
import { PrimitiveStage, Specimen } from '../../primitives/primitivesLabKit'
import type { LabState } from '../../labScreen'

const SOURCE_ACTIONS = 'src/design/actions.tsx · docs/design/nomi-design-system.md §3.1 动作'

export const WORKBENCH_ACTION_STATES: readonly LabState[] = [
  {
    id: 'pa-01-workbench-button-matrix',
    name: 'WorkbenchButton · 三变体 × 两尺寸全矩阵',
    source: SOURCE_ACTIONS,
    mirrors: [
      'src/ui/app-shell/UpdaterDialog.tsx:81',
      'src/workbench/generationCanvas/components/ReconcileDeviationCard.tsx:204',
      'src/workbench/generationCanvas/nodes/ClipNode.tsx:582',
    ],
    coverage: 'shell',
    // 三变体仍然全摆（它们都是组件声明的、都有真实调用点），但**尺寸按真实分布落**：
    // default/primary 的真实形态是对话框页脚那对 md 按钮；accent 的唯一真实形态是
    // 画布偏差卡里那颗 `sm + shrink-0`。把 accent 也画成 md 就是在陈列一个不存在的按钮。
    render: () => (
      <PrimitiveStage>
        <Specimen label="default / primary · md（对话框页脚那对，最常见的成对形态）">
          <WorkbenchButton variant="default">稍后</WorkbenchButton>
          <WorkbenchButton variant="primary">立即更新</WorkbenchButton>
        </Specimen>
        <Specimen label="default / primary · sm（画布内联工具条）">
          <WorkbenchButton size="sm">取消</WorkbenchButton>
          <WorkbenchButton size="sm" variant="primary">确认</WorkbenchButton>
        </Specimen>
        <Specimen label="accent · sm + shrink-0（全仓唯一的 accent 调用点形状）">
          <WorkbenchButton className="shrink-0" variant="accent" size="sm">
            让 AI 修一下
          </WorkbenchButton>
        </Specimen>
        <Specimen label="带图标（[&>svg]:size-4 由组件统一，调用点写的 size 会被丢掉）">
          <WorkbenchButton variant="primary"><IconPlayerPlay /> 生成</WorkbenchButton>
          <WorkbenchButton><IconPlus /> 新建</WorkbenchButton>
        </Specimen>
      </PrimitiveStage>
    ),
  },
  {
    id: 'pa-02-workbench-button-busy',
    name: 'WorkbenchButton · disabled / loading（loading 自动禁用 + aria-busy）',
    source: SOURCE_ACTIONS,
    mirrors: [
      'src/workbench/generationCanvas/nodes/ClipNode.tsx:582',
      'src/workbench/ai/NoTextModelRecoveryCard.tsx:105',
      'src/workbench/generationCanvas/components/ReconcileDeviationCard.tsx:202',
    ],
    coverage: 'shell',
    // loading 走品牌 N 转圈（NomiLoadingMark），不是第四套 spinner。这一格钉住的正是
    // 「转圈是品牌件」这条：谁把它换成 animate-spin 的 div，这里当场红。
    //
    // 2026-09-07 修正：真实 loading 只有两种形状——画布导出那对 `sm`，
    // 和恢复卡那颗 `primary + w-full`。此前摆的 `md 裸 loading` 与
    // `accent + sm + loading` 生产零实例。窄容器格也换成真实策略：
    // 生产不把按钮塞进 92px 死宽，而是 `flex-wrap + shrink-0` 整组换行。
    render: () => (
      <PrimitiveStage>
        <Specimen label="disabled（default / primary · 真实成对形态）">
          <WorkbenchButton disabled>稍后</WorkbenchButton>
          <WorkbenchButton disabled variant="primary">立即更新</WorkbenchButton>
        </Specimen>
        <Specimen label="loading · size=sm（画布导出：转圈占位，自动禁用）">
          <WorkbenchButton loading size="sm">导出本段</WorkbenchButton>
          <WorkbenchButton loading size="sm" variant="primary">导出整条</WorkbenchButton>
        </Specimen>
        <Specimen label="loading · primary + w-full（恢复卡：整宽单钮）" align="stretch">
          <WorkbenchButton loading variant="primary" className="w-full">
            正在切换模型
          </WorkbenchButton>
        </Specimen>
        <Specimen label="窄面板：flex-wrap + shrink-0 整组换行（生产的真实做法）">
          <div className="flex w-[200px] flex-wrap items-center gap-2 border border-dashed border-nomi-line p-1">
            <WorkbenchButton className="shrink-0" size="sm">忽略</WorkbenchButton>
            <WorkbenchButton className="shrink-0" variant="accent" size="sm">让 AI 修一下</WorkbenchButton>
          </div>
        </Specimen>
      </PrimitiveStage>
    ),
  },
  {
    id: 'pa-03-workbench-icon-button',
    name: 'WorkbenchIconButton · 真实形态（几乎总被 className 改写尺寸与配色）',
    source: SOURCE_ACTIONS,
    mirrors: [
      'src/workbench/generationCanvas/components/CanvasSelectionToolbar.tsx:98',
      'src/workbench/generationCanvas/nodes/ClipNodeActionToolbar.tsx:28',
    ],
    coverage: 'shell',
    // 这一格此前陈列的是「组件的默认尺寸」，而那个默认在生产里**几乎不存在**：
    // 42 个调用点里 40 个传 `className`，`cn` 是 tailwind-merge → 调用点的类赢。
    // 所以真正该钉住的是三件：① 画布工具条的 sm 裸态（少数不覆写的那批）；
    // ② 工具条里的透明底 + 逐动作 hover 色（最常见的覆写）；
    // ③ 禁用项外面那层 `<span className="inline-flex" title=…>`——
    //    禁用的按钮不触发 hover，提示得挂在外层 span 上，这是生产的固定手法。
    render: () => (
      <PrimitiveStage>
        <Specimen label="size=sm 裸态（画布选择工具条：少数不覆写的那批）">
          <WorkbenchIconButton size="sm" icon={<IconPlus />} label="新建" />
          <WorkbenchIconButton size="sm" icon={<IconSparkles />} label="AI 改写" />
          <WorkbenchIconButton size="sm" icon={<IconTrash />} label="删除" />
        </Specimen>
        <Specimen label="透明底 + 逐动作 hover 色（工具条：40/42 都这么覆写）">
          <div className="flex items-center gap-0.5 rounded-nomi-sm bg-nomi-ink-05">
            <WorkbenchIconButton
              icon={<IconCut />}
              label="分割"
              title="分割"
              className="shrink-0 rounded-nomi-sm bg-transparent text-nomi-ink-60 hover:bg-nomi-paper hover:text-nomi-ink"
            />
            <WorkbenchIconButton
              icon={<IconPlus />}
              label="复制"
              title="复制"
              className="shrink-0 rounded-nomi-sm bg-transparent text-nomi-ink-60 hover:bg-nomi-paper hover:text-nomi-ink"
            />
            <WorkbenchIconButton
              icon={<IconTrash />}
              label="删除"
              title="删除"
              className="shrink-0 rounded-nomi-sm bg-transparent text-nomi-ink-60 hover:bg-nomi-paper hover:text-workbench-danger"
            />
          </div>
        </Specimen>
        <Specimen label="disabled + 外层 span 挂原因（禁用钮不触发 hover，提示只能挂外面）">
          {/* title="" 显式清空组件自己的提示：原因归外层 span，两处都挂会出两个气泡。 */}
          <span className="inline-flex" title="只有一段素材时不能分割">
            <WorkbenchIconButton
              disabled
              icon={<IconCut />}
              label="分割"
              title=""
              className="shrink-0 rounded-nomi-sm bg-transparent text-nomi-ink-60"
            />
          </span>
          <WorkbenchIconButton disabled size="sm" icon={<IconTrash />} label="删除" />
        </Specimen>
      </PrimitiveStage>
    ),
  },
  {
    id: 'pa-04-action-card',
    name: 'ActionCard · primary / default（项目库主入口，全仓仅此 3 张）',
    source: 'src/design/actions.tsx ActionCard · docs/design/nomi-design-system.md §3.2',
    mirrors: [
      'src/workbench/library/ProjectLibraryPage.tsx:321',
      'src/workbench/library/ProjectLibraryPage.tsx:329',
      'src/workbench/library/ProjectLibraryPage.tsx:337',
    ],
    coverage: 'shell',
    // 一页至多一张 primary（组件头注的设计约束）。
    //
    // 2026-09-07 修正：此前这一格把 primary 给了一张编出来的「从一句话开始」卡，
    // 把真正的 primary（「新建空项目」）降成 default，还画了一张 `disabled` 卡——
    // 而 `disabled` 在 ActionCard 上是**零实例**（它是从 ButtonHTMLAttributes 继承来的，
    // 组件确实为它写了 `disabled:opacity-50`，但没有任何页面用过）。
    // 现在三张卡逐项照抄项目库那一行：图标 `size={18}`、primary 在最左、stroke 也照抄。
    render: () => (
      <PrimitiveStage>
        <Specimen label="项目库主入口三张（primary 领头 · 全仓仅有的 ActionCard）" align="stretch">
          <ActionCard
            variant="primary"
            icon={<IconPlus size={18} stroke={1.8} />}
            title="新建空项目"
            description="自己搭画布"
          />
          <ActionCard
            icon={<IconFolderOpen size={18} stroke={1.6} />}
            title="打开文件夹"
            description="从磁盘导入已有项目"
          />
          <ActionCard
            icon={<IconPlayerPlay size={18} stroke={1.6} />}
            title="看看 Nomi 怎么用"
            description="三分钟跑通一条短片"
          />
        </Specimen>
        <Specimen label="⚠️ disabled：组件支持（disabled:opacity-50）但生产零调用点" align="stretch">
          <ActionCard
            disabled
            icon={<IconChevronUp size={18} stroke={1.6} />}
            title="继续上次的项目"
            description="还没有可继续的项目"
          />
        </Specimen>
      </PrimitiveStage>
    ),
  },
]
