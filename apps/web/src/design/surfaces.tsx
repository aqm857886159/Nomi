import { Paper, type PaperProps } from '@mantine/core'
import { forwardRef, type HTMLAttributes, type ReactNode } from 'react'

type PanelCardPadding = 'compact' | 'default' | 'comfortable'
type InlinePanelPadding = 'compact' | 'default'

const panelCardPaddingBySize: Record<PanelCardPadding, PaperProps['p']> = {
  compact: 'sm',
  default: 'md',
  comfortable: 'lg',
}

const inlinePanelPaddingBySize: Record<InlinePanelPadding, string> = {
  compact: '8px',
  default: '12px',
}

export type PanelCardProps = Omit<PaperProps, 'children' | 'p' | 'radius' | 'withBorder'> & Omit<HTMLAttributes<HTMLDivElement>, keyof PaperProps> & {
  children?: ReactNode
  padding?: PanelCardPadding
}

export const PanelCard = forwardRef<HTMLDivElement, PanelCardProps>(function PanelCard(
  {
    children,
    className,
    padding = 'default',
    ...props
  },
  ref,
) {
  const rootClassName = className ? `tc-panel-card ${className}` : 'tc-panel-card'

  return (
    <Paper
      {...props}
      ref={ref}
      className={rootClassName}
      p={panelCardPaddingBySize[padding]}
      radius="sm"
      shadow="xs"
      withBorder
    >
      {children}
    </Paper>
  )
})

export type InlinePanelProps = Omit<PaperProps, 'children'> & Omit<HTMLAttributes<HTMLDivElement>, keyof PaperProps> & {
  children?: ReactNode
  padding?: InlinePanelPadding
}

export const InlinePanel = forwardRef<HTMLDivElement, InlinePanelProps>(function InlinePanel(
  {
    children,
    className,
    padding = 'default',
    style,
    ...props
  },
  ref,
) {
  const rootClassName = className ? `tc-inline-panel ${className}` : 'tc-inline-panel'

  return (
    <Paper
      {...props}
      ref={ref}
      className={rootClassName}
      style={{
        padding: inlinePanelPaddingBySize[padding],
        ...style,
      }}
    >
      {children}
    </Paper>
  )
})
