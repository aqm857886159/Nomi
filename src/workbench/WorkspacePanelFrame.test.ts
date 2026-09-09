import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AgentPanelV4Panel } from './ai/v4/AgentPanelV4Panel'
import { describe, expect, it } from 'vitest'
import { WorkspacePanelFrameContext, useWorkspacePanelFrame, workspacePanelFrame, workspacePanelHeader } from './WorkspacePanelFrame'

function Probe(): JSX.Element {
  return React.createElement('section', { 'data-enabled': useWorkspacePanelFrame(), className: workspacePanelFrame }, React.createElement('header', { className: workspacePanelHeader }))
}
describe('creation workspace frame boundary', () => {
  it('does not enable creation geometry for standalone or other workspace consumers', () => {
    expect(renderToStaticMarkup(React.createElement(Probe))).toContain('data-enabled="false"')
  })
  it('shares the approved frame and header for all descendants of the creation host', () => {
    const html = renderToStaticMarkup(React.createElement(WorkspacePanelFrameContext.Provider, { value: true }, React.createElement(Probe), React.createElement(Probe), React.createElement(Probe)))
    expect(html.match(/data-enabled="true"/g)).toHaveLength(3)
    expect(workspacePanelFrame).toContain('rounded-nomi border border-nomi-line')
    expect(workspacePanelFrame).toContain('shadow-none')
    expect(workspacePanelHeader).toContain('h-12 px-3 py-0')
  })
})

it('keeps the real Agent body identical and its 40px header outside creation', () => {
  const panel = React.createElement(AgentPanelV4Panel, { flow: [], context: {} })
  const original = renderToStaticMarkup(panel)
  const creation = renderToStaticMarkup(React.createElement(WorkspacePanelFrameContext.Provider, { value: true }, panel))
  expect(original.split('</header>')[0]).toContain('h-10')
  expect(creation.split('</header>')[0]).toContain('h-12')
  expect(creation.split('</header>')[1]).toBe(original.split('</header>')[1])
})
