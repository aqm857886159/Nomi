import { describe, expect, it } from 'vitest'
import {
  composeResidentSystemPrompt,
  libraryPromptMenuId,
  libraryPromptReferenceId,
} from './residentPromptSelection'

describe('resident prompt library selection', () => {
  it('uses stable ids for menu rows and removable composer references', () => {
    const prompt = { id: 'builtin-expr-joy-1' }
    expect(libraryPromptMenuId(prompt)).toBe('library:builtin-expr-joy-1')
    expect(libraryPromptReferenceId(prompt)).toBe('prompt:builtin-expr-joy-1')
  })

  it('adds a selected library prompt to the existing system contract', () => {
    expect(composeResidentSystemPrompt('base agent contract', { prompt: 'preserve the subject identity' })).toBe(
      'base agent contract\n\npreserve the subject identity',
    )
  })

  it('keeps empty prompt-library selections from creating a blank system prompt', () => {
    expect(composeResidentSystemPrompt(undefined, null)).toBeUndefined()
    expect(composeResidentSystemPrompt('  ', { prompt: '  ' })).toBeUndefined()
  })
})
