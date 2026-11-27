import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { checkBoardManifest } from '../../scripts/check-board-parity.mjs'

const file = new URL('../../docs/design/boards/2026-10-12/ReferenceEntry.board.json', import.meta.url)

describe('reference-entry production snapshot', () => {
  it('retains its element inventory and the destination of every old function', () => {
    const manifest = JSON.parse(readFileSync(file, 'utf8'))
    expect(manifest.elements.length).toBeGreaterThan(0)
    expect(checkBoardManifest({ board: 'ReferenceEntry', manifest })).toEqual([])
  })
})
