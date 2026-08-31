import { describe, expect, it } from 'vitest'
import { residentBatchIndexes } from './ResidentBatchStack'

describe('resident batch stack window', () => {
  it('shows at most three cards and keeps the active item first', () => {
    expect(residentBatchIndexes(8, 0)).toEqual([0, 1, 2])
    expect(residentBatchIndexes(8, 6)).toEqual([6, 7, 0])
    expect(residentBatchIndexes(2, 1)).toEqual([1, 0])
  })

  it('clamps invalid indexes and handles empty batches', () => {
    expect(residentBatchIndexes(0, 4)).toEqual([])
    expect(residentBatchIndexes(3, -4)).toEqual([0, 1, 2])
    expect(residentBatchIndexes(3, 10, 1)).toEqual([2])
  })
})
