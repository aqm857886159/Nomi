import { Pagination, type PaginationProps } from '@mantine/core'

export type DesignPaginationProps = PaginationProps

export function DesignPagination({ className, radius = 'sm', ...props }: DesignPaginationProps): JSX.Element {
  const rootClassName = className ? `tc-design-pagination ${className}` : 'tc-design-pagination'

  return <Pagination {...props} className={rootClassName} radius={radius} />
}
