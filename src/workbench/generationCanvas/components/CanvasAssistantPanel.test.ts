import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const source = fs.readFileSync(
  path.join(process.cwd(), 'src/workbench/generationCanvas/components/CanvasAssistantPanel.tsx'),
  'utf8',
)

describe('CanvasAssistantPanel review-card scrolling', () => {
  it('new content deviations trigger the existing stick-to-bottom effect', () => {
    const effect = source.match(
      /threadBottomRef\.current\?\.scrollIntoView\(\{ block: 'end' \}\)[\s\S]*?\}, \[([^\]]+)\]\)/,
    )
    expect(effect?.[1]).toContain('contentDeviations')
  })

  it('counts a main-executed read from the settled turn instead of renderer pending cards', () => {
    expect(source).toContain('result.response.toolCalls.length === 0')
    expect(source).not.toContain('toolEmittedCount')
  })
})
