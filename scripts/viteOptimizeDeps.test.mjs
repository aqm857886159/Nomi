import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Vite dependency pre-bundling', () => {
  it('keeps i18n dependencies explicit when automatic discovery is disabled', () => {
    const root = process.cwd()
    const config = fs.readFileSync(path.join(root, 'vite.config.ts'), 'utf8')
    const entry = fs.readFileSync(path.join(root, 'src/dev/optimizeDepsEntry.ts'), 'utf8')

    expect(config).toContain('noDiscovery: true')
    expect(config).toMatch(/include:\s*\[[\s\S]*['"]i18next['"]/)
    expect(config).toMatch(/include:\s*\[[\s\S]*['"]react-i18next['"]/)
    expect(entry).toContain("import 'i18next';")
    expect(entry).toContain("import 'react-i18next';")
  })
})
