import React from 'react'
import { describe, expect, it } from 'vitest'
import { createReactTestRenderer } from '../../workbench/ai/v4/testReactRenderer'
import { createModelSettingsNavigation, type ModelSettingsNavigation } from './modelSettingsNavigation'
import { useModelPageRequest, type ModelPageRequest } from './useModelPageRequest'

describe('external model-page requests', () => {
  it('resets to assistance home, consumes each token once, and keeps vendor navigation history', () => {
    const renderer = createReactTestRenderer()
    let snapshot: ModelSettingsNavigation = createModelSettingsNavigation()
    let assisted: number | undefined
    let openPage: ReturnType<typeof useModelPageRequest>['openPage']
    let navigate: React.Dispatch<React.SetStateAction<ModelSettingsNavigation>>
    function Harness({ request }: { request: ModelPageRequest }) {
      const [navigation, setNavigation] = React.useState(() => createModelSettingsNavigation({ type: 'connection', vendorKey: 'existing' }))
      snapshot = navigation
      navigate = setNavigation
      const requestPage = useModelPageRequest(request, navigation, setNavigation)
      assisted = requestPage.assistedRequest
      openPage = requestPage.openPage
      return null
    }
    const render = (request: ModelPageRequest) => {
      renderer.render(<Harness request={request} />)
      renderer.flushPassiveEffects()
    }
    try {
      render(null)
      expect(assisted).toBeUndefined()
      openPage!({ type: 'verification', runId: 'run-1' })
      renderer.flushPassiveEffects()
      expect(snapshot.stack.at(-1)).toEqual({ type: 'verification', runId: 'run-1' })
      render({ section: 'model-assistance', token: 1 })
      expect(snapshot.stack).toEqual([{ type: 'home', assistedRequest: 1 }])
      expect(assisted).toBe(1)
      render({ vendorKey: 'apimart', token: 2 })
      expect(snapshot.stack).toEqual([{ type: 'home', assistedRequest: 1 }, { type: 'platformConnect', vendorKey: 'apimart' }])
      expect(assisted).toBeUndefined()
      navigate!({ stack: [{ type: 'home' }] })
      renderer.flushPassiveEffects()
      render({ vendorKey: 'apimart', token: 2 })
      expect(snapshot.stack).toEqual([{ type: 'home' }])
      render({ section: 'model-assistance', token: 3 })
      expect(assisted).toBe(3)
    } finally { renderer.close() }
  })
})
