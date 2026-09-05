import React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../../utils/cn'
import { IconPhoto, IconUpload } from '../../../vendor/tablerIcons'
import { NodeEmptyState } from './render/NodeEmptyState'

/**
 * 全景节点「未生成」态的「+ 上传全景图」回退入口。
 * 从 BaseGenerationNode 抽出（R9 巨壳瘦身，给 model3d 预览分支腾空间）——纯展示 + 单个 onChange，无状态。
 */
export default function PanoramaUploadFallback({
  onChange,
}: {
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <div className={cn('h-full w-full')}>
      <label
        className="block h-full w-full cursor-pointer text-nomi-ink-60 transition-colors hover:bg-nomi-ink-05/50"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <NodeEmptyState
          icon={<IconPhoto size={20} stroke={1.6} />}
          title={t('generationCommon.nodeEmpty.panorama.title')}
          description={t('generationCommon.nodeEmpty.panorama.description')}
          action={<span className="inline-flex items-center gap-1.5 rounded-nomi-sm bg-nomi-ink px-3 py-1.5 text-caption font-medium text-nomi-paper"><IconUpload size={14} stroke={1.8} />{t('generationCommon.node.uploadPanorama')}</span>}
        />
        <input className="hidden" type="file" accept="image/*" onChange={onChange} />
      </label>
    </div>
  )
}
