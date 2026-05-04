import { type HTMLAttributes, type ReactNode } from 'react'

export type DesignPageShellProps = HTMLAttributes<HTMLDivElement> & {
  children?: ReactNode
}

export function DesignPageShell({ children, className, ...props }: DesignPageShellProps): JSX.Element {
  const rootClassName = className ? `tc-design-page-shell ${className}` : 'tc-design-page-shell'

  return (
    <div {...props} className={rootClassName}>
      {children}
    </div>
  )
}
