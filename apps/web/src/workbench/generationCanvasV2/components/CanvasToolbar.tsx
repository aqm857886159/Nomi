import React from 'react'
import {
  IconBoxMultiple,
  IconCopy,
  IconCut,
  IconFlag,
  IconLayoutGrid,
  IconPhoto,
  IconPlus,
  IconUser,
  IconVideo,
  IconWriting,
} from '@tabler/icons-react'
import { WorkbenchButton } from '../../../design'
import type { GenerationNodeKind } from '../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'

const QUICK_ADD: Array<{ kind: GenerationNodeKind; label: string; icon: React.ReactNode }> = [
  { kind: 'text', label: '文本', icon: <IconWriting size={15} /> },
  { kind: 'character', label: '角色', icon: <IconUser size={15} /> },
  { kind: 'scene', label: '场景', icon: <IconLayoutGrid size={15} /> },
  { kind: 'image', label: '图片', icon: <IconPhoto size={15} /> },
  { kind: 'keyframe', label: '关键帧', icon: <IconFlag size={15} /> },
  { kind: 'video', label: '视频', icon: <IconVideo size={15} /> },
  { kind: 'shot', label: '镜头', icon: <IconBoxMultiple size={15} /> },
  { kind: 'output', label: '输出', icon: <IconFlag size={15} /> },
]

type CanvasToolbarProps = {
  getInsertionPosition: () => { x: number; y: number }
}

export default function CanvasToolbar({ getInsertionPosition }: CanvasToolbarProps): JSX.Element {
  const addNode = useGenerationCanvasStore((state) => state.addNode)
  const selectedNodeIds = useGenerationCanvasStore((state) => state.selectedNodeIds)
  const copySelectedNodes = useGenerationCanvasStore((state) => state.copySelectedNodes)
  const cutSelectedNodes = useGenerationCanvasStore((state) => state.cutSelectedNodes)
  const pendingConnectionSourceId = useGenerationCanvasStore((state) => state.pendingConnectionSourceId)
  const [nodeMenuOpen, setNodeMenuOpen] = React.useState(false)

  const handleAddNode = (kind: GenerationNodeKind) => {
    addNode({ kind, position: getInsertionPosition() })
    setNodeMenuOpen(false)
  }

  return (
    <div className="generation-canvas-v2-toolbar" aria-label="生成画布工具栏">
      <WorkbenchButton
        aria-label="添加节点"
        title="添加节点"
        data-primary="true"
        onClick={() => setNodeMenuOpen((open) => !open)}
      >
        <IconPlus size={17} />
        <span>添加</span>
      </WorkbenchButton>
      {nodeMenuOpen ? (
        <div className="generation-canvas-v2-toolbar__node-menu" role="menu" aria-label="添加节点菜单">
          {QUICK_ADD.map((item) => (
            <WorkbenchButton
              key={item.kind}
              role="menuitem"
              aria-label={`添加${item.label}节点`}
              onClick={() => handleAddNode(item.kind)}
            >
              {item.icon}
              <span>{item.label}</span>
            </WorkbenchButton>
          ))}
        </div>
      ) : null}
      <span className="generation-canvas-v2-toolbar__divider" />
      <WorkbenchButton aria-label="添加文本节点" title="文本" onClick={() => handleAddNode('text')}>
        <IconWriting size={15} />
        <span>文本</span>
      </WorkbenchButton>
      <WorkbenchButton aria-label="添加图片节点" title="图像" onClick={() => handleAddNode('image')}>
        <IconPhoto size={15} />
        <span>图像</span>
      </WorkbenchButton>
      <WorkbenchButton aria-label="添加视频节点" title="视频" onClick={() => handleAddNode('video')}>
        <IconVideo size={15} />
        <span>视频</span>
      </WorkbenchButton>
      <span className="generation-canvas-v2-toolbar__divider" />
      <span className="generation-canvas-v2-toolbar__hint" data-active={pendingConnectionSourceId ? 'true' : 'false'}>
        {pendingConnectionSourceId ? '选择目标节点' : '拖拽空白区域框选'}
      </span>
      <WorkbenchButton aria-label="复制选中节点" title="复制选中节点" disabled={selectedNodeIds.length === 0} onClick={copySelectedNodes}>
        <IconCopy size={15} />
        <span>复制</span>
      </WorkbenchButton>
      <WorkbenchButton aria-label="剪切选中节点" title="剪切选中节点" disabled={selectedNodeIds.length === 0} onClick={cutSelectedNodes}>
        <IconCut size={15} />
        <span>剪切</span>
      </WorkbenchButton>
    </div>
  )
}
