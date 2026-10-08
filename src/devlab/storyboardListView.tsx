import React from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter/wght.css'
import '@fontsource-variable/fraunces/wght.css'
import '@mantine/notifications/styles.css'
import '../styles/index.css'
import { NomiAppProviders } from '../NomiAppProviders'
import { NomiColorSchemeProvider } from '../theme/NomiColorSchemeProvider'
import { persistColorScheme, primeNomiColorScheme } from '../theme/colorScheme'
import { StoryboardListViewApp } from './storyboardListViewScreens'

const scheme = new URL(window.location.href).searchParams.get('scheme') === 'dark' ? 'dark' : 'light'
document.documentElement.dataset.mantineColorScheme = scheme
persistColorScheme(scheme)
primeNomiColorScheme()

createRoot(document.getElementById('storyboard-list-view-root')!).render(
  <NomiColorSchemeProvider>
    <NomiAppProviders>
      <StoryboardListViewApp />
    </NomiAppProviders>
  </NomiColorSchemeProvider>,
)
