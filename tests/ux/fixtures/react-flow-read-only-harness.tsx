import React from 'react'
import { createRoot } from 'react-dom/client'
import '@mantine/core/styles/UnstyledButton.css'
import '@mantine/core/styles/CloseButton.css'
import '@mantine/core/styles/Notification.css'
import '@mantine/notifications/styles.css'
import '../../../src/styles/index.css'
import { NomiAppProviders } from '../../../src/NomiAppProviders'
import { NomiColorSchemeProvider } from '../../../src/theme/NomiColorSchemeProvider'
import GenerationCanvas from '../../../src/workbench/generationCanvas/components/GenerationCanvas'
import { useGenerationCanvasStore } from '../../../src/workbench/generationCanvas/store/generationCanvasStore'

const snapshot = {
  nodes: [
    {
      id: 'readonly-source',
      kind: 'image' as const,
      title: '只读来源',
      categoryId: 'shots',
      position: { x: 140, y: 180 },
      size: { width: 320, height: 220 },
    },
    {
      id: 'readonly-target',
      kind: 'image' as const,
      title: '只读目标',
      categoryId: 'shots',
      position: { x: 700, y: 260 },
      size: { width: 320, height: 220 },
    },
  ],
  edges: [{ id: 'readonly-edge', source: 'readonly-source', target: 'readonly-target', mode: 'reference' as const }],
  selectedNodeIds: [],
  groups: [{
    id: 'readonly-group',
    name: '只读编组',
    categoryId: 'shots',
    nodeIds: ['readonly-source', 'readonly-target'],
    createdAt: 1,
    updatedAt: 1,
  }],
}

useGenerationCanvasStore.getState().restoreSnapshot(snapshot)

const root = document.getElementById('root')
if (!root) throw new Error('Read-only harness root is missing')

createRoot(root).render(
  <React.StrictMode>
    <NomiColorSchemeProvider>
      <NomiAppProviders>
        <GenerationCanvas readOnly />
      </NomiAppProviders>
    </NomiColorSchemeProvider>
  </React.StrictMode>,
)
