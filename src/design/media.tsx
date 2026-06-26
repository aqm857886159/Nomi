import React from 'react'
import { cn } from '../utils/cn'
import { IconPhoto } from '../vendor/tablerIcons'

/**
 * 统一图片基元。所有渲染图片的地方都该走它，而不是裸 <img>：
 *  - loading="lazy" + decoding="async"：不可见的图先不加载、解码不阻塞主线程（图多不卡的关键）
 *  - thumbnailSrc：缩略图优先——画布/列表只要小图，点开大图才用原图，避免拿原始大图当缩略图
 *  - 默认 draggable=false：画布/卡片里的图不该被浏览器原生拖拽劫持
 *  - onError 兜底：加载失败时显示**可读占位**（不再是浏览器裂图图标），并把失败 URL 打进控制台
 *    （诊断「传图有时显示错误」——下次发生时能直接看到是哪个 URL 404）。src 变化会自动清错重试。
 *
 * 单一真相源：lazy/decode 策略 + 失败兜底集中在此一处，全局生效（P1 不造并行版）。
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
  onError,
  ...rest
}: NomiImageProps): JSX.Element {
  const resolvedSrc = thumbnailSrc || src
  const [failed, setFailed] = React.useState(false)
  // src 变化（重新生成 / 重新导入 / 换图）→ 清掉上一次的失败态，给新 URL 一次机会。
  React.useEffect(() => { setFailed(false) }, [resolvedSrc])

  if (failed || !resolvedSrc) {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center gap-1 bg-nomi-ink-05 text-nomi-ink-40 select-none',
          className,
        )}
        title={resolvedSrc ? `图片加载失败：${resolvedSrc}` : '无图片'}
        aria-label='图片加载失败'>
        <IconPhoto size={18} stroke={1.6} />
        <span className='text-body-sm'>加载失败</span>
      </div>
    )
  }

  return (
    <img
      {...rest}
      src={resolvedSrc}
      alt={alt}
      draggable={draggable}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      className={cn(className)}
      onError={(event) => {
        // 诊断单源：失败 URL 打进控制台（区分 404/协议/跨项目），再切占位。
        // eslint-disable-next-line no-console
        console.warn('[NomiImage] 图片加载失败', resolvedSrc)
        setFailed(true)
        onError?.(event)
      }}
    />
  )
}
