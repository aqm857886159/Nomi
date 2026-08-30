import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), 'utf8')

describe('real ComfyUI candidate component lifecycle wiring', () => {
  it.each([
    'src/ui/onboarding/ComfyuiWorkflowImportPanel.tsx',
    'src/ui/onboarding/workflowPage/ComfyuiWorkflowSettingsPage.tsx',
  ])('%s cancels the exact current revision on unmount and revision replacement', (file) => {
    const text = source(file)
    expect(text).toContain('cancelComfyCandidateTestRevision')
    expect(text).toMatch(/React\.useEffect\(\(\) => \(\) => \{[\s\S]*cancelComfyCandidateTestRevision/)
    expect(text).toContain('replaceCandidate')
  })
})
