import React from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import NomiStudioApp from './workbench/NomiStudioApp'
import { buildStudioUrl } from './utils/appRoutes'

function RedirectToStudio(): JSX.Element {
  const location = useLocation()
  return <Navigate to={`${buildStudioUrl()}${location.search || ''}`} replace />
}

export default function NomiRouterApp(): JSX.Element {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/studio/*" element={<NomiStudioApp />} />
        <Route path="/" element={<RedirectToStudio />} />
        <Route path="/workspace/*" element={<RedirectToStudio />} />
        <Route path="/oauth/github" element={<RedirectToStudio />} />
        <Route path="*" element={<RedirectToStudio />} />
      </Routes>
    </BrowserRouter>
  )
}
