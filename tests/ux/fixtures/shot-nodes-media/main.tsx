// Real complete storyboard row and media decoder. Fixed props are a renderer contract,
// not a generated production run. nomi-local serves bytes from an isolated project.
import React from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter/wght.css'
import '../../../../src/styles/index.css'
import '../../../../src/i18n'
import { NomiAppProviders } from '../../../../src/NomiAppProviders'
import { NomiColorSchemeProvider } from '../../../../src/theme/NomiColorSchemeProvider'
import { TableStage } from '../../../../src/devlab/designLab/storyboard/storyboardLabKit'
import { deriveShotRowExec } from '../../../../src/workbench/creation/storyboard/exec/storyboardRowStatus'
import { labShot, labPlan, LAB_ANCHORS, LAB_VIDEO_MODELS } from '../../../../src/devlab/designLab/storyboard/storyboardFixtures'
import type { GenerationCanvasNode } from '../../../../src/workbench/generationCanvas/model/generationCanvasTypes'

import StoryboardShotRow from '../../../../src/workbench/creation/storyboard/shotRow/StoryboardShotRow'
import { useGenerationQueueStore } from '../../../../src/workbench/generationCanvas/runner/generationQueueStore'

const params = new URLSearchParams(location.search)
const url = params.get('media')!
const shot = labShot({ index: 1, shotId: 'media-shot', anchorIds: [], params: { aspect_ratio: '16:9' } })
const phase = params.get('phase') || 'success'
const node: GenerationCanvasNode = {
  id: 'media-node', kind: 'video', title: '镜头 1', position: { x: 0, y: 0 }, status: phase === 'queued' ? 'idle' : phase === 'running' ? 'running' : phase === 'error' ? 'error' : 'success',
  ...(phase === 'running' ? { progress: { phase: 'generating', updatedAt: Date.now() - 12000 } } : {}),
  ...(phase === 'error' ? { error: '镜头服务暂时不可用' } : {}),
  meta: { storyboardDesignId: 'media-design', shotId: 'media-shot' },
  ...(phase === 'success' ? { result: { id: 'media-result', type: 'video' as const, url, createdAt: 1 } } : {}),
}
if (phase === 'queued') useGenerationQueueStore.getState().enqueueBatch([['ahead-node', node.id]])
const retryCalls: string[] = []
Object.assign(window, { __shotRowFixture: { retryCalls } })
const noop = () => {}
const exec = deriveShotRowExec({ plan: labPlan({ shots: [shot] }), shot, designId: 'media-design', nodes: [node], mode: null })
createRoot(document.getElementById('root')!).render(
  <NomiColorSchemeProvider><NomiAppProviders>
    <main className="min-h-screen bg-nomi-bg p-8 text-nomi-ink">
      <TableStage><StoryboardShotRow shot={shot} exec={exec} anchors={LAB_ANCHORS}
        modelOptions={LAB_VIDEO_MODELS} danglingIds={[]} aspect="16:9" frameBox={{ width: 136, height: 77 }}
        aspectOverridden={false} aspectOptions={['16:9']} onChangeAspect={noop}
        onGenerate={() => retryCalls.push(node.id)} onUpdate={noop} onToggleAnchor={noop} onRemove={noop}
        onOpenPreview={noop} onRegenerate={noop} onToggleLock={noop} />
      </TableStage>
    </main>
  </NomiAppProviders></NomiColorSchemeProvider>,
)
