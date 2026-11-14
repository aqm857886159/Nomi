import React, { type JSX } from 'react'
import { IconBox, IconPlugConnected } from '@tabler/icons-react'
import { cn } from '../utils/cn'
import { VendorLogoImage } from './vendorLogoImage'

export type NomiIdentityIconSource = Readonly<{
  src?: string
  fallback?: string
  /** 单色标（`currentColor` 笔画、无底板）：暗色模式反相成白。 */
  monochrome?: boolean
  kind: 'model' | 'provider'
}>

type NomiIdentityIconProps = {
  icon: NomiIdentityIconSource
  /** sm 16 · md 18（行内小标）· lg 28 方块底（模型菜单每行的品牌图，图在方块里留白）。 */
  size?: 'sm' | 'md' | 'lg'
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
  const pixels = size === 'lg' ? 28 : size === 'md' ? 18 : 16
  const showImage = Boolean(icon.src) && !imageFailed
  return (
    <span
      aria-hidden
      // 走查锚点：三个页面（画布节点 / 画布列表 / 分镜行）的模型菜单是不是同一个组件，量的就是这一枚。
      data-identity-icon={icon.kind}
      data-identity-icon-face={showImage ? 'logo' : fallback ? 'initial' : 'generic'}
      className={cn(
        'relative inline-grid shrink-0 place-items-center overflow-hidden border border-nomi-line bg-nomi-paper text-nomi-ink-60',
        size === 'lg' ? 'rounded-nomi' : 'rounded-nomi-sm',
        size === 'sm' ? 'size-4' : '',
        className,
      )}
      style={size === 'sm' ? undefined : { width: pixels, height: pixels }}
    >
      {showImage && icon.src ? (
        <VendorLogoImage src={icon.src} monochrome={icon.monochrome} className={cn('absolute inset-0 size-full', size === 'lg' ? 'p-1.5' : icon.monochrome && 'p-[2.5px]')} onError={() => setImageFailed(true)} />
      ) : fallback ? (
        <span className={cn('font-semibold leading-none', size === 'lg' ? 'text-caption' : 'text-micro')}>{fallback}</span>
      ) : icon.kind === 'provider' ? (
        <IconPlugConnected size={pixels - 5} stroke={1.7} />
      ) : (
        <IconBox size={pixels - 5} stroke={1.7} />
      )}
    </span>
  )
}
