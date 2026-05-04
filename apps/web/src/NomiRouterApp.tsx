import React from 'react'
import NomiStudioApp from './workbench/NomiStudioApp'
import { buildStudioUrl, isGithubOauthCallbackRoute, isStudioRoute } from './utils/appRoutes'
import { spaReplace } from './utils/spaNavigate'

function readPathname(): string {
  return typeof window !== 'undefined' ? window.location.pathname || '/' : '/'
}

function redirectToStudio(): void {
  if (typeof window === 'undefined') return
  const nextUrl = `${buildStudioUrl()}${window.location.search || ''}`
  spaReplace(nextUrl)
}

export default function NomiRouterApp(): JSX.Element {
  const [, forceRender] = React.useState(0)
  const path = readPathname()

  React.useEffect(() => {
    const onPopState = () => forceRender((value) => value + 1)
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  if (path === '/' || path.startsWith('/workspace') || isGithubOauthCallbackRoute(path)) {
    redirectToStudio()
    return <NomiStudioApp />
  }

  if (isStudioRoute(path)) {
    return <NomiStudioApp />
  }

  redirectToStudio()
  return <NomiStudioApp />
}
