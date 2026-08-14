import { Drawer, Modal, type DrawerProps, type ModalProps } from '@mantine/core'
import { cn } from '../utils/cn'
import { NOMI_OVERLAY_Z_INDEX } from './overlayLayers'

export type DesignModalProps = ModalProps
export type DesignDrawerProps = DrawerProps

export function DesignModal({ className, radius = 'sm', zIndex = NOMI_OVERLAY_Z_INDEX.dialog, ...props }: DesignModalProps): JSX.Element {
  const rootClassName = cn('tc-design-modal', 'font-nomi-sans text-nomi-ink', className)

  return <Modal {...props} className={rootClassName} radius={radius} zIndex={zIndex} />
}

export function DesignDrawer({ className, zIndex = NOMI_OVERLAY_Z_INDEX.dialog, ...props }: DesignDrawerProps): JSX.Element {
  const rootClassName = cn('tc-design-drawer', 'font-nomi-sans text-nomi-ink', className)

  return <Drawer {...props} className={rootClassName} zIndex={zIndex} />
}
