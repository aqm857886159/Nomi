import React from 'react'
import { expect, it } from 'vitest'
import { createReactTestRenderer } from '../../workbench/ai/v4/testReactRenderer'
import { NodeLabelRow } from '../../workbench/generationCanvas/nodes/NodeLabelRow'
import { LabCanvasViewport } from './labCanvasViewport'

it('keeps the label visible outside a viewport and hides it only below 40% on the canvas', () => {
  const label = <NodeLabelRow>Shot</NodeLabelRow>
  let header: { props: Record<string, unknown> } | undefined
  const view = createReactTestRenderer({
    createInstance(type, props) {
      const instance = { props }
      if (type === 'header') header = instance
      return instance
    },
  })
  function visibility(element: React.ReactElement) {
    view.render(element)
    view.flushPassiveEffects()
    const style = header?.props.style
    expect(style).toBeDefined()
    return (style as React.CSSProperties).visibility
  }
  try {
    expect(visibility(label)).toBeUndefined()
    expect(visibility(<LabCanvasViewport zoom={0.39}>{label}</LabCanvasViewport>)).toBe('hidden')
    expect(visibility(<LabCanvasViewport zoom={0.4}>{label}</LabCanvasViewport>)).toBeUndefined()
  } finally {
    view.close()
  }
})
