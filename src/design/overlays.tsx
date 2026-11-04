import type { JSX } from 'react'
import { Modal, type ModalProps } from '@mantine/core'
import { cn } from '../utils/cn'
import { useModalInputLayer } from './modalInputLayer'
import { NOMI_OVERLAY_Z_INDEX } from './overlayLayers'

export type DesignModalProps = ModalProps

export function DesignModal({ className, radius = 'sm', zIndex = NOMI_OVERLAY_Z_INDEX.dialog, ...props }: DesignModalProps): JSX.Element {
  // 所有走 DesignModal 的弹层在这里一次登记：开着时工作区面不接键盘、粘贴、指针手势。
  useModalInputLayer(Boolean(props.opened))
  const rootClassName = cn('font-nomi-sans text-nomi-ink', className)

  return <Modal {...props} className={rootClassName} radius={radius} zIndex={zIndex} />
}
