import React from 'react'
import { MantineProvider } from '@mantine/core'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import GenerationCanvas from '../../src/workbench/generationCanvasV2/components/GenerationCanvas'
import { useGenerationCanvasStore } from '../../src/workbench/generationCanvasV2/store/generationCanvasStore'

function renderCanvas(readOnly: boolean): HTMLElement {
  const result = render(
    <MantineProvider forceColorScheme="light">
      <GenerationCanvas readOnly={readOnly} />
    </MantineProvider>,
  )
  return result.container
}

describe('GenerationCanvas readOnly mode', () => {
  beforeEach(() => {
    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: [
        {
          id: 'readonly-image',
          kind: 'image',
          title: '只读图片',
          position: { x: 120, y: 120 },
          size: { width: 320, height: 220 },
          prompt: '只读 prompt',
          references: [],
          history: [],
          status: 'idle',
          meta: {},
        },
      ],
      edges: [],
      selectedNodeIds: [],
    })
  })

  it('hides editing affordances in share/read-only surfaces', () => {
    renderCanvas(true)

    expect(screen.queryByLabelText('生成画布工具栏')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('从此节点开始连线')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('连接到此节点')).not.toBeInTheDocument()
  })

  it('keeps editable controls available in normal studio mode', () => {
    const container = renderCanvas(false)

    expect(screen.getByLabelText('生成画布工具栏')).toBeInTheDocument()
    expect(screen.getByLabelText('从此节点开始连线')).toBeInTheDocument()
    const nodeElement = container.querySelector('.generation-canvas-v2-node')
    expect(nodeElement).not.toBeNull()
    if (!nodeElement) throw new Error('generation canvas node was not rendered')

    fireEvent.pointerDown(nodeElement)
    expect(screen.getByLabelText('生成素材')).toBeInTheDocument()
  })

  it('does not register destructive keyboard editing handlers while read-only', async () => {
    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: [
        {
          id: 'readonly-image',
          kind: 'image',
          title: '只读图片',
          position: { x: 120, y: 120 },
          size: { width: 320, height: 220 },
          prompt: '只读 prompt',
          references: [],
          history: [],
          status: 'idle',
          meta: {},
        },
      ],
      edges: [],
      selectedNodeIds: ['readonly-image'],
    })
    renderCanvas(true)

    fireEvent.keyDown(window, { key: 'Delete' })

    await waitFor(() => {
      expect(useGenerationCanvasStore.getState().nodes.map((node) => node.id)).toEqual(['readonly-image'])
    })
  })

  it('allows destructive keyboard editing handlers in normal studio mode', () => {
    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: [
        {
          id: 'readonly-image',
          kind: 'image',
          title: '只读图片',
          position: { x: 120, y: 120 },
          size: { width: 320, height: 220 },
          prompt: '只读 prompt',
          references: [],
          history: [],
          status: 'idle',
          meta: {},
        },
      ],
      edges: [],
      selectedNodeIds: ['readonly-image'],
    })
    renderCanvas(false)

    act(() => {
      useGenerationCanvasStore.getState().selectNode('readonly-image')
    })
    fireEvent.keyDown(window, { key: 'Delete' })

    expect(useGenerationCanvasStore.getState().nodes).toEqual([])
  })
})
