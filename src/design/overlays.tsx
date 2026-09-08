import { Modal, type ModalProps } from '@mantine/core'
import { cn } from '../utils/cn'
import { NOMI_OVERLAY_Z_INDEX } from './overlayLayers'

export type DesignModalProps = ModalProps

export function DesignModal({ className, radius = 'sm', zIndex = NOMI_OVERLAY_Z_INDEX.dialog, ...props }: DesignModalProps): JSX.Element {
  const rootClassName = cn('font-nomi-sans text-nomi-ink', className)

  return <Modal {...props} className={rootClassName} radius={radius} zIndex={zIndex} />
}
