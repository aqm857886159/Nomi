import { isMonochromeVendorLogo } from '../assets/vendor-logos'
import { cn } from '../utils/cn'

type VendorLogoImageProps = {
  src: string
  /** 由宿主决定尺寸/定位（`size-full`、`absolute inset-0` 等）；本组件只管品牌图本身怎么画。 */
  className?: string
  /** 打包资产 404 时的回调；宿主据此换成字形兜底。 */
  onError?: () => void
}

/**
 * 品牌图的唯一渲染口。
 *
 * 收口成一个组件的原因（2026-09-14）：此前四处各写一份
 * `<img src={logo} className="…object-contain">`（模型/供应商小标、接入行、接入页、接入卡），
 * 于是「单色标在暗色模式要反相」这条规矩漏抄一处就漏一处。判据本身住
 * `src/assets/vendor-logos`，这里只负责把它落到 DOM 上。
 *
 * 注意：本组件**不画底**。要遮住身后的东西请让宿主自己处理——不透明底和 `dark:invert`
 * 放在同一个元素上会被一起反相，把「暗底白标」翻成「亮底白标」。
 */
export function VendorLogoImage({ src, className, onError }: VendorLogoImageProps): JSX.Element {
  return (
    <img
      src={src}
      alt=""
      aria-hidden
      className={cn('object-contain', isMonochromeVendorLogo(src) && 'dark:invert', className)}
      onError={onError}
    />
  )
}
