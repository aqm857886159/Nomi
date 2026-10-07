import React from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter/wght.css'
import '@fontsource-variable/fraunces/wght.css'
import '@mantine/notifications/styles.css'
import '../styles/index.css'
import { NomiAppProviders } from '../NomiAppProviders'
import { NomiColorSchemeProvider } from '../theme/NomiColorSchemeProvider'
import { primeNomiColorScheme, persistColorScheme } from '../theme/colorScheme'
import { LayoutExploreApp } from './storyboardLayoutExploreScreens'

document.documentElement.dataset.mantineColorScheme =
  new URL(window.location.href).searchParams.get('scheme') === 'dark' ? 'dark' : 'light'
persistColorScheme(document.documentElement.dataset.mantineColorScheme === 'dark' ? 'dark' : 'light')
primeNomiColorScheme()

createRoot(document.getElementById('storyboard-layout-explore-root')!).render(
  <NomiColorSchemeProvider>
    <NomiAppProviders>
      <LayoutExploreApp />
    </NomiAppProviders>
  </NomiColorSchemeProvider>,
)
