// Real production components/providers. Resource holds/failures are controlled by
// the driver; this is component runtime evidence, not native navigation acceptance.
import React from 'react'
import { createRoot } from 'react-dom/client'
import '@mantine/core/styles.css'
import '../../../../src/styles/index.css'
import { NomiAppProviders } from '../../../../src/NomiAppProviders'
import { NomiColorSchemeProvider } from '../../../../src/theme/NomiColorSchemeProvider'
import { AgentPanelV4Markdown } from '../../../../src/workbench/ai/v4/AgentPanelV4Markdown'
import { SkillDetail } from '../../../../src/workbench/skillLibrary/SkillDetail'
import { PromptPreviewOverlay } from '../../../../src/workbench/promptLibrary/PromptPreviewOverlay'
import ArtifactBody from '../../../../src/workbench/generationCanvas/nodes/artifact/ArtifactBody'
import type { GenerationCanvasNode } from '../../../../src/workbench/generationCanvas/model/generationCanvasTypes'

const surface = new URLSearchParams(location.search).get('surface') ?? 'agent'
const noop = () => {}
const node = { id: 'runtime-artifact', kind: 'agent-artifact', position: { x: 0, y: 0 } } as GenerationCanvasNode
const content = (version: number) => `# ${version === 0 ? 'OLD_CONTENT' : 'LATEST_CONTENT'}\n\n| Shot | Result |\n| --- | --- |\n| one | verified |\n\n\`\`\`text\nCOPY_SOURCE_${version}\n\`\`\`\n\n[Explicit link](https://example.invalid/explicit)\n\n![Explicit image](https://example.invalid/image.png)\n\nSTREAM_STEP_${version}`

function Stage() {
  const [opened, setOpened] = React.useState(false)
  const [version, setVersion] = React.useState(0)
  const [streaming, setStreaming] = React.useState(true)
  const close = () => setOpened(false)
  const text = content(version)
  React.useEffect(() => {
    // Host-driven prop/unmount control, including while a production modal traps
    // input. These controls are test ports, not a claimed native user workflow.
    Object.assign(window, { __nomiMarkdownRuntime: {
      update: () => setVersion(value => value + 1), close, open: () => setOpened(true), finish: () => setStreaming(false),
    } })
  }, [])
  return <main className="min-h-screen bg-nomi-bg p-6 text-nomi-ink">
    <div className="relative z-[5000] flex gap-3 bg-nomi-paper p-3" data-runtime-controls style={{ position: 'relative', zIndex: 5000 }}>
      <button data-runtime-open onClick={() => setOpened(true)}>Open</button>
      <button data-runtime-close onClick={close}>Close</button>
      <button data-runtime-update onClick={() => setVersion(value => value + 1)}>Update</button>
      <button data-runtime-finish onClick={() => setStreaming(false)}>Finish stream</button>
      <output data-runtime-version>{version}</output>
    </div>
    {opened && <section data-runtime-surface={surface} className="mt-6 max-w-3xl bg-nomi-paper p-4">
      {surface === 'agent' && <AgentPanelV4Markdown text={text} streaming={streaming} />}
      {surface === 'skill' && <SkillDetail entry={{ id: 'runtime-skill', title: 'Runtime skill', description: 'Controlled skill body', body: text, kind: 'skill' }} onClose={close} onApply={noop} onReference={noop} />}
      {surface === 'prompt' && <PromptPreviewOverlay originRect={new DOMRect(40, 90, 120, 100)} onClose={close} onSendToCanvas={noop}
        prompt={{ id: 'runtime-prompt', title: 'Runtime prompt', prompt: text, mediaUrl: '', mediaType: 'image', promptType: 'image', tags: [], source: 'runtime', sourceId: 'runtime', sourceUrl: '', origin: 'user' }} />}
      {surface === 'artifact' && <ArtifactBody node={node} artifact={{ fileType: 'markdown', url: `data:text/markdown;charset=utf-8,${encodeURIComponent(text)}` }} width={600} height={420} />}
    </section>}
  </main>
}
createRoot(document.getElementById('root')!).render(<NomiColorSchemeProvider><NomiAppProviders><Stage /></NomiAppProviders></NomiColorSchemeProvider>)
