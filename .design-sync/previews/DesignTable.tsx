// DesignTable —— 表格（Mantine Table 的 Nomi 封装：w-full border-collapse + Nomi 字体/字色）。
// props 即 Mantine TableProps（striped / highlightOnHover / withTableBorder / withColumnBorders / verticalSpacing…）。
// 子组件走 Mantine 的复合命名空间（Table.Thead / Tbody / Tr / Th / Td），
// 但**根要用 DesignTable**，这样才拿到 Nomi 的排版。
// 仓库内目前尚无调用点，这里按 Nomi 真实需要的场景组合：生成记录表。
import { Table } from '@mantine/core'
import { DesignTable, StatusBadge } from 'nomi'

const ROWS = [
  { shot: '第 1 镜', model: 'Seedream 4.0', cost: '¥0.28', tone: 'success' as const, status: '已完成' },
  { shot: '第 2 镜', model: 'Seedream 4.0', cost: '¥0.28', tone: 'info' as const, status: '生成中' },
  { shot: '第 3 镜', model: 'Nano Banana', cost: '¥0.15', tone: 'neutral' as const, status: '排队中' },
  { shot: '第 4 镜', model: 'FLUX.1 Kontext', cost: '¥0.32', tone: 'danger' as const, status: '已失败' },
]

function Body(): JSX.Element {
  return (
    <>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>镜头</Table.Th>
          <Table.Th>模型</Table.Th>
          <Table.Th>花费</Table.Th>
          <Table.Th>状态</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {ROWS.map((r) => (
          <Table.Tr key={r.shot}>
            <Table.Td>{r.shot}</Table.Td>
            <Table.Td>{r.model}</Table.Td>
            <Table.Td style={{ fontFamily: 'var(--nomi-font-mono)' }}>{r.cost}</Table.Td>
            <Table.Td>
              <StatusBadge tone={r.tone}>{r.status}</StatusBadge>
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </>
  )
}

/** 生成记录表的常态。 */
export const GenerationLog = (): JSX.Element => (
  <div style={{ width: 480 }}>
    <DesignTable>
      <Body />
    </DesignTable>
  </div>
)

/** striped + highlightOnHover：长列表更好扫读。 */
export const Striped = (): JSX.Element => (
  <div style={{ width: 480 }}>
    <DesignTable striped highlightOnHover>
      <Body />
    </DesignTable>
  </div>
)

/** 带边框：嵌在面板里当独立区块时用。 */
export const Bordered = (): JSX.Element => (
  <div style={{ width: 480 }}>
    <DesignTable withTableBorder withColumnBorders verticalSpacing="xs">
      <Body />
    </DesignTable>
  </div>
)
