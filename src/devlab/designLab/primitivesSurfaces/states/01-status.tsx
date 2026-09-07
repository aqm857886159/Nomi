// 设计实验室 · primitive 陈列 · 状态与空态族。
//
// 这一族里有一半是**全仓零调用**件（`DesignBadge` / `StatusBadge` / `DesignAlert` / `NomiSkeleton`）。
// 零调用不等于该删：`NomiSkeleton` 零采纳的同时，全仓有 9 处手写 `animate-pulse`——
// 也就是说这件事一直在做，只是没走这个组件。把它们摆出来是判断「删还是推广」的前提，
// 而不是判断的结论（那属于 D 档方案）。
import React from 'react'
import { IconAlertTriangle, IconPhoto } from '@tabler/icons-react'

import {
  DesignAlert,
  DesignBadge,
  DesignEmptyState,
  DesignProgress,
  NomiSkeleton,
  StatusBadge,
  WorkbenchButton,
} from '../../../../design'
import { PrimitiveStage, Specimen } from '../../primitives/primitivesLabKit'
import type { LabState } from '../../labScreen'

const SOURCE_STATUS = 'src/design/status.tsx · docs/design/nomi-design-system.md §3 状态'

export const STATUS_STATES: readonly LabState[] = [
  {
    id: 'ps-01-status-badge-tones',
    name: 'StatusBadge · 五 tone × 三 variant（全仓零调用）',
    source: SOURCE_STATUS,
    coverage: 'component-only',
    render: () => (
      <PrimitiveStage>
        <Specimen label="variant=light（默认）· neutral / info / success / warning / danger">
          <StatusBadge tone="neutral">待生成</StatusBadge>
          <StatusBadge tone="info">排队中</StatusBadge>
          <StatusBadge tone="success">已完成</StatusBadge>
          <StatusBadge tone="warning">需确认</StatusBadge>
          <StatusBadge tone="danger">失败</StatusBadge>
        </Specimen>
        <Specimen label="variant=filled">
          <StatusBadge tone="neutral" variant="filled">待生成</StatusBadge>
          <StatusBadge tone="info" variant="filled">排队中</StatusBadge>
          <StatusBadge tone="success" variant="filled">已完成</StatusBadge>
          <StatusBadge tone="warning" variant="filled">需确认</StatusBadge>
          <StatusBadge tone="danger" variant="filled">失败</StatusBadge>
        </Specimen>
        <Specimen label="variant=outline · size=xs / sm / md">
          <StatusBadge tone="info" variant="outline" size="xs">xs</StatusBadge>
          <StatusBadge tone="info" variant="outline" size="sm">sm</StatusBadge>
          <StatusBadge tone="info" variant="outline" size="md">md</StatusBadge>
        </Specimen>
      </PrimitiveStage>
    ),
  },
  {
    id: 'ps-02-design-badge',
    name: 'DesignBadge · 裸 Mantine 徽标（全仓零调用）',
    source: SOURCE_STATUS,
    coverage: 'component-only',
    // 与上一格并排看：`DesignBadge` 没有 tone 词表，颜色靠 Mantine 的 `color`——
    // 这正是优化方案 D-2「variant / tone / kind / color 四个词表达同一根轴」的活标本。
    render: () => (
      <PrimitiveStage>
        <Specimen label="variant=light（默认）">
          <DesignBadge>草稿</DesignBadge>
          <DesignBadge color="blue">图生视频</DesignBadge>
          <DesignBadge color="green">已导出</DesignBadge>
        </Specimen>
        <Specimen label="variant=filled / outline / dot">
          <DesignBadge variant="filled" color="grape">Pro</DesignBadge>
          <DesignBadge variant="outline" color="gray">v0.21.0</DesignBadge>
          <DesignBadge variant="dot" color="red">离线</DesignBadge>
        </Specimen>
      </PrimitiveStage>
    ),
  },
  {
    id: 'ps-03-design-alert',
    name: 'DesignAlert · 提示 / 警告 / 错误（全仓零调用）',
    source: SOURCE_STATUS,
    coverage: 'component-only',
    render: () => (
      <PrimitiveStage>
        <Specimen label="variant=light · 三色" align="stretch">
          <DesignAlert color="blue" title="生成会花钱">这一批 6 镜预计 ¥3.60，确认后才会真的发出去。</DesignAlert>
          <DesignAlert color="yellow" title="唇形同步暂不支持" icon={<IconAlertTriangle size={16} />}>
            这段会按普通口播生成，嘴型不对齐。
          </DesignAlert>
          <DesignAlert color="red" title="导出失败">磁盘剩余空间不足 2GB。</DesignAlert>
        </Specimen>
        <Specimen label="variant=filled / outline" align="stretch">
          <DesignAlert variant="filled" color="blue" title="已保存">画布改动已写入项目。</DesignAlert>
          <DesignAlert variant="outline" color="gray" title="只读项目">这个项目来自示例库，改动不会写回。</DesignAlert>
        </Specimen>
      </PrimitiveStage>
    ),
  },
  {
    id: 'ps-04-progress-skeleton',
    name: 'DesignProgress / NomiSkeleton · 加载态两件（Skeleton 全仓零调用）',
    source: SOURCE_STATUS,
    coverage: 'component-only',
    // NomiSkeleton 零采纳、而全仓 9 处手写 animate-pulse——这一格是那句话的对照物。
    render: () => (
      <PrimitiveStage>
        <Specimen label="DesignProgress · 0 / 38 / 100" align="stretch">
          <DesignProgress value={0} />
          <DesignProgress value={38} />
          <DesignProgress value={100} color="green" />
        </Specimen>
        <Specimen label="NomiSkeleton · lines=1 / 3（motion-reduce 不闪）" align="stretch">
          <NomiSkeleton />
          <NomiSkeleton lines={3} />
        </Specimen>
      </PrimitiveStage>
    ),
  },
  {
    id: 'ps-05-empty-state-panel',
    name: 'DesignEmptyState · density=panel（独立面板空态）',
    source: 'src/design/emptyState.tsx · docs/design/nomi-design-system.md §3.3',
    coverage: 'shell',
    render: () => (
      <PrimitiveStage>
        <DesignEmptyState
          icon={<IconPhoto size={34} className="text-nomi-ink-30" />}
          title="还没有素材"
          description="把图片或视频拖进来，或从画布里的生成结果存一份。"
          action={<WorkbenchButton variant="primary">导入素材</WorkbenchButton>}
        />
      </PrimitiveStage>
    ),
  },
  {
    id: 'ps-06-empty-state-inline',
    name: 'DesignEmptyState · density=inline（过滤/内嵌空态，无行动）',
    source: 'src/design/emptyState.tsx · docs/design/nomi-design-system.md §3.3',
    coverage: 'shell',
    render: () => (
      <PrimitiveStage>
        <DesignEmptyState
          density="inline"
          icon={<IconPhoto size={28} className="text-nomi-ink-30" />}
          title="没有匹配的素材"
          description="换个关键词试试。"
        />
      </PrimitiveStage>
    ),
  },
]
