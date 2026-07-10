import React from 'react'
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { NomiLoadingMark } from './design'
import { buildStudioUrl } from './utils/appRoutes'
import { getAppRoutePath } from './utils/routes'
import { lazyWithChunkBoundary } from './ui/chunkBoundary'

const NomiStudioApp = lazyWithChunkBoundary('应用主界面', () => import('./workbench/NomiStudioApp'))
const ReferenceCaptureChrome = lazyWithChunkBoundary('网页捕捞', () => import('./ui/browser/ReferenceCaptureChrome'))

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
      {/* pending 规范 #1:统一品牌 spinner,杀自写 CSS 圆环 */}
      <NomiLoadingMark size={28} label="Nomi 加载中" />
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
        <Route
          path={getAppRoutePath('ReferenceCaptureChrome')}
          element={(
            <React.Suspense fallback={<RouteLoading />}>
              <ReferenceCaptureChrome />
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
