// 设计实验室 · primitive 陈列 · 动作族（Mantine 封装的那半）。
//
// `DesignButton` / `IconActionButton` 是同一根轴上的**另一套**实现（Mantine `Button` / `ActionIcon`
// 外面裹一层 token className）。设计系统优化方案 D-3 把「DesignButton vs WorkbenchButton 的
// 半途迁移」列为近重复合并候选——把两套并排陈列，正是让这件事从「文档里的一句话」
// 变成「一眼能看见的两排按钮」。
//
// 这一屏不做取舍、不改源码：合并是 D 档的事（只出方案）。陈列只负责把现状摆出来。
import React from 'react'
import { IconDownload, IconRefresh, IconSettings, IconTrash } from '@tabler/icons-react'

import { DesignButton, IconActionButton } from '../../../../design'
import { PrimitiveStage, Specimen } from '../../primitives/primitivesLabKit'
import type { LabState } from '../../labScreen'

const SOURCE_MANTINE = 'src/design/actions.tsx（Mantine 封装）· 优化方案 D-3 近重复合并候选'

export const MANTINE_ACTION_STATES: readonly LabState[] = [
  {
    id: 'pa-05-design-button-variants',
    name: 'DesignButton · Mantine 五变体',
    source: SOURCE_MANTINE,
    coverage: 'shell',
    render: () => (
      <PrimitiveStage>
        <Specimen label="variant=filled / light / outline">
          <DesignButton variant="filled">确认</DesignButton>
          <DesignButton variant="light">确认</DesignButton>
          <DesignButton variant="outline">确认</DesignButton>
        </Specimen>
        <Specimen label="variant=subtle / default">
          <DesignButton variant="subtle">确认</DesignButton>
          <DesignButton variant="default">确认</DesignButton>
        </Specimen>
        <Specimen label="leftSection（图标位由组件统一，loading 时被 N 转圈顶替）">
          <DesignButton leftSection={<IconDownload size={14} />}>导出</DesignButton>
          <DesignButton variant="filled" leftSection={<IconRefresh size={14} />}>重试</DesignButton>
        </Specimen>
      </PrimitiveStage>
    ),
  },
  {
    id: 'pa-06-design-button-busy',
    name: 'DesignButton · disabled / loading',
    source: SOURCE_MANTINE,
    coverage: 'shell',
    render: () => (
      <PrimitiveStage>
        <Specimen label="disabled">
          <DesignButton disabled>确认</DesignButton>
          <DesignButton disabled variant="filled">确认</DesignButton>
          <DesignButton disabled variant="outline">确认</DesignButton>
        </Specimen>
        <Specimen label="loading（Mantine 自带 loader 被关掉，统一走 NomiLoadingMark）">
          <DesignButton loading>导出中</DesignButton>
          <DesignButton loading variant="filled">导出中</DesignButton>
        </Specimen>
      </PrimitiveStage>
    ),
  },
  {
    id: 'pa-07-icon-action-button',
    name: 'IconActionButton · 变体 / loading / disabled',
    source: SOURCE_MANTINE,
    coverage: 'shell',
    render: () => (
      <PrimitiveStage>
        <Specimen label="variant=subtle（默认）/ light / filled">
          <IconActionButton icon={<IconSettings size={16} />} aria-label="设置" />
          <IconActionButton variant="light" icon={<IconRefresh size={16} />} aria-label="重试" />
          <IconActionButton variant="filled" icon={<IconDownload size={16} />} aria-label="导出" />
        </Specimen>
        <Specimen label="loading / disabled">
          <IconActionButton loading icon={<IconDownload size={16} />} aria-label="导出中" />
          <IconActionButton disabled icon={<IconTrash size={16} />} aria-label="删除" />
        </Specimen>
      </PrimitiveStage>
    ),
  },
]
