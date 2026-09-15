import React from 'react'
import { IconBox, IconPlugConnected } from '@tabler/icons-react'
import { cn } from '../utils/cn'
import { VendorLogoImage } from './vendorLogoImage'

export type NomiIdentityIconSource = Readonly<{
  src?: string
  fallback?: string
  kind: 'model' | 'provider'
}>

type NomiIdentityIconProps = {
  icon: NomiIdentityIconSource
  size?: 'sm' | 'md'
  className?: string
}

/**
 * Local-only identity mark used by compact selectors.
 *
 * 品牌图加载失败时才换成文字/图标兜底——**不是**把兜底压在图片背后用不透明底盖住。
 * 旧写法之所以要盖：图片自带 `bg-nomi-paper`。而单色标（透明底的深色笔画）暗色模式要反相，
 * 反相会把那层底一起翻过去，「暗底白标」变成「亮底白标」= 整个标消失。底和图分开，这条就没了。
 */
export function NomiIdentityIcon({ icon, size = 'sm', className }: NomiIdentityIconProps): JSX.Element {
  const [imageFailed, setImageFailed] = React.useState(false)
  React.useEffect(() => { setImageFailed(false) }, [icon.src])
  const fallback = icon.fallback?.trim().slice(0, 2)
  const pixels = size === 'md' ? 18 : 16
  const showImage = Boolean(icon.src) && !imageFailed
  return (
    <span
      aria-hidden
      className={cn(
        'relative inline-grid shrink-0 place-items-center overflow-hidden rounded-nomi-sm border border-nomi-line bg-nomi-paper text-nomi-ink-60',
        size === 'sm' ? 'size-4' : '',
        className,
      )}
      style={size === 'md' ? { width: pixels, height: pixels } : undefined}
    >
      {showImage && icon.src ? (
        <VendorLogoImage src={icon.src} className="absolute inset-0 size-full" onError={() => setImageFailed(true)} />
      ) : fallback ? (
        <span className="text-micro font-semibold leading-none">{fallback}</span>
      ) : icon.kind === 'provider' ? (
        <IconPlugConnected size={pixels - 5} stroke={1.7} />
      ) : (
        <IconBox size={pixels - 5} stroke={1.7} />
      )}
    </span>
  )
}
