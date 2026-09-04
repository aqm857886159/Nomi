import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const card = fs.readFileSync(path.join(process.cwd(), 'src/workbench/creation/storyboard/StoryboardAnchorCard.tsx'), 'utf8')

describe('storyboard anchor card model availability structure', () => {
  it('uses the shared warning token when no visual model is available', () => {
    expect(card).toContain('data-anchor-model-empty="true"')
    expect(card).toContain('className="text-micro text-nomi-warning" data-anchor-model-empty="true"')
    expect(card).not.toContain(['text-workbench', 'warning'].join('-'))
  })
})
