// DesignEmptyState —— 全仓统一空态（设计系统 §3.3）。收口此前项目库/提示词库/素材库/拾取器
// 各手写一份「居中 icon + 标题 + 说明 + 可选行动」的重复结构（措辞「还没有/暂无/没有匹配」也曾不一）。
// icon 由调用方传好尺寸/色（组件只管布局与排版）；density 控制垂直密度。
//
// 文案纪律（D4）：空态要告诉用户**下一步能做什么**，不是只说「没有数据」。
import { IconCards, IconPhoto, IconSearch, IconFolderOpen } from '@tabler/icons-react'
import { DesignEmptyState, DesignButton } from 'nomi'

/** 首次使用的空库：有图标、有说明、有明确的下一步动作。 */
export const WithAction = (): JSX.Element => (
  <div style={{ width: 420, borderRadius: 'var(--nomi-radius-lg)', border: '1px solid var(--nomi-line)', background: 'var(--nomi-paper)' }}>
    <DesignEmptyState
      icon={<IconFolderOpen size={34} stroke={1.4} className="text-nomi-ink-30" />}
      title="还没有项目"
      description="从一句话开始，Nomi 会帮你拆成分镜、生成画面、拼成成片。"
      action={<DesignButton variant="filled">新建空白项目</DesignButton>}
    />
  </div>
)

/** density 轴：panel（py-20，独立面板）vs inline（py-12，筛选结果内嵌）。 */
export const Density = (): JSX.Element => (
  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
    <div style={{ width: 260, borderRadius: 'var(--nomi-radius-lg)', border: '1px solid var(--nomi-line)', background: 'var(--nomi-paper)' }}>
      <DesignEmptyState
        density="panel"
        icon={<IconCards size={30} stroke={1.45} className="text-nomi-ink-30" />}
        title="panel · py-20"
        description="独立面板的空态，上下留白更松。"
      />
    </div>
    <div style={{ width: 260, borderRadius: 'var(--nomi-radius-lg)', border: '1px solid var(--nomi-line)', background: 'var(--nomi-paper)' }}>
      <DesignEmptyState
        density="inline"
        icon={<IconCards size={30} stroke={1.45} className="text-nomi-ink-30" />}
        title="inline · py-12"
        description="内嵌在列表里的空态，更紧凑。"
      />
    </div>
  </div>
)

/** 筛选无结果：与「从来没有」区分开——说清是筛选筛没了。 */
export const FilteredEmpty = (): JSX.Element => (
  <div style={{ width: 420, borderRadius: 'var(--nomi-radius-lg)', border: '1px solid var(--nomi-line)', background: 'var(--nomi-paper)' }}>
    <DesignEmptyState
      density="inline"
      icon={<IconSearch size={30} stroke={1.45} className="text-nomi-ink-30" />}
      title="没有匹配的提示词"
      description="换个筛选或搜索词试试。"
    />
  </div>
)

/** 最简形态：只有图标和标题（列表内嵌、空间紧张时）。 */
export const Minimal = (): JSX.Element => (
  <div style={{ width: 320, borderRadius: 'var(--nomi-radius-lg)', border: '1px solid var(--nomi-line)', background: 'var(--nomi-paper)' }}>
    <DesignEmptyState
      density="inline"
      icon={<IconPhoto size={28} stroke={1.45} className="text-nomi-ink-30" />}
      title="这一镜还没有生成画面"
    />
  </div>
)
