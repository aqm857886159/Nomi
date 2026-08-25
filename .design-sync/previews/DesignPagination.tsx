// DesignPagination —— 分页条（Mantine Pagination 的 Nomi 封装，radius 默认 sm）。
// props 即 Mantine PaginationProps（total / value / onChange / siblings / withEdges / disabled…）。
// 目前仓库内尚无调用点，这里按素材库长列表的典型用法组合。
import React from 'react'
import { DesignPagination } from 'nomi'

/** 受控壳：卡片里可以真的翻页。 */
function Demo(
  props: Omit<React.ComponentProps<typeof DesignPagination>, 'value' | 'onChange'> & { initial?: number },
): JSX.Element {
  const { initial = 1, ...rest } = props
  const [page, setPage] = React.useState(initial)
  return <DesignPagination {...rest} value={page} onChange={setPage} />
}

/** 素材库底部：12 页，当前停在第 4 页。 */
export const InAssetLibrary = (): JSX.Element => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 16,
      width: 520,
      padding: '10px 12px',
      borderTop: '1px solid var(--nomi-line)',
      background: 'var(--nomi-paper)',
    }}
  >
    <span style={{ font: '400 12px var(--nomi-font-sans)', color: 'var(--nomi-ink-60)' }}>
      共 143 个素材
    </span>
    <Demo total={12} initial={4} />
  </div>
)

/** withEdges：页数多时给首尾跳转箭头。 */
export const WithEdges = (): JSX.Element => <Demo total={24} initial={9} withEdges />

/** 状态：只有一页时收敛成单个按钮；disabled 用于加载中。 */
export const States = (): JSX.Element => (
  <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
    <Demo total={1} />
    <Demo total={8} initial={3} disabled />
  </div>
)
