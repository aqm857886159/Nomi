import React from 'react'
import type { GenerationCanvasNode } from '../../model/generationCanvasTypes'
import CharacterCardNode from './CharacterCardNode'
import SceneCardNode from './SceneCardNode'
import PropCardNode from './PropCardNode'
import AudioStripNode from './AudioStripNode'
// 画板 body 懒加载：它链到 WhiteboardModal→Leafer 画布(重)，只在画布真有画板节点时才拉。
const WhiteboardCardBody = React.lazy(() => import('../whiteboard/WhiteboardCardBody'))

/**
 * 卡片式 body 分发（从 BaseGenerationNode 抽出，R9 治巨壳 + 收口）。
 * 非 shots 分类的节点（角色/场景/道具/音频/画板）共用同一外壳，只在中间换各自的 body 组件，
 * preview div + composer 由外壳按 isCardKind 隐藏。renderKind 真相源见 resolveRenderKind。
 */
export function NodeCardBody({
  renderKind,
  node,
  readOnly,
}: {
  renderKind: string | undefined
  node: GenerationCanvasNode
  readOnly: boolean
}): JSX.Element {
  return (
    <div className='w-full h-full rounded-nomi shadow-nomi-md overflow-hidden ring-1 ring-inset ring-nomi-line'>
      {renderKind === 'character-card' && <CharacterCardNode node={node} />}
      {renderKind === 'scene-card' && <SceneCardNode node={node} />}
      {renderKind === 'prop-card' && <PropCardNode node={node} />}
      {renderKind === 'audio-strip' && <AudioStripNode node={node} />}
      {renderKind === 'whiteboard-card' && (
        <React.Suspense fallback={<div className='h-full w-full bg-nomi-paper' />}>
          <WhiteboardCardBody node={node} readOnly={readOnly} />
        </React.Suspense>
      )}
    </div>
  )
}
