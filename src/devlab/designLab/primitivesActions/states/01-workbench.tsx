// 设计实验室 · primitive 陈列 · 动作族（原生实现的那半）。
//
// `WorkbenchButton` / `WorkbenchIconButton` / `ActionCard` 是设计系统里**自己写的**按钮族
// （token + Tailwind，不经 Mantine）。它们是全仓采纳率最高的一支，所以变体×尺寸的全矩阵
// 单独占格：漂移最先从「某处 ad-hoc 覆写一套 className」开始，而那种覆写只有在
// 全矩阵并排时才一眼看得出来。
import React from 'react'
import { IconPlayerPlay, IconPlus, IconSparkles, IconTrash, IconX } from '@tabler/icons-react'

import { ActionCard, WorkbenchButton, WorkbenchIconButton } from '../../../../design'
import { PrimitiveStage, Specimen } from '../../primitives/primitivesLabKit'
import type { LabState } from '../../labScreen'

const SOURCE_ACTIONS = 'src/design/actions.tsx · docs/design/nomi-design-system.md §3.1 动作'

export const WORKBENCH_ACTION_STATES: readonly LabState[] = [
  {
    id: 'pa-01-workbench-button-matrix',
    name: 'WorkbenchButton · 三变体 × 两尺寸全矩阵',
    source: SOURCE_ACTIONS,
    coverage: 'shell',
    render: () => (
      <PrimitiveStage>
        <Specimen label="size=md · default / primary / accent">
          <WorkbenchButton>取消</WorkbenchButton>
          <WorkbenchButton variant="primary">确认</WorkbenchButton>
          <WorkbenchButton variant="accent">让 AI 修一下</WorkbenchButton>
        </Specimen>
        <Specimen label="size=sm · default / primary / accent">
          <WorkbenchButton size="sm">取消</WorkbenchButton>
          <WorkbenchButton size="sm" variant="primary">确认</WorkbenchButton>
          <WorkbenchButton size="sm" variant="accent">让 AI 修一下</WorkbenchButton>
        </Specimen>
        <Specimen label="带图标（[&>svg]:size-4 由组件统一）">
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
    coverage: 'shell',
    // loading 走品牌 N 转圈（NomiLoadingMark），不是第四套 spinner。这一格钉住的正是
    // 「转圈是品牌件」这条：谁把它换成 animate-spin 的 div，这里当场红。
    render: () => (
      <PrimitiveStage>
        <Specimen label="disabled">
          <WorkbenchButton disabled>取消</WorkbenchButton>
          <WorkbenchButton disabled variant="primary">确认</WorkbenchButton>
          <WorkbenchButton disabled variant="accent">让 AI 修一下</WorkbenchButton>
        </Specimen>
        <Specimen label="loading（含 N 转圈占位）">
          <WorkbenchButton loading>导出中</WorkbenchButton>
          <WorkbenchButton loading variant="primary">生成中</WorkbenchButton>
          <WorkbenchButton loading size="sm" variant="accent">修改中</WorkbenchButton>
        </Specimen>
        <Specimen label="窄容器：文字永不逐字折行（whitespace-nowrap）">
          <div className="w-[92px] border border-dashed border-nomi-line p-1">
            <WorkbenchButton variant="primary">整笔撤销</WorkbenchButton>
          </div>
        </Specimen>
      </PrimitiveStage>
    ),
  },
  {
    id: 'pa-03-workbench-icon-button',
    name: 'WorkbenchIconButton · md / sm / disabled',
    source: SOURCE_ACTIONS,
    coverage: 'shell',
    render: () => (
      <PrimitiveStage>
        <Specimen label="size=md（32px）">
          <WorkbenchIconButton icon={<IconPlus />} label="新建" />
          <WorkbenchIconButton icon={<IconSparkles />} label="AI 改写" />
          <WorkbenchIconButton icon={<IconTrash />} label="删除" />
          <WorkbenchIconButton icon={<IconX />} label="关闭" />
        </Specimen>
        <Specimen label="size=sm（28px · 画布/工具条）">
          <WorkbenchIconButton size="sm" icon={<IconPlus />} label="新建" />
          <WorkbenchIconButton size="sm" icon={<IconSparkles />} label="AI 改写" />
          <WorkbenchIconButton size="sm" icon={<IconTrash />} label="删除" />
        </Specimen>
        <Specimen label="disabled">
          <WorkbenchIconButton disabled icon={<IconPlus />} label="新建" />
          <WorkbenchIconButton disabled size="sm" icon={<IconTrash />} label="删除" />
        </Specimen>
      </PrimitiveStage>
    ),
  },
  {
    id: 'pa-04-action-card',
    name: 'ActionCard · default / primary / disabled（页面级主入口）',
    source: 'src/design/actions.tsx ActionCard · docs/design/nomi-design-system.md §3.2',
    coverage: 'shell',
    // 一页至多一张 primary（组件头注的设计约束）。两张并排是为了让「大一个量级」这件事
    // 有对照——单看一张卡看不出它凭什么不是按钮。
    render: () => (
      <PrimitiveStage>
        <Specimen label="variant=primary / default" align="stretch">
          <ActionCard
            variant="primary"
            icon={<IconSparkles size={20} />}
            title="从一句话开始"
            description="写下你想拍的，Nomi 拆成分镜"
          />
          <ActionCard
            icon={<IconPlus size={20} />}
            title="新建空项目"
            description="自己搭画布"
          />
        </Specimen>
        <Specimen label="disabled" align="stretch">
          <ActionCard
            disabled
            icon={<IconPlayerPlay size={20} />}
            title="继续上次的项目"
            description="还没有可继续的项目"
          />
        </Specimen>
      </PrimitiveStage>
    ),
  },
]
