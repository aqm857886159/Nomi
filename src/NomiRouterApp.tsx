import React from 'react'
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { buildStudioUrl } from './utils/appRoutes'
import { getAppRoutePath } from './utils/routes'

const NomiStudioApp = React.lazy(() => import('./workbench/NomiStudioApp'))

function RedirectToStudio(): JSX.Element {
  const location = useLocation()
  return <Navigate to={`${buildStudioUrl()}${location.search || ''}`} replace />
}

function RouteLoading(): JSX.Element {
  return (
    <div
      className="grid h-screen w-screen place-items-center bg-nomi-bg text-nomi-ink font-nomi-sans"
      aria-label="Nomi 加载中"
    >
      <div className="h-6 w-6 rounded-full border border-nomi-line border-t-nomi-accent animate-spin" />
    </div>
  )
}

export default function NomiRouterApp(): JSX.Element {
  return (
    <HashRouter>
      <Routes>
        <Route
          path={getAppRoutePath('NomiStudioApp')}
          element={(
            <React.Suspense fallback={<RouteLoading />}>
              <NomiStudioApp />
            </React.Suspense>
          )}
        />
        <Route path={getAppRoutePath('RedirectToStudio', '/')} element={<RedirectToStudio />} />
        <Route path={getAppRoutePath('RedirectToStudio', '/workspace/*')} element={<RedirectToStudio />} />
        <Route path={getAppRoutePath('RedirectToStudio', '*')} element={<RedirectToStudio />} />
      </Routes>
    </HashRouter>
  )
}
