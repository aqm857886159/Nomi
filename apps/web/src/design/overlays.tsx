import { Drawer, Modal, type DrawerProps, type ModalProps } from '@mantine/core'

export type DesignModalProps = ModalProps
export type DesignDrawerProps = DrawerProps

export function DesignModal({ className, radius = 'sm', ...props }: DesignModalProps): JSX.Element {
  const rootClassName = className ? `tc-design-modal ${className}` : 'tc-design-modal'

  return <Modal {...props} className={rootClassName} radius={radius} />
}

export function DesignDrawer({ className, ...props }: DesignDrawerProps): JSX.Element {
  const rootClassName = className ? `tc-design-drawer ${className}` : 'tc-design-drawer'

  return <Drawer {...props} className={rootClassName} />
}
