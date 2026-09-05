import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const source = fs.readFileSync(path.join(process.cwd(), 'src/ui/app-shell/CollapsedAiChip.tsx'), 'utf8')

describe('CollapsedAiChip C-03 contract', () => {
  it('exposes the approved topbar badge and only marks real message updates', () => {
    expect(source).toContain('data-agent-topbar-badge="true"')
    expect(source).toContain('data-agent-badge-dot="true"')
    expect(source).toContain('messageCount > 0')
    expect(source).toContain('setCollapsed(false)')
  })
})
