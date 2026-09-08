// 设计实验室 · primitive 陈列 · 状态与空态族。
//
// 「零调用不等于该删」在这一族上分出了两个结果（2026-09-07 逐件重数后处置）：
//   · `NomiSkeleton` 已被项目库 loading 态接走 —— 推广成功，不再是零调用；
//   · `DesignBadge` / `StatusBadge` 仍是零调用，但画布侧有 5 份手写徽章等着迁 —— 保留待推广；
//   · `DesignAlert` 零调用、且透传裸 Mantine `color` 绕过 tone 词表 —— **已删**（原 ps-03 格随之删除）。
// 状态 id 里的空号（ps-03）是删除留下的，不补位：改 id 就得改基线文件名，
// 而基线是拿来比「同一格前后有没有变」的，重编号会把这条线索洗掉。
//
// ⚠️ 2026-09-07（用户抓到的系统性缺陷）：陈列格「渲染的是现役组件本体」只管住了**组件**，
// 管不住 **props**。这一族里 `ps-04` 两件都中了：`DesignProgress` 没传 `size`（4/4 真实
// 调用点都传）、还传了 `color="green"` 这个**生产零实例的裸 Mantine 色名**（真实的那处传的是
// `var(--nomi-accent)`）；`NomiSkeleton` 画的是 `lines` 文本骨架，而唯一的真实消费者用的是
// `className="h-32"` 的卡片占位。现在按真实调用点重画，`mirrors` 写明镜像哪一行。
import React from 'react'
import { IconPhoto } from '@tabler/icons-react'

import {
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
    name: 'StatusBadge · 五 tone × 三 variant（生产零调用 · 待推广）',
    source: SOURCE_STATUS,
    // 零采纳件：设计系统提供了这个能力，生产一处都还没用（画布侧有 5 份手写徽章等着迁）。
    // 本格是**能力展示**，不是现役形态——别把它当「界面上就长这样」。
    mirrors: 'none — 零采纳件（全仓 0 个调用点，待画布手写徽章迁过来）',
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
    name: 'DesignBadge · 封闭 tone 词表（生产零调用 · 待推广）',
    source: SOURCE_STATUS,
    mirrors: 'none — 零采纳件（全仓 0 个调用点）',
    coverage: 'component-only',
    // 2026-09-07 前这一格是色泄漏的活标本：`DesignBadge` 没有 tone 词表、直接透传 Mantine
    // 的 `color`，于是这里的 PRO 徽章（color="grape"）在四套候选配色下都岿然不动地保持紫色。
    // 现已收敛成与 `StatusBadge` 同一套 tone（neutral|info|success|warning|danger），类型层就拦住。
    render: () => (
      <PrimitiveStage>
        <Specimen label="variant=light（默认）">
          <DesignBadge>草稿</DesignBadge>
          <DesignBadge tone="info">图生视频</DesignBadge>
          <DesignBadge tone="success">已导出</DesignBadge>
        </Specimen>
        <Specimen label="variant=filled / outline / dot">
          <DesignBadge variant="filled" tone="info">Pro</DesignBadge>
          <DesignBadge variant="outline">v0.21.0</DesignBadge>
          <DesignBadge variant="dot" tone="danger">离线</DesignBadge>
        </Specimen>
      </PrimitiveStage>
    ),
  },
  {
    id: 'ps-04-progress-skeleton',
    name: 'DesignProgress / NomiSkeleton · 加载态两件（按真实调用点）',
    source: SOURCE_STATUS,
    mirrors: [
      'src/ui/app-shell/UpdaterDialog.tsx:69',
      'src/ui/onboarding/AdapterVerificationScreen.tsx:141',
      'src/workbench/library/ProjectLibraryPage.tsx:454',
    ],
    coverage: 'shell',
    // 2026-09-07 两处修正：
    //   · `DesignProgress` 补 `size`（4/4 真实调用点都传：sm ×2、xs ×2），并把
    //     `color="green"` 换成真实的 `var(--nomi-accent)`——裸 Mantine 色名在本仓
    //     **零实例**，摆着等于示范一条绕过 token 的路（而这正是 DesignBadge 刚被收敛掉的那种洞）。
    //   · `NomiSkeleton` 换成唯一真实消费者的形状：项目库 loading 的 `className="h-32"`
    //     卡片占位，不是 `lines` 文本骨架（`lines` 生产零使用）。
    render: () => (
      <PrimitiveStage>
        <Specimen label="DesignProgress · size=sm（更新下载）/ size=xs + var(--nomi-accent)（接入校验）" align="stretch">
          <DesignProgress value={0} size="sm" />
          <DesignProgress value={38} size="sm" />
          <DesignProgress value={62} size="xs" color="var(--nomi-accent)" />
          <DesignProgress value={100} size="xs" color="var(--nomi-accent)" />
        </Specimen>
        <Specimen label="NomiSkeleton · 项目库 loading 的卡片占位（className=h-32 · 唯一真实用法）" align="stretch">
          <div className="grid grid-cols-2 gap-2">
            {[0, 1, 2, 3].map((slot) => (
              <NomiSkeleton key={slot} className="h-32" />
            ))}
          </div>
        </Specimen>
        <Specimen label="⚠️ NomiSkeleton lines=1 / 3：组件支持，生产零使用（motion-reduce 不闪）" align="stretch">
          <NomiSkeleton />
          <NomiSkeleton lines={3} />
        </Specimen>
      </PrimitiveStage>
    ),
  },
  {
    id: 'ps-05-empty-state-panel',
    name: 'DesignEmptyState · density=panel（独立面板空态 · 带行动）',
    source: 'src/design/emptyState.tsx · docs/design/nomi-design-system.md §3.3',
    mirrors: ['src/workbench/creation/storyboard/StoryboardWorkspace.tsx:59'],
    coverage: 'shell',
    // 这是**唯一**一处「panel 密度 + 图标 + WorkbenchButton 行动」俱全的真实调用点；
    // 另外 4 处 panel 密度都不给图标、且行动是手写 <button>（生产侧的债，见报告，本刀不动）。
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
    name: 'DesignEmptyState · density=inline（内嵌空态 · 9/14 是它，是主形态）',
    source: 'src/design/emptyState.tsx · docs/design/nomi-design-system.md §3.3',
    mirrors: ['src/workbench/preview/PreviewSourcePanel.tsx:66'],
    coverage: 'shell',
    // 名字里去掉「无行动」：inline 密度有 2 处真实调用点是**带**行动的，
    // 原来的名字把少数情形说成了这一档的定义。图标补 `stroke={1.4}`——真实 inline 图标都描细一档。
    render: () => (
      <PrimitiveStage>
        <DesignEmptyState
          density="inline"
          icon={<IconPhoto size={30} stroke={1.4} className="text-nomi-ink-30" />}
          title="没有匹配的素材"
          description="换个关键词试试。"
        />
      </PrimitiveStage>
    ),
  },
]
