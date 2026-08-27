import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, test } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const temporaryRoots = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function write(root, relative, content) {
  const file = path.join(root, relative)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content))
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-test-types-'))
  temporaryRoots.push(root)
  write(root, 'scripts/check-test-types.mjs', fs.readFileSync(path.join(repoRoot, 'scripts/check-test-types.mjs'), 'utf8'))
  write(root, 'scripts/test-types-baseline.json', { 'legacy.test.ts': 1 })
  const compilerOptions = { strict: true, noEmit: true, skipLibCheck: true, types: [] }
  write(root, 'tsconfig.test.json', { compilerOptions, include: ['legacy.test.ts'] })
  write(root, 'legacy.test.ts', 'const legacy: number = "legacy debt";\n')
  write(root, 'tests/agent-runtime/tsconfig.json', {
    compilerOptions: { ...compilerOptions, module: 'NodeNext', moduleResolution: 'NodeNext' },
    include: ['native.test.mts'],
  })
  write(root, 'tests/agent-runtime/native.test.mts', 'export const native: number = 1;\n')
  fs.symlinkSync(path.join(repoRoot, 'node_modules'), path.join(root, 'node_modules'), 'junction')
  return root
}

function check(root, args = []) {
  return spawnSync(process.execPath, [path.join(root, 'scripts/check-test-types.mjs'), ...args], {
    cwd: root, encoding: 'utf8',
  })
}

describe('test type gate failure boundaries', () => {
  test('keeps legacy debt ratcheted while requiring zero native diagnostics', () => {
    const root = fixture()
    const result = check(root)
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/agent-runtime.*0/)
    expect(JSON.parse(fs.readFileSync(path.join(root, 'scripts/test-types-baseline.json'), 'utf8')))
      .toEqual({ 'legacy.test.ts': 1 })
  })

  test('a native error cannot hide behind the legacy baseline or update-baseline', () => {
    const root = fixture()
    write(root, 'tests/agent-runtime/native.test.mts', 'export const native: number = "wrong";\n')
    for (const args of [[], ['--update-baseline']]) {
      const result = check(root, args)
      expect(result.status).toBe(1)
      expect(`${result.stdout}\n${result.stderr}`).toContain('TS2322')
    }
    expect(JSON.parse(fs.readFileSync(path.join(root, 'scripts/test-types-baseline.json'), 'utf8')))
      .toEqual({ 'legacy.test.ts': 1 })
  })

  test.each(['tsconfig.test.json', 'tests/agent-runtime/tsconfig.json'])(
    'does not interpret a broken compiler config as zero diagnostics: %s', (config) => {
      const root = fixture()
      write(root, config, { compilerOptions: { thisOptionDoesNotExist: true }, files: [] })
      for (const args of [[], ['--update-baseline']]) {
        const result = check(root, args)
        expect(result.status).toBe(1)
        expect(`${result.stdout}\n${result.stderr}`).toContain('TS5023')
      }
      expect(JSON.parse(fs.readFileSync(path.join(root, 'scripts/test-types-baseline.json'), 'utf8')))
        .toEqual({ 'legacy.test.ts': 1 })
    },
  )

  test.each(['tsconfig.test.json', 'tests/agent-runtime/tsconfig.json'])(
    'fails closed on an unscoped missing-config diagnostic: %s', (config) => {
      const root = fixture()
      fs.rmSync(path.join(root, config))
      const result = check(root)
      expect(result.status).toBe(1)
      expect(`${result.stdout}\n${result.stderr}`).toContain('TS5058')
    },
  )
})
