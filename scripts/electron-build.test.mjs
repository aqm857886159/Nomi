import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
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

function fixture(main = 'dist-electron/main.js') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-electron-build-'))
  temporaryRoots.push(root)
  write(root, 'package.json', { main })
  const compilerOptions = { target: 'ES2022', rootDir: '.', outDir: '../dist-electron', strict: true,
    skipLibCheck: true, noEmitOnError: true, types: [] }
  write(root, 'electron/tsconfig.json', {
    compilerOptions: { ...compilerOptions, module: 'CommonJS', moduleResolution: 'Node' },
    include: ['**/*.ts'],
  })
  write(root, 'electron/tsconfig.pi.json', {
    compilerOptions: { ...compilerOptions, module: 'NodeNext', moduleResolution: 'NodeNext' },
    include: ['harness/runtime/pi/**/*.mts', 'harness/runtime/pi/**/*.cts'],
  })
  write(root, 'electron/main.ts', 'export const legacy = true;\n')
  write(root, 'electron/harness/runtime/pi/session.mts', 'export const session = true;\n')
  write(root, 'electron/harness/runtime/pi/nested/boundary.cts', 'export const boundary = true;\n')
  return root
}

async function artifactCheck() {
  const file = path.join(repoRoot, 'scripts/electron-build-artifacts.mjs')
  expect(fs.existsSync(file), 'launchers need a shared complete-build artifact check').toBe(true)
  return (await import(pathToFileURL(file).href)).assertElectronBuildArtifacts
}

function build(root) {
  for (const name of ['build-electron.mjs', 'electron-build-artifacts.mjs']) {
    const file = path.join(repoRoot, 'scripts', name)
    expect(fs.existsSync(file), 'CJS and private NodeNext must share one build entry').toBe(true)
    fs.mkdirSync(path.join(root, 'scripts'), { recursive: true })
    fs.copyFileSync(file, path.join(root, 'scripts', name))
  }
  fs.symlinkSync(path.join(repoRoot, 'node_modules'), path.join(root, 'node_modules'), 'junction')
  return spawnSync(process.execPath, [path.join(root, 'scripts/build-electron.mjs')], {
    cwd: os.tmpdir(), encoding: 'utf8',
  })
}

describe('complete Electron build artifacts', () => {
  test('main alone is rejected; every real private source output is required without importing it', async () => {
    const check = await artifactCheck()
    const root = fixture()
    write(root, 'dist-electron/main.js', 'throw new Error("must not execute artifacts");\n')
    expect(() => check(root)).toThrow(/session\.mjs/)
    write(root, 'dist-electron/harness/runtime/pi/session.mjs', 'throw new Error("must not load SDK");\n')
    expect(() => check(root)).toThrow(/boundary\.cjs/)
    write(root, 'dist-electron/harness/runtime/pi/nested/boundary.cjs', 'throw new Error("must not execute");\n')
    expect(() => check(root)).not.toThrow()
  })

  test('derives the main entry from package.json and ignores declarations and tests', async () => {
    const check = await artifactCheck()
    const root = fixture('dist-electron/custom-entry.cjs')
    write(root, 'electron/harness/runtime/pi/contracts.d.mts', 'export type Contract = string;\n')
    write(root, 'electron/harness/runtime/pi/host.d.cts', 'export type Host = string;\n')
    write(root, 'electron/harness/runtime/pi/session.test.mts', 'export {};\n')
    write(root, 'electron/harness/runtime/pi/host.test.cts', 'export {};\n')
    write(root, 'dist-electron/main.js', '')
    write(root, 'dist-electron/harness/runtime/pi/session.mjs', '')
    write(root, 'dist-electron/harness/runtime/pi/nested/boundary.cjs', '')
    expect(() => check(root)).toThrow(/custom-entry\.cjs/)
    write(root, 'dist-electron/custom-entry.cjs', '')
    expect(() => check(root)).not.toThrow()
  })

  test('a directory at an expected artifact path is not a built file', async () => {
    const check = await artifactCheck()
    const root = fixture()
    fs.mkdirSync(path.join(root, 'dist-electron/main.js'), { recursive: true })
    expect(() => check(root)).toThrow(/main\.js/)
  })
})

describe('shared Electron compiler', () => {
  test('emits the current CommonJS main plus native .mjs and .cjs from any cwd', () => {
    const root = fixture()
    const result = build(root)
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    expect(fs.readFileSync(path.join(root, 'dist-electron/main.js'), 'utf8')).toContain('exports.legacy')
    expect(fs.readFileSync(path.join(root, 'dist-electron/harness/runtime/pi/session.mjs'), 'utf8'))
      .toContain('export const session')
    expect(fs.readFileSync(path.join(root, 'dist-electron/harness/runtime/pi/nested/boundary.cjs'), 'utf8'))
      .toContain('exports.boundary')
  })

  test('a private compiler failure stays nonzero even when stale artifacts exist', () => {
    const root = fixture()
    write(root, 'electron/harness/runtime/pi/session.mts', 'export const session: number = "wrong";\n')
    write(root, 'dist-electron/harness/runtime/pi/session.mjs', 'export const stale = true;\n')
    const result = build(root)
    expect(result.status).not.toBe(0)
    expect(`${result.stdout}\n${result.stderr}`).toContain('TS2322')
  })
})
