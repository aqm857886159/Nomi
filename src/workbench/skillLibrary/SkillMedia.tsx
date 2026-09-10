import React from 'react'
import { IconPackage } from '@tabler/icons-react'
import { cn } from '../../utils/cn'

export function SkillMedia({ cover, preview, play = false, controls = false, className }: {
  cover?: string
  preview?: { url: string; type: 'image' | 'video' }
  play?: boolean
  controls?: boolean
  className?: string
}): JSX.Element {
  const [broken, setBroken] = React.useState(false)
  const url = preview?.url || cover
  React.useEffect(() => setBroken(false), [url])
  if (!url || broken) return <span className={cn('grid place-items-center bg-nomi-ink-05 text-nomi-ink-30', className)} data-skill-media="placeholder"><IconPackage size={28} stroke={1.5} /></span>
  if (preview?.type === 'video') return <video src={url} poster={cover} muted loop autoPlay={play} controls={controls} playsInline preload="metadata" onError={() => setBroken(true)} className={className} data-skill-media="video" />
  return <img src={url} alt="" loading="lazy" onError={() => setBroken(true)} className={cn('block', className)} data-skill-media="image" />
}
