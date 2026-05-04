import React from 'react'
import { IconVectorBezier2 } from '@tabler/icons-react'
import { DesignButton, type DesignButtonProps } from '../design'
import { spaNavigate } from '../utils/spaNavigate'

type CanvasEntryButtonProps = {
  href: string
  label?: string
} & Omit<DesignButtonProps, 'onClick'>

export default function CanvasEntryButton({
  href,
  label = '进入画布',
  ...buttonProps
}: CanvasEntryButtonProps): JSX.Element {
  return (
    <DesignButton
      className="canvas-entry-button"
      leftSection={<IconVectorBezier2 className="canvas-entry-button__icon" size={14} />}
      onClick={() => spaNavigate(href)}
      {...buttonProps}
    >
      {label}
    </DesignButton>
  )
}
