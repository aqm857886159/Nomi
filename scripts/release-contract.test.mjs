import { Buffer } from 'node:buffer'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import zlib from 'node:zlib'
import yaml from 'js-yaml'
import { CHROMIUM_INSTALL_STEP } from './ci-browser-install.mjs'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertReleaseVersion,
  assertReleaseTag,
  assertRunId,
  createReleaseManifest,
  prepareReleaseAssets,
  validateReleaseManifest,
  verifyPublishedReleaseAssets,
} from './release-contract.mjs'

const roots = []
const makeRoot = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-release-contract-'))
  roots.push(root)
  return root
}

const MAC_ASSETS = ['Nomi-mac-arm64.dmg', 'Nomi-mac-x64.dmg', 'Nomi-mac-arm64.zip', 'Nomi-mac-x64.zip']
const WINDOWS_ASSETS = ['Nomi-win-x64.exe']
const RELEASE_ASSETS = [...MAC_ASSETS, ...WINDOWS_ASSETS]

function digest(filePath) {
  return crypto.createHash('sha512').update(fs.readFileSync(filePath)).digest('base64')
}

function writeAsset(input, name, content = `release asset: ${name}`) {
  const filePath = path.join(input, name)
  fs.writeFileSync(filePath, content)
  return filePath
}

function writeBlockmap(input, assetName) {
  const blockmap = zlib.gzipSync(
    JSON.stringify({ version: '2', files: [{ name: assetName, offset: 0, sizes: [1], checksums: ['AA=='] }] }),
  )
  return writeAsset(input, `${assetName}.blockmap`, blockmap)
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function metadataDocument(input, names, primary, version = '0.20.0') {
  const files = names.map((name) => {
    const filePath = path.join(input, name)
    return { url: name, sha512: digest(filePath), size: fs.statSync(filePath).size }
  })
  const primaryEntry = files.find(({ url }) => url === primary)
  return { version, files, path: primary, sha512: primaryEntry.sha512, releaseDate: '2026-08-16T00:00:00.000Z' }
}

function writeMetadata(input, name, document) {
  fs.writeFileSync(path.join(input, name), yaml.dump(document, { noRefs: true, lineWidth: -1 }))
}

function makeReleaseFixture() {
  const root = makeRoot()
  const input = path.join(root, 'input')
  const output = path.join(root, 'output')
  fs.mkdirSync(input, { recursive: true })
  for (const name of RELEASE_ASSETS) {
    writeAsset(input, name)
    writeBlockmap(input, name)
  }
  writeMetadata(input, 'latest-mac.yml', metadataDocument(input, MAC_ASSETS, 'Nomi-mac-arm64.zip'))
  writeMetadata(input, 'latest.yml', metadataDocument(input, WINDOWS_ASSETS, 'Nomi-win-x64.exe'))
  return { root, input, output }
}

function releaseJson(input) {
  return {
    assets: fs
      .readdirSync(input, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const filePath = path.join(input, entry.name)
        return { name: entry.name, size: fs.statSync(filePath).size, digest: `sha256:${sha256(filePath)}` }
      }),
  }
}

function workflowRunBlocks(document) {
  const runs = []
  const visit = (value) => {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    for (const [key, item] of Object.entries(value)) {
      if (key === 'run' && typeof item === 'string') runs.push(item)
      visit(item)
    }
  }
  visit(document)
  return runs
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('release contract', () => {
  it('requires the requested version to match package.json', () => {
    expect(assertReleaseVersion('0.20.0', '0.20.0')).toBe('0.20.0')
    expect(() => assertReleaseVersion('v0.20.0', '0.20.0')).toThrow(/match x\.y\.z/)
    expect(() => assertReleaseVersion('0.20.0-rc.1', '0.20.0-rc.1')).toThrow(/match x\.y\.z/)
    expect(() => assertReleaseVersion('0.20.1', '0.20.0')).toThrow(/does not match/)
  })

  it('requires a stable v-prefixed tag and numeric workflow run ID', () => {
    expect(assertReleaseTag('v0.20.0', '0.20.0')).toBe('0.20.0')
    expect(assertRunId('31953189045')).toBe('31953189045')
    expect(() => assertReleaseTag('0.20.0', '0.20.0')).toThrow(/vX\.Y\.Z/)
    expect(() => assertReleaseTag('v0.20.0-rc.1', '0.20.0')).toThrow(/vX\.Y\.Z/)
    expect(() => assertRunId('3195; echo unsafe')).toThrow(/digits only/)
  })

  it('keeps workflow_dispatch inputs out of shell run blocks', () => {
    for (const workflow of ['desktop-rc.yml', 'desktop-release.yml']) {
      const source = fs.readFileSync(path.join(process.cwd(), '.github', 'workflows', workflow), 'utf8')
      const runs = workflowRunBlocks(yaml.load(source))
      expect(runs.length, workflow).toBeGreaterThan(0)
      expect(runs.join('\n'), workflow).not.toMatch(/\$\{\{\s*inputs\./)
    }
  })

  it('keeps RC provenance and draft promotion checks in the workflows', () => {
    const rc = fs.readFileSync(path.join(process.cwd(), '.github/workflows/desktop-rc.yml'), 'utf8')
    const release = fs.readFileSync(path.join(process.cwd(), '.github/workflows/desktop-release.yml'), 'utf8')
    for (const token of [
      'pnpm install --frozen-lockfile --force',
      'finalize:',
      '--run-attempt',
      '--artifacts',
      'prepare-assets',
    ]) {
      expect(rc, token).toContain(token)
    }
    for (const token of [
      '.github/workflows/desktop-rc.yml',
      '.workflow_id',
      '.head_sha',
      '.run_attempt',
      '--notes-file',
      '--draft',
      'verify-release-assets',
      '--draft=false',
      'git config user.name "github-actions[bot]"',
      'git config user.email "41898282+github-actions[bot]@users.noreply.github.com"',
    ]) {
      expect(release, token).toContain(token)
    }
    expect(rc.indexOf('pnpm install --frozen-lockfile')).toBeLessThan(rc.indexOf('- name: Validate version'))
    expect(release).not.toContain('--generate-notes')
  })

  it('provisions Chromium before the RC gates that run browser-backed tests', () => {
    const rc = fs.readFileSync(path.join(process.cwd(), '.github/workflows/desktop-rc.yml'), 'utf8')
    const install = CHROMIUM_INSTALL_STEP
    expect(rc).toContain(install)
    expect(rc.indexOf(install)).toBeLessThan(rc.indexOf('pnpm run gates'))
  })

  it('binds promotion to the repository, tag, and immutable commit', () => {
    const { input } = makeReleaseFixture()
    const manifest = createReleaseManifest({
      repository: 'aqm857886159/Nomi',
      sha: 'a'.repeat(40),
      version: '0.20.0',
      runId: '123',
      runAttempt: '2',
      artifactRoot: input,
      createdAt: '2026-08-16T00:00:00.000Z',
    })
    expect(
      validateReleaseManifest(manifest, {
        repository: 'aqm857886159/Nomi',
        tag: 'v0.20.0',
        runId: '123',
        runAttempt: '2',
        sha: 'a'.repeat(40),
        artifactRoot: input,
      }).sha,
    ).toBe('a'.repeat(40))
    expect(() =>
      validateReleaseManifest(manifest, {
        repository: 'other/Nomi',
        tag: 'v0.20.0',
        artifactRoot: input,
      }),
    ).toThrow(/repository mismatch/)
    expect(() =>
      validateReleaseManifest(manifest, {
        repository: 'aqm857886159/Nomi',
        tag: 'v0.20.0',
        runId: '456',
        artifactRoot: input,
      }),
    ).toThrow(/run mismatch/)
    expect(() =>
      validateReleaseManifest(manifest, {
        repository: 'aqm857886159/Nomi',
        tag: 'v0.20.0',
        runAttempt: '3',
        artifactRoot: input,
      }),
    ).toThrow(/run attempt mismatch/)
    expect(() =>
      validateReleaseManifest(manifest, {
        repository: 'aqm857886159/Nomi',
        tag: 'v0.20.0',
        sha: 'b'.repeat(40),
        artifactRoot: input,
      }),
    ).toThrow(/commit mismatch/)
    expect(() =>
      validateReleaseManifest(manifest, {
        repository: 'aqm857886159/Nomi',
        tag: '0.20.0',
        artifactRoot: input,
      }),
    ).toThrow(/vX\.Y\.Z/)
    expect(() =>
      createReleaseManifest({
        repository: 'aqm857886159/Nomi',
        sha: 'a'.repeat(40),
        version: '0.20.0',
        runId: 'not-a-run',
        runAttempt: '1',
        artifactRoot: input,
      }),
    ).toThrow(/digits only/)
  })

  it('rejects manifest artifact additions, removals, and digest changes', () => {
    const { input } = makeReleaseFixture()
    const manifest = createReleaseManifest({
      repository: 'aqm857886159/Nomi',
      sha: 'a'.repeat(40),
      version: '0.20.0',
      runId: '123',
      runAttempt: '1',
      artifactRoot: input,
    })
    const validate = () =>
      validateReleaseManifest(manifest, {
        repository: 'aqm857886159/Nomi',
        tag: 'v0.20.0',
        runId: '123',
        runAttempt: '1',
        sha: 'a'.repeat(40),
        artifactRoot: input,
      })

    writeAsset(input, 'unexpected.zip')
    expect(validate).toThrow(/artifact set mismatch/)
    fs.rmSync(path.join(input, 'unexpected.zip'))
    fs.rmSync(path.join(input, 'Nomi-win-x64.exe.blockmap'))
    expect(validate).toThrow(/artifact set mismatch/)
    writeBlockmap(input, 'Nomi-win-x64.exe')
    fs.appendFileSync(path.join(input, 'Nomi-win-x64.exe'), 'tampered')
    expect(validate).toThrow(/size mismatch|sha256 mismatch/)
  })

  it('validates updater metadata against real assets and writes stable aliases plus checksums', () => {
    const { input, output } = makeReleaseFixture()

    prepareReleaseAssets(input, output, '0.20.0')

    expect(fs.readFileSync(path.join(output, 'Nomi-mac-intel.dmg'), 'utf8')).toBe('release asset: Nomi-mac-x64.dmg')
    expect(fs.readFileSync(path.join(output, 'Nomi-windows-setup.exe'), 'utf8')).toBe('release asset: Nomi-win-x64.exe')
    expect(fs.readFileSync(path.join(output, 'SHA256SUMS.txt'), 'utf8')).toContain('Nomi-mac-arm64.dmg')
  })

  it('rejects malformed updater YAML', () => {
    const { input, output } = makeReleaseFixture()
    fs.writeFileSync(path.join(input, 'latest-mac.yml'), 'version: 0.20.0\nfiles: [\n')
    expect(() => prepareReleaseAssets(input, output, '0.20.0')).toThrow(/Malformed updater metadata latest-mac\.yml/)
  })

  it('requires every blockmap and rejects malformed blockmap data', () => {
    const missing = makeReleaseFixture()
    fs.rmSync(path.join(missing.input, 'Nomi-mac-x64.zip.blockmap'))
    expect(() => prepareReleaseAssets(missing.input, missing.output, '0.20.0')).toThrow(
      /Required release asset is missing: Nomi-mac-x64\.zip\.blockmap/,
    )

    const malformed = makeReleaseFixture()
    fs.writeFileSync(path.join(malformed.input, 'Nomi-win-x64.exe.blockmap'), 'not gzip')
    expect(() => prepareReleaseAssets(malformed.input, malformed.output, '0.20.0')).toThrow(
      /Invalid release blockmap Nomi-win-x64\.exe\.blockmap/,
    )
  })

  it('rejects stale updater versions', () => {
    const { input, output } = makeReleaseFixture()
    writeMetadata(input, 'latest.yml', metadataDocument(input, WINDOWS_ASSETS, 'Nomi-win-x64.exe', '0.19.0'))
    expect(() => prepareReleaseAssets(input, output, '0.20.0')).toThrow(
      /latest\.yml version.*does not match release 0\.20\.0/,
    )
  })

  it('rejects metadata that references a missing release asset', () => {
    const { input, output } = makeReleaseFixture()
    const document = metadataDocument(input, MAC_ASSETS, 'Nomi-mac-arm64.zip')
    document.files[0].url = 'Nomi-mac-arm64-missing.dmg'
    writeMetadata(input, 'latest-mac.yml', document)
    expect(() => prepareReleaseAssets(input, output, '0.20.0')).toThrow(/references missing release asset/)
  })

  it('rejects stale updater sizes', () => {
    const { input, output } = makeReleaseFixture()
    const document = metadataDocument(input, MAC_ASSETS, 'Nomi-mac-arm64.zip')
    document.files[0].size += 1
    writeMetadata(input, 'latest-mac.yml', document)
    expect(() => prepareReleaseAssets(input, output, '0.20.0')).toThrow(/size mismatch/)
  })

  it('rejects stale updater hashes', () => {
    const { input, output } = makeReleaseFixture()
    const document = metadataDocument(input, MAC_ASSETS, 'Nomi-mac-arm64.zip')
    document.files[0].sha512 = Buffer.alloc(64).toString('base64')
    writeMetadata(input, 'latest-mac.yml', document)
    expect(() => prepareReleaseAssets(input, output, '0.20.0')).toThrow(/sha512 mismatch/)
  })

  it('rejects missing updater architecture coverage', () => {
    const { input, output } = makeReleaseFixture()
    const universal = writeAsset(input, 'Nomi-mac-universal.zip')
    const document = metadataDocument(input, MAC_ASSETS, 'Nomi-mac-arm64.zip')
    const x64Zip = document.files.find(({ url }) => url === 'Nomi-mac-x64.zip')
    x64Zip.url = path.basename(universal)
    x64Zip.sha512 = digest(universal)
    x64Zip.size = fs.statSync(universal).size
    writeMetadata(input, 'latest-mac.yml', document)
    expect(() => prepareReleaseAssets(input, output, '0.20.0')).toThrow(/architecture/)
  })

  it('rejects a top-level updater path missing from files', () => {
    const { input, output } = makeReleaseFixture()
    const document = metadataDocument(input, MAC_ASSETS, 'Nomi-mac-arm64.zip')
    document.path = 'Nomi-mac-missing.zip'
    writeMetadata(input, 'latest-mac.yml', document)
    expect(() => prepareReleaseAssets(input, output, '0.20.0')).toThrow(/path references missing files entry/)
  })

  it('verifies the exact published asset set, size, and SHA-256 digest', () => {
    const { root, input, output } = makeReleaseFixture()
    prepareReleaseAssets(input, output, '0.20.0')
    const releaseJsonPath = path.join(root, 'release.json')
    const document = releaseJson(output)
    fs.writeFileSync(releaseJsonPath, JSON.stringify(document))
    expect(verifyPublishedReleaseAssets(output, releaseJsonPath)).toHaveLength(document.assets.length)

    document.assets.pop()
    fs.writeFileSync(releaseJsonPath, JSON.stringify(document))
    expect(() => verifyPublishedReleaseAssets(output, releaseJsonPath)).toThrow(/artifact set mismatch/)

    document.assets = releaseJson(output).assets
    document.assets.push({ name: 'unexpected.zip', size: 1, digest: `sha256:${'a'.repeat(64)}` })
    fs.writeFileSync(releaseJsonPath, JSON.stringify(document))
    expect(() => verifyPublishedReleaseAssets(output, releaseJsonPath)).toThrow(/artifact set mismatch/)

    document.assets = releaseJson(output).assets
    document.assets[0].digest = `sha256:${'b'.repeat(64)}`
    fs.writeFileSync(releaseJsonPath, JSON.stringify(document))
    expect(() => verifyPublishedReleaseAssets(output, releaseJsonPath)).toThrow(/sha256 mismatch/)

    document.assets = releaseJson(output).assets
    document.assets[0].size += 1
    fs.writeFileSync(releaseJsonPath, JSON.stringify(document))
    expect(() => verifyPublishedReleaseAssets(output, releaseJsonPath)).toThrow(/size mismatch/)
  })
})
