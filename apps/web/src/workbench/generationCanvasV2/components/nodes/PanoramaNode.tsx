import React from 'react'
import { IconUpload, IconMaximize } from '@tabler/icons-react'
import type { GenerationCanvasNode } from '../../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../../store/generationCanvasStore'
import { WorkbenchButton } from '../../../../design'
import PanoramaViewer from './PanoramaViewer'

type PanoramaNodeProps = {
  node: GenerationCanvasNode
  selected: boolean
  readOnly?: boolean
}

export default function PanoramaNode({ node, selected, readOnly }: PanoramaNodeProps): JSX.Element {
  const updateNode = useGenerationCanvasStore((state) => state.updateNode)
  const [fullscreen, setFullscreen] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const imageUrl = React.useMemo(() => {
    if (node.references && node.references.length > 0) {
      const store = useGenerationCanvasStore.getState()
      const refNode = store.nodes.find((n) => n.id === node.references![0])
      if (refNode?.result?.url) return refNode.result.url
    }
    return node.meta?.imageUrl as string | undefined
  }, [node.references, node.meta?.imageUrl])

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const url = URL.createObjectURL(file)
    updateNode(node.id, { meta: { ...node.meta, imageUrl: url, imageSource: 'upload' } })
  }

  return (
    <div
      className="generation-node panorama-node"
      data-selected={selected}
      style={{ width: node.size?.width, height: node.size?.height }}
    >
      <div className="panorama-node__header">
        <span>{node.title}</span>
        {!readOnly && (
          <div className="panorama-node__actions">
            <WorkbenchButton size="xs" onClick={() => fileInputRef.current?.click()}>
              <IconUpload size={14} />
            </WorkbenchButton>
            {imageUrl && (
              <WorkbenchButton size="xs" onClick={() => setFullscreen(true)}>
                <IconMaximize size={14} />
              </WorkbenchButton>
            )}
          </div>
        )}
      </div>

      <div className="panorama-node__content">
        {imageUrl ? (
          <PanoramaViewer
            imageUrl={imageUrl}
            width={node.size?.width || 400}
            height={(node.size?.height || 300) - 40}
          />
        ) : (
          <div className="panorama-node__placeholder">点击上传全景图或连接图片节点</div>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleUpload}
      />

      {fullscreen && imageUrl && (
        <div className="panorama-fullscreen" onClick={() => setFullscreen(false)}>
          <PanoramaViewer imageUrl={imageUrl} width={window.innerWidth} height={window.innerHeight} />
        </div>
      )}
    </div>
