import { Table, type TableProps } from '@mantine/core'

export type DesignTableProps = TableProps

export function DesignTable({ className, ...props }: DesignTableProps): JSX.Element {
  const rootClassName = className ? `tc-design-table ${className}` : 'tc-design-table'

  return <Table {...props} className={rootClassName} />
}
