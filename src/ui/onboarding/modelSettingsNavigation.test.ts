import { describe, expect, it } from 'vitest'
import {
  backModelSettingsPage,
  finishAdapterRunNavigation,
  closeModelSettingsDialog,
  createModelSettingsNavigation,
  currentModelSettingsPage,
  modelSettingsDialogEscapeAction,
  modelSettingsDialogOwner,
  openModelSettingsConnectionPage,
  openModelSettingsDialog,
  openModelSettingsDialogPage,
  openModelSettingsPage,
  replaceModelSettingsPage,
} from './modelSettingsNavigation'

describe('model settings navigation', () => {
  it('starts on the model home and keeps model child routes together', () => {
    let navigation = createModelSettingsNavigation()
    expect(currentModelSettingsPage(navigation)).toEqual({ type: 'home' })

    navigation = openModelSettingsPage(navigation, { type: 'connection', vendorKey: 'apimart' })
    navigation = openModelSettingsPage(navigation, {
      type: 'model',
      vendorKey: 'apimart',
      modelKey: 'seedance-2-pro',
    })
    navigation = openModelSettingsPage(navigation, {
      type: 'capability',
      vendorKey: 'apimart',
      modelKey: 'seedance-2-pro',
    })
    navigation = backModelSettingsPage(navigation)
    navigation = openModelSettingsPage(navigation, {
      type: 'script',
      vendorKey: 'apimart',
      modelKey: 'seedance-2-pro',
    })

    expect(currentModelSettingsPage(navigation)).toMatchObject({
      type: 'script',
      vendorKey: 'apimart',
      modelKey: 'seedance-2-pro',
    })
    expect(navigation.stack.map((page) => page.type)).toEqual(['home', 'connection', 'model', 'script'])
  })

  it('opens capability editing from a model and returns to that model', () => {
    let navigation = createModelSettingsNavigation()
    navigation = openModelSettingsPage(navigation, { type: 'connection', vendorKey: 'future-cloud' })
    navigation = openModelSettingsPage(navigation, {
      type: 'model',
      vendorKey: 'future-cloud',
      modelKey: 'future-video-v1',
    })
    navigation = openModelSettingsPage(navigation, {
      type: 'capability',
      vendorKey: 'future-cloud',
      modelKey: 'future-video-v1',
    })

    expect(navigation.stack.map((page) => page.type)).toEqual(['home', 'connection', 'model', 'capability'])
    navigation = backModelSettingsPage(navigation)
    expect(currentModelSettingsPage(navigation)).toEqual({
      type: 'model',
      vendorKey: 'future-cloud',
      modelKey: 'future-video-v1',
    })
  })

  it('keeps a model-owned child route in the same third-level dialog', () => {
    let navigation = createModelSettingsNavigation()
    navigation = openModelSettingsPage(navigation, { type: 'connection', vendorKey: 'future-cloud' })
    navigation = openModelSettingsPage(navigation, {
      type: 'model',
      vendorKey: 'future-cloud',
      modelKey: 'future-video-v1',
    })
    navigation = openModelSettingsPage(navigation, {
      type: 'script',
      vendorKey: 'future-cloud',
      modelKey: 'future-video-v1',
    })

    expect(modelSettingsDialogOwner(navigation)).toEqual({
      type: 'model',
      vendorKey: 'future-cloud',
      modelKey: 'future-video-v1',
    })
    expect(currentModelSettingsPage(closeModelSettingsDialog(navigation))).toEqual({
      type: 'connection',
      vendorKey: 'future-cloud',
    })
  })

  it('does not turn a task or direct script opened from home into a model dialog', () => {
    expect(modelSettingsDialogOwner(createModelSettingsNavigation({ type: 'verification', runId: 'run-1' }))).toBeNull()
    expect(modelSettingsDialogOwner(createModelSettingsNavigation({
      type: 'script',
      vendorKey: 'direct-script',
      modelKey: 'new-model',
    }))).toBeNull()
  })

  it('keeps model child routes in the same reversible right-pane stack', () => {
    let navigation = createModelSettingsNavigation()
    navigation = openModelSettingsPage(navigation, { type: 'connection', vendorKey: 'future-cloud' })
    navigation = openModelSettingsPage(navigation, {
      type: 'model',
      vendorKey: 'future-cloud',
      modelKey: 'future-video-v1',
    })
    navigation = openModelSettingsPage(navigation, {
      type: 'script',
      vendorKey: 'future-cloud',
      modelKey: 'future-video-v1',
    })

    expect(navigation.stack.map((page) => page.type)).toEqual(['home', 'connection', 'model', 'script'])
    navigation = backModelSettingsPage(navigation)
    expect(currentModelSettingsPage(navigation)).toEqual({
      type: 'model',
      vendorKey: 'future-cloud',
      modelKey: 'future-video-v1',
    })
    navigation = backModelSettingsPage(navigation)
    expect(currentModelSettingsPage(navigation)).toEqual({
      type: 'connection',
      vendorKey: 'future-cloud',
    })
  })

  it('opens a task or direct script from home as a normal right-pane route', () => {
    expect(currentModelSettingsPage(createModelSettingsNavigation({ type: 'verification', runId: 'run-1' }))).toEqual({
      type: 'verification',
      runId: 'run-1',
    })
    expect(currentModelSettingsPage(createModelSettingsNavigation({
      type: 'script',
      vendorKey: 'direct-script',
      modelKey: 'new-model',
    }))).toEqual({ type: 'script', vendorKey: 'direct-script', modelKey: 'new-model' })
  })

  it('backs from a model child route to the model and then its owning connection', () => {
    let navigation = createModelSettingsNavigation()
    navigation = openModelSettingsPage(navigation, { type: 'connection', vendorKey: 'future-cloud' })
    navigation = openModelSettingsPage(navigation, {
      type: 'model',
      vendorKey: 'future-cloud',
      modelKey: 'future-video-v1',
    })
    navigation = openModelSettingsPage(navigation, {
      type: 'script',
      vendorKey: 'future-cloud',
      modelKey: 'future-video-v1',
    })

    navigation = backModelSettingsPage(navigation)
    expect(currentModelSettingsPage(navigation)).toEqual({
      type: 'model',
      vendorKey: 'future-cloud',
      modelKey: 'future-video-v1',
    })
    navigation = backModelSettingsPage(navigation)
    expect(currentModelSettingsPage(navigation)).toEqual({
      type: 'connection',
      vendorKey: 'future-cloud',
    })
  })

  it('backs through every level without ever leaving an empty stack', () => {
    let navigation = createModelSettingsNavigation({ type: 'add', preset: 'newapi' })
    navigation = backModelSettingsPage(navigation)
    navigation = backModelSettingsPage(navigation)

    expect(navigation.stack).toEqual([{ type: 'home' }])
    expect(currentModelSettingsPage(navigation)).toEqual({ type: 'home' })
  })

  it('keeps the saved connection identity on an add-model route', () => {
    const navigation = createModelSettingsNavigation({ type: 'add', existingVendorKey: 'my-relay' })
    expect(currentModelSettingsPage(navigation)).toEqual({ type: 'add', existingVendorKey: 'my-relay' })
  })

  it('keeps the direct-script draft as an explicit add-page entry state', () => {
    const navigation = createModelSettingsNavigation({ type: 'add', initialScreen: 'scriptDraft' })
    expect(currentModelSettingsPage(navigation)).toEqual({ type: 'add', initialScreen: 'scriptDraft' })
  })

  it('replaces a transient verification page without duplicating browser-like history', () => {
    let navigation = createModelSettingsNavigation({ type: 'add' })
    navigation = replaceModelSettingsPage(navigation, { type: 'verification', runId: 'run-1' })

    expect(navigation.stack.map((page) => page.type)).toEqual(['home', 'verification'])
    expect(currentModelSettingsPage(navigation)).toEqual({ type: 'verification', runId: 'run-1' })
  })

  it('replaces add with a direct script draft so Back returns to the model home', () => {
    let navigation = createModelSettingsNavigation({ type: 'add' })
    navigation = replaceModelSettingsPage(navigation, {
      type: 'script',
      vendorKey: 'custom-script-1',
      modelKey: 'new-model',
    })

    expect(navigation.stack.map((page) => page.type)).toEqual(['home', 'script'])
    navigation = backModelSettingsPage(navigation)
    expect(currentModelSettingsPage(navigation)).toEqual({ type: 'home' })
  })

  it('keeps task routes independent from the connection-creation form', () => {
    const navigation = createModelSettingsNavigation({ type: 'verification', runId: 'run-1' })

    expect(currentModelSettingsPage(navigation)).toEqual({ type: 'verification', runId: 'run-1' })
  })

  it('keeps a stable home entry when the same destination is opened twice', () => {
    let navigation = createModelSettingsNavigation()
    navigation = openModelSettingsPage(navigation, { type: 'connection', vendorKey: 'openai' })
    navigation = openModelSettingsPage(navigation, { type: 'connection', vendorKey: 'openai' })

    expect(navigation.stack).toEqual([
      { type: 'home' },
      { type: 'connection', vendorKey: 'openai' },
    ])
  })

  it('keeps the owning connection behind a stale model route so recovery can go back', () => {
    let navigation = createModelSettingsNavigation()
    navigation = openModelSettingsPage(navigation, { type: 'connection', vendorKey: 'removed-provider' })
    navigation = openModelSettingsPage(navigation, {
      type: 'model',
      vendorKey: 'removed-provider',
      modelKey: 'removed-model',
    })

    expect(currentModelSettingsPage(navigation).type).toBe('model')
    navigation = backModelSettingsPage(navigation)
    expect(currentModelSettingsPage(navigation)).toEqual({ type: 'connection', vendorKey: 'removed-provider' })
  })

  it('collapses model dialog history and carries an exact connection-field recovery target', () => {
    let navigation = createModelSettingsNavigation({ type: 'connection', vendorKey: 'future-cloud' })
    navigation = openModelSettingsDialog(navigation, {
      vendorKey: 'future-cloud',
      modelKey: 'future-video-v1',
    })
    navigation = openModelSettingsPage(navigation, { type: 'verification', runId: 'run-1' })

    navigation = openModelSettingsConnectionPage(navigation, 'future-cloud', {
      target: 'apiKey',
      requestId: 7,
    })

    expect(navigation.stack).toEqual([
      { type: 'home' },
      {
        type: 'connection',
        vendorKey: 'future-cloud',
        focus: { target: 'apiKey', requestId: 7 },
      },
    ])
    expect(modelSettingsDialogOwner(navigation)).toBeNull()
  })

  it('keeps concrete model child routes in the same reversible page stack', () => {
    let navigation = createModelSettingsNavigation()
    navigation = openModelSettingsPage(navigation, { type: 'connection', vendorKey: 'future-cloud' })
    navigation = openModelSettingsPage(navigation, { type: 'model', vendorKey: 'future-cloud', modelKey: 'future-video-v1' })
    navigation = openModelSettingsPage(navigation, { type: 'script', vendorKey: 'future-cloud', modelKey: 'future-video-v1' })
    expect(currentModelSettingsPage(navigation).type).toBe('script')
    navigation = backModelSettingsPage(navigation)
    expect(currentModelSettingsPage(navigation).type).toBe('model')
    navigation = backModelSettingsPage(navigation)
    expect(currentModelSettingsPage(navigation)).toEqual({ type: 'connection', vendorKey: 'future-cloud' })
  })
})

describe('model-scoped third-level navigation', () => {
  it('backs from a model child page before Escape is allowed to close the dialog', () => {
    const modelNavigation = openModelSettingsDialog(
      createModelSettingsNavigation({ type: 'connection', vendorKey: 'relay' }),
      { vendorKey: 'relay', modelKey: 'video-v2' },
    )

    expect(modelSettingsDialogEscapeAction(modelNavigation)).toBe('close')

    const childPages = [
      { type: 'capability', vendorKey: 'relay', modelKey: 'video-v2' },
      { type: 'script', vendorKey: 'relay', modelKey: 'video-v2' },
      { type: 'verification', runId: 'run-1' },
    ] as const
    for (const childPage of childPages) {
      const childNavigation = openModelSettingsPage(modelNavigation, childPage)
      expect(modelSettingsDialogEscapeAction(childNavigation)).toBe('back')
      expect(modelSettingsDialogEscapeAction(backModelSettingsPage(childNavigation))).toBe('close')
    }
  })

  it('does not claim Escape for routes outside a model-owned dialog', () => {
    expect(modelSettingsDialogEscapeAction(createModelSettingsNavigation())).toBe('none')
    expect(modelSettingsDialogEscapeAction(createModelSettingsNavigation({
      type: 'script',
      vendorKey: 'direct-script',
      modelKey: 'new-video',
    }))).toBe('none')
  })

  it('replaces a failed task with the selected model detail before manual setup continues', () => {
    const navigation = openModelSettingsDialog(
      createModelSettingsNavigation({ type: 'verification', runId: 'run-1' }),
      { vendorKey: 'relay', modelKey: 'video-v2' },
    )
    expect(navigation.stack).toEqual([
      { type: 'home' },
      { type: 'connection', vendorKey: 'relay' },
      { type: 'model', vendorKey: 'relay', modelKey: 'video-v2' },
    ])
    expect(modelSettingsDialogOwner(navigation)).toEqual({
      type: 'model', vendorKey: 'relay', modelKey: 'video-v2',
    })
  })

  it('creates a model dialog owner for a direct-script draft', () => {
    const navigation = openModelSettingsDialogPage(
      createModelSettingsNavigation({ type: 'add' }),
      { vendorKey: 'custom-script-vendor', modelKey: 'new-video' },
      { type: 'script', vendorKey: 'custom-script-vendor', modelKey: 'new-video' },
    )
    expect(navigation.stack).toEqual([
      { type: 'home' },
      { type: 'connection', vendorKey: 'custom-script-vendor' },
      { type: 'model', vendorKey: 'custom-script-vendor', modelKey: 'new-video' },
      { type: 'script', vendorKey: 'custom-script-vendor', modelKey: 'new-video' },
    ])
    expect(modelSettingsDialogOwner(navigation)).toEqual({
      type: 'model', vendorKey: 'custom-script-vendor', modelKey: 'new-video',
    })
  })

  it('keeps the existing owner when opening a child page from model detail', () => {
    let navigation = createModelSettingsNavigation({ type: 'connection', vendorKey: 'relay' })
    navigation = openModelSettingsDialogPage(
      navigation,
      { vendorKey: 'relay', modelKey: 'video-v2' },
      { type: 'script', vendorKey: 'relay', modelKey: 'video-v2' },
    )
    const reopened = openModelSettingsDialogPage(
      navigation,
      { vendorKey: 'relay', modelKey: 'video-v2' },
      { type: 'capability', vendorKey: 'relay', modelKey: 'video-v2' },
    )
    expect(reopened.stack.filter((page) => page.type === 'model')).toHaveLength(1)
    expect(reopened.stack.at(-1)).toEqual({ type: 'capability', vendorKey: 'relay', modelKey: 'video-v2' })
  })
})

describe('finish format task at its promoted identity', () => {
  const old = openModelSettingsPage(
    openModelSettingsDialog(createModelSettingsNavigation(), { vendorKey: 'old', modelKey: 'image' }),
    { type: 'verification', runId: 'run' },
  )
  it.each(['completed', 'partial'])('%s reaches the new vendor and model', stage => {
    const result = finishAdapterRunNavigation(old, { stage, vendorKey: 'promoted', selectedModelKeys: ['image'] }, () => true)
    expect(currentModelSettingsPage(result)).toEqual({ type: 'model', vendorKey: 'promoted', modelKey: 'image' })
    expect(result.stack).toEqual([{ type: 'home' }, { type: 'connection', vendorKey: 'promoted' }, { type: 'model', vendorKey: 'promoted', modelKey: 'image' }])
  })
  it('a batch lands at the promoted connection', () => {
    expect(currentModelSettingsPage(finishAdapterRunNavigation(old, { stage: 'completed', vendorKey: 'promoted', selectedModelKeys: ['image', 'video'] }, () => true)))
      .toEqual({ type: 'connection', vendorKey: 'promoted' })
  })
  it.each(['failed', 'cancelled', 'adapting'])('%s returns without claiming promotion', stage => {
    expect(finishAdapterRunNavigation(old, { stage, vendorKey: 'promoted', selectedModelKeys: ['image'] }, () => true)).toEqual(backModelSettingsPage(old))
  })
  it('a missing promoted connection, absent run and unchanged identity return safely', () => {
    expect(finishAdapterRunNavigation(old, undefined, () => false)).toEqual(backModelSettingsPage(old))
    expect(finishAdapterRunNavigation(old, { stage: 'completed', vendorKey: 'promoted', selectedModelKeys: ['image'] }, () => false)).toEqual(backModelSettingsPage(old))
    expect(finishAdapterRunNavigation(old, { stage: 'completed', vendorKey: 'old', selectedModelKeys: ['image'] }, () => true)).toEqual(backModelSettingsPage(old))
  })
})
