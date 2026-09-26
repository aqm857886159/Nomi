import React from 'react'
import { IconPackage } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { useRemoteExampleMedia } from '../../media/remoteExampleMedia'

export function SkillMedia({ cover, preview, play = false, controls = false, className, iconSize = 28, fallback }: {
  fallback?: React.ReactNode
  cover?: string
  preview?: { url: string; type: 'image' | 'video' }
  play?: boolean
  controls?: boolean
  className?: string
  /**
   * 没图时那个图标画多大。默认 28 是画廊卡的尺寸；**16px 的 chip 必须自己传**，
   * 否则图标比框还大，溢出去糊在 chip 的字上（chip 上没图时用户看到的是「一坨」）。
   */
  iconSize?: number
}): JSX.Element {
  const url = preview?.url || cover
  // 公开示例的媒体地址归第三方站点：失效与提示词卡片同一份会话记账（同一地址不反复请求）。
  const { broken, onError } = useRemoteExampleMedia(url)
  if (!url || broken) return <span className={cn('grid place-items-center bg-nomi-ink-05 text-nomi-ink-30', className)} data-skill-media="placeholder">{fallback ?? <IconPackage size={iconSize} stroke={1.5} />}</span>
  if (preview?.type === 'video') return <video src={url} poster={cover} muted loop autoPlay={play} controls={controls} playsInline preload="metadata" onError={onError} className={className} data-skill-media="video" />
  return <img src={url} alt="" loading="lazy" onError={onError} className={cn('block', className)} data-skill-media="image" />
}
