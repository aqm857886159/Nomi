import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import AssetPicker from '../../assets/AssetPicker'
import AssetPickerPopover from '../../assets/AssetPickerPopover'
import AssetReferenceButton from '../../assets/AssetReferenceButton'
import AssetTile, { AssetAddTile } from '../../assets/AssetTile'
import { canvasNodeToAssetRefs, type AssetKind } from '../../assets/assetTypes'
import { useOpenProjectId } from '../../project/useOpenProjectId'
import { addAssetInput, addUploadedInput, pickCanvasInputFor } from '../quickActions/nodeInputActions'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { useComposerGraph } from './composerGraphSnapshot'

/** Text/image nodes without a declared media slot use the existing left-input owner. */
export default function NodeInputReferenceEntry({ nodeId, disabled, accept = ['image'] }: { nodeId: string; disabled?: boolean; accept?: AssetKind[] }): JSX.Element {
  const { t } = useTranslation()
  const projectId = useOpenProjectId()
  const [open, setOpen] = React.useState(false)
  const [uploading, setUploading] = React.useState(false)
  const [error, setError] = React.useState('')
  // 进行中的那次上传「用户取消了没有」：只在用户关选择器的那几下里记（点外面 / Esc / 再点「+」/「画布点选」/ 选了一项 /「浏览全部」，
  // 全走 closePicker）。这个组件卸载不算：导入建卡会把选中切到新卡，画布里的生成框随之卸载——那是这次上传自己造成的，
  // 拿它当「用户关掉了」，完成时就永远不接线（2026-10-27 回归）。
  const upload = React.useRef<{ cancelled: boolean } | null>(null)
  const closePicker = () => {
    if (upload.current) upload.current.cancelled = true
    setOpen(false)
  }
  const cancelPick = React.useRef<(() => void) | undefined>(undefined)
  React.useEffect(() => () => cancelPick.current?.(), [nodeId, projectId])
  // 只订这张卡读得到的那一小片图：整表订阅会让别的卡的生成进度把它带着重渲（2026-10-16 可疑点 g）。
  const { nodes, edges } = useComposerGraph(nodeId)
  const inputs = edges.filter(edge => edge.target === nodeId).flatMap(edge => {
    const source = nodes.find(node => node.id === edge.source)
    const asset = source && canvasNodeToAssetRefs(source)[0]
    return asset ? [{ edge, asset }] : []
  })
  return <div className="flex flex-col gap-2">
    <div className="flex flex-wrap items-center gap-2">
      <AssetReferenceButton disabled={disabled || uploading} onClick={() => { closePicker(); cancelPick.current = pickCanvasInputFor(nodeId) }} />
      {inputs.map(({ edge, asset }) => <AssetTile key={edge.id} asset={asset} sourceLabel={t('assetLibrary.refRow.sourceCanvas')}
          tipText={t('assetLibrary.refRow.tipConnected', { name: asset.name })} removeLabel={t('assetLibrary.refRow.disconnect')}
        onRemove={disabled ? undefined : () => useGenerationCanvasStore.getState().disconnectEdge(edge.id)} />)}
      <fieldset disabled={disabled || uploading} className="relative m-0 min-w-0 border-0 p-0 disabled:opacity-50">
        <AssetAddTile selected={open} onClick={() => (open ? closePicker() : setOpen(true))} />
      {open ? <AssetPickerPopover onClose={closePicker}><AssetPicker projectId={projectId} accept={accept} uploading={uploading}
        onPick={asset => {
          closePicker()
          addAssetInput(nodeId, asset)
        }}
        onUpload={file => {
          const current = { cancelled: false }
          upload.current = current
          setUploading(true); setError('')
          void addUploadedInput(nodeId, file, { shouldConnect: () => !current.cancelled }).catch(() => setError(t('assetLibrary.importFailed')))
            .finally(() => { if (upload.current === current) upload.current = null; setUploading(false) })
        }}
        onBrowseAll={() => { closePicker(); window.dispatchEvent(new CustomEvent('nomi-open-files-panel')) }} />
      </AssetPickerPopover> : null}
      </fieldset>
    </div>
    {error ? <span role="alert" className="text-micro text-workbench-danger">{error}</span> : null}
  </div>
}
