import React from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter/wght.css'
import '@fontsource-variable/fraunces/wght.css'
import '../styles/index.css'
import { NomiAppProviders } from '../NomiAppProviders'
import { NomiColorSchemeProvider } from '../theme/NomiColorSchemeProvider'
import { persistColorScheme } from '../theme/colorScheme'
import { SkillLibraryContent } from '../workbench/skillLibrary/SkillLibraryPanel'

// ShellStage specimen: the production component reads the running Electron host's real Skill and prompt DTOs.
persistColorScheme('light')
createRoot(document.getElementById('root')!).render(
  <NomiColorSchemeProvider><NomiAppProviders>
    <main className="flex h-screen bg-nomi-ink-05 text-nomi-ink">
      <aside className="flex h-full w-[420px] flex-col border-r border-nomi-line bg-nomi-paper"><SkillLibraryContent active compact /></aside>
    </main>
  </NomiAppProviders></NomiColorSchemeProvider>,
)
