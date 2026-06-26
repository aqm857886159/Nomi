import React from 'react'
import { HashRouter } from 'react-router-dom'
import NomiStudioApp from './workbench/NomiStudioApp'

export default function NomiStudioRoute(): JSX.Element {
  return (
    <HashRouter>
      <NomiStudioApp />
    </HashRouter>
  )
}
