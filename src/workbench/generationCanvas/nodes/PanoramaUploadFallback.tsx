import React from 'react'
import { cn } from '../../../utils/cn'

/**
 * 全景节点「未生成」态的「+ 上传全景图」回退入口。
 * 从 BaseGenerationNode 抽出（R9 巨壳瘦身，给 model3d 预览分支腾空间）——纯展示 + 单个 onChange，无状态。
 */
export default function PanoramaUploadFallback({
  onChange,
}: {
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void
}): JSX.Element {
  return (
    <div className={cn('flex w-full h-full items-center justify-center')}>
      <label
        className={cn(
          'inline-flex items-center justify-center',
          'min-w-[156px] min-h-[48px] px-[18px]',
          'text-nomi-ink-60 text-body-sm cursor-pointer',
        )}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <span>+ 上传全景图</span>
        <input className='hidden' type='file' accept='image/*' onChange={onChange} />
      </label>
    </div>
  )
}
