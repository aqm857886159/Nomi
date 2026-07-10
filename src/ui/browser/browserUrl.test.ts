import { describe, expect, it } from 'vitest'
import { browserUrlDisplayTitle, normalizeBrowserInput } from './browserUrl'

describe('normalizeBrowserInput', () => {
  it('keeps complete http URLs', () => {
    expect(normalizeBrowserInput('http://example.com/a')).toBe('http://example.com/a')
  })

  it('adds https for host-like input', () => {
    expect(normalizeBrowserInput('example.com/path')).toBe('https://example.com/path')
    expect(normalizeBrowserInput('localhost:5173')).toBe('https://localhost:5173/')
  })

  it('uses Bing search for keywords and unsupported schemes', () => {
    expect(normalizeBrowserInput('nomi browser idea')).toBe('https://www.bing.com/search?q=nomi%20browser%20idea')
    expect(normalizeBrowserInput('javascript:alert(1)')).toBe('https://www.bing.com/search?q=javascript%3Aalert(1)')
  })
})

describe('browserUrlDisplayTitle', () => {
  it('uses a compact hostname title', () => {
    expect(browserUrlDisplayTitle('https://www.example.com/path')).toBe('example.com')
  })
})
