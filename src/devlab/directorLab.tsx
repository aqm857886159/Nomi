// Director Lab —— 仅 dev：把导演台 V2 全屏壳脱离画布单独挂起来迭代（S0–S8 期间节点对用户隐藏，这里是开发入口）。
// 引导方式与 src/main.tsx 一致（字体 / Mantine 局部样式 / 全局 CSS / 主题 / Providers），只换掉路由 App。
// 工程存 localStorage（nomi:director-lab:project），关闭后可重开或重置。不进 prod 构建。
import React from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter/wght.css'
import '@fontsource-variable/fraunces/wght.css'
import '@mantine/core/styles/UnstyledButton.css'
import '@mantine/core/styles/CloseButton.css'
import '@mantine/core/styles/Notification.css'
import '@mantine/notifications/styles.css'
import '../styles/index.css'
import '../i18n'
import { ConfirmDialogHost } from '../design'
import { NomiAppProviders } from '../NomiAppProviders'
import { NomiColorSchemeProvider } from '../theme/NomiColorSchemeProvider'
import { primeNomiColorScheme } from '../theme/colorScheme'
import DirectorEditor from '../workbench/generationCanvas/nodes/director/DirectorEditor'
import type { DirectorProject } from '../workbench/generationCanvas/nodes/director/model/directorTypes'

const STORAGE_KEY = 'nomi:director-lab:project'

function readStoredProject(): unknown {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : undefined
  } catch {
    return undefined
  }
}

function persist(project: DirectorProject): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project))
  } catch {
    // dev 页面：写不进就算了
  }
}

function DirectorLab(): JSX.Element {
  const [open, setOpen] = React.useState(true)
  const [project] = React.useState<unknown>(() => readStoredProject())
  if (!open) {
    return (
      <div className="flex h-screen items-center justify-center gap-3 bg-nomi-bg text-body text-nomi-ink">
        <button type="button" className="rounded-nomi border border-nomi-line bg-nomi-paper px-3 py-1" onClick={() => setOpen(true)}>
          reopen director
        </button>
        <button
          type="button"
          className="rounded-nomi border border-nomi-line bg-nomi-paper px-3 py-1"
          onClick={() => {
            localStorage.removeItem(STORAGE_KEY)
            location.reload()
          }}
        >
          reset project
        </button>
      </div>
    )
  }
  return (
    <DirectorEditor
      rawProject={project}
      nodeTitle="Director Lab"
      onClose={() => setOpen(false)}
      onProjectChange={(next) => persist(next)}
    />
  )
}

primeNomiColorScheme()

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <NomiColorSchemeProvider>
      <NomiAppProviders>
        <DirectorLab />
        <ConfirmDialogHost />
      </NomiAppProviders>
    </NomiColorSchemeProvider>
  </React.StrictMode>,
)
