import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const source = fs.readFileSync(path.join(process.cwd(), 'src/ui/community/FeedbackReportCard.tsx'), 'utf8')

describe('FeedbackReportCard request lifecycle', () => {
  it('refreshes openedAt when a new feedback request opens the mounted card', () => {
    expect(source).toMatch(/const openedAt = React\.useMemo\(\(\) => new Date\(\), \[request\]\)/)
  })
})
