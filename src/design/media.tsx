import React from 'react'
import { cn } from '../utils/cn'

/**
 * 统一图片基元。所有渲染图片的地方都该走它，而不是裸 <img>：
 *  - loading="lazy" + decoding="async"：不可见的图先不加载、解码不阻塞主线程（图多不卡的关键）
 *  - thumbnailSrc：缩略图优先——画布/列表只要小图，点开大图才用原图，避免拿原始大图当缩略图
 *  - 默认 draggable=false：画布/卡片里的图不该被浏览器原生拖拽劫持
 *
 * 单一真相源：lazy/decode 策略集中在此一处，全局生效（P1 不造并行版）。
 */
export type NomiImageProps = Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  src?: string
  /** 缩略图优先：传了就先用它显示（列表/画布预览）；不传则回退到 src。 */
  thumbnailSrc?: string
  /** 首屏/已确定可见时设 true 走 eager；默认 lazy。 */
  eager?: boolean
}

export function NomiImage({
  src,
  thumbnailSrc,
  eager = false,
  className,
  alt = '',
  draggable = false,
  ...rest
}: NomiImageProps): JSX.Element {
  const resolvedSrc = thumbnailSrc || src
  return (
    <img
      {...rest}
      src={resolvedSrc}
      alt={alt}
      draggable={draggable}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      className={cn(className)}
    />
  )
}
