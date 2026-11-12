import React from 'react'
import { MantineProvider } from '@mantine/core'
import { renderToStaticMarkup } from 'react-dom/server'
import { vi } from 'vitest'
import ShotComposerBar from '../../src/workbench/creation/storyboard/shotRow/ShotComposerBar.tsx'
import StoryboardShotRow from '../../src/workbench/creation/storyboard/shotRow/StoryboardShotRow.tsx'
import InlineParameterBar from '../../src/workbench/generationCanvas/nodes/InlineParameterBar.tsx'

const captured = vi.hoisted(() => ({ props: null, reference: null }))
vi.mock('react-i18next', async original => ({ ...await original(), useTranslation: () => ({ t: key => key }) }))
vi.mock('../../src/workbench/creation/storyboard/shotRow/StoryboardComposerParams.tsx', () => ({ default: props => { captured.props = props; return null } }))
vi.mock('../../src/workbench/creation/storyboard/shotRow/ShotReferenceStrip.tsx', () => ({ default: props => { captured.reference = props; return null } }))
vi.mock('../../src/workbench/creation/storyboard/shotRow/PromptSkeletonSegments.tsx', () => ({ default: () => null }))
vi.mock('../../src/workbench/creation/storyboard/shotRow/StoryboardShotFrame.tsx', () => ({ default: () => null }))

// Only unrelated child views are replaced; callbacks come from the production parent.
export function composerWrite(shot, option, action) {
  let patch
  captured.props = null
  renderToStaticMarkup(React.createElement(ShotComposerBar, { shot, modelOptions: [option], aspect: '', onChangeAspect: () => {}, onUpdate: value => { patch = value } }))
  if (!captured.props) throw new Error('ShotComposerBar did not render its parameter child')
  action(captured.props)
  if (!patch) throw new Error('ShotComposerBar callback did not write')
  return patch
}
export function referenceModeWrite(shot, option, modeId) {
  let patch
  captured.reference = null
  renderRow(shot, option, { onUpdate: value => { patch = value } })
  if (!captured.reference?.onSwitchMode) throw new Error('reference mode callback not rendered')
  captured.reference.onSwitchMode(modeId)
  if (!patch) throw new Error('reference mode callback did not write')
  return patch
}
export function renderRow(shot, option, extra = {}) {
  return renderToStaticMarkup(React.createElement(MantineProvider, null, React.createElement(StoryboardShotRow, {
    shot, anchors: [], modelOptions: [option], aspect: '', frameBox: { width: 240, height: 135 }, onChangeAspect: () => {}, onUpdate: () => {}, onRemove: () => {}, ...extra,
  })))
}
export function renderParameters(target, meta, renderedControls) {
  return renderToStaticMarkup(React.createElement(MantineProvider, null, React.createElement(InlineParameterBar, {
    modelOptions: [target.row.option], selectedModelOption: target.row.option, modelCatalogStatus: { message: '' },
    renderedControls, archetype: target.row.archetype, meta, onModelChange: () => {}, onCatalogControlChange: () => {}, onParameterControlChange: () => {},
  })))
}
