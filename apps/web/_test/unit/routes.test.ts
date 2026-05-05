import { describe, expect, it } from 'vitest'
import { APP_ROUTES, getAppRoutePath } from '../../src/utils/routes'

describe('app route registry', () => {
  it('registers all user-facing route paths', () => {
    const paths = APP_ROUTES.map((route) => route.path)

    expect(paths).toContain('/studio/*')
    expect(paths).toContain('/share/*')
    expect(paths).toContain('/oauth/github')
  })

  it('fails when a component path pair is not registered', () => {
    expect(getAppRoutePath('NomiStudioApp')).toBe('/studio/*')
    expect(() => getAppRoutePath('NomiStudioApp', '/share/*')).toThrow(/Route is not registered/)
  })
})
