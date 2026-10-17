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
  const openRef = React.useRef(false)
  openRef.current = open
  const cancelPick = React.useRef<(() => void) | undefined>(undefined)
  React.useEffect(() => () => { openRef.current = false; cancelPick.current?.() }, [nodeId, projectId])
  // 只订这张卡读得到的那一小片图：整表订阅会让别的卡的生成进度把它带着重渲（2026-10-16 可疑点 g）。
  const { nodes, edges } = useComposerGraph(nodeId)
  const inputs = edges.filter(edge => edge.target === nodeId).flatMap(edge => {
    const source = nodes.find(node => node.id === edge.source)
    const asset = source && canvasNodeToAssetRefs(source)[0]
    return asset ? [{ edge, asset }] : []
  })
  return <div className="flex flex-col gap-2">
    <div className="flex flex-wrap items-center gap-2">
      <AssetReferenceButton disabled={disabled || uploading} onClick={() => { setOpen(false); cancelPick.current = pickCanvasInputFor(nodeId) }} />
      {inputs.map(({ edge, asset }, index) => <AssetTile key={edge.id} asset={asset} index={index + 1}
        onRemove={disabled ? undefined : () => useGenerationCanvasStore.getState().disconnectEdge(edge.id)} />)}
      <fieldset disabled={disabled || uploading} className="relative m-0 min-w-0 border-0 p-0 disabled:opacity-50">
        <AssetAddTile selected={open} onClick={() => setOpen(value => !value)} />
      {open ? <AssetPickerPopover onClose={() => setOpen(false)}><AssetPicker projectId={projectId} accept={accept} uploading={uploading}
        onPick={asset => {
          setOpen(false)
          addAssetInput(nodeId, asset)
        }}
        onUpload={file => {
          setUploading(true); setError('')
          void addUploadedInput(nodeId, file, { shouldConnect: () => openRef.current }).catch(() => setError(t('assetLibrary.importFailed')))
            .finally(() => setUploading(false))
        }}
        onBrowseAll={() => { setOpen(false); window.dispatchEvent(new CustomEvent('nomi-open-files-panel')) }} />
      </AssetPickerPopover> : null}
      </fieldset>
    </div>
    {error ? <span role="alert" className="text-micro text-workbench-danger">{error}</span> : null}
  </div>
}
