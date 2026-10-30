// 安装器清单生成器（scripts/packaging/installer-manifest.cjs）与 afterPack 接线的单测。
// 设计卡 ★9 的 M1、M2 和反例 CX4：docs/plan/2026-10-29-installer-keep-user-files.md。
//
// 为什么要它：build/installer.nsh 卸载时只删这份清单里的条目，升级时按清单的顶层名决定「哪些是用户的、要先挪开」。
// 清单少一项 → 卸载留残渣；清单多一项（比如把用户文件当成安装器的）→ 挪开时漏掉它、旧卸载程序照删。
// 所以这里不只测「生成器跑得通」，而是三方对账：生成的 NSH 用一个独立的解析器读回来、JSON 清单、对打包目录的独立遍历，三者逐项一致。
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanupTestTemp, makeTempDir } from '../_test-temp.mjs'

const require = createRequire(import.meta.url)
const {
  ELEVATE_HELPER,
  computeInstallerManifest,
  manifestPaths,
  nsisQuote,
  renderNsh,
  uninstallerFileName,
  walkAppOutDir,
} = require('./installer-manifest.cjs')
const afterPack = require('../after-pack-mac.cjs').default

const temps = []
afterEach(() => {
  for (const dir of temps.splice(0)) cleanupTestTemp(dir)
})

function tempRoot(prefix) {
  const dir = makeTempDir(prefix)
  temps.push(dir)
  return dir
}

const abs = (root, rel) => path.join(root, ...rel.split('\\'))

/** 按 Windows 相对路径（\ 分隔）在 root 下建一棵假的 win-unpacked。 */
function buildTree(root, { files = [], emptyDirs = [] }) {
  for (const rel of files) {
    fs.mkdirSync(path.dirname(abs(root, rel)), { recursive: true })
    fs.writeFileSync(abs(root, rel), rel)
  }
  for (const rel of emptyDirs) fs.mkdirSync(abs(root, rel), { recursive: true })
  return root
}

/** Electron 打包产物的形状，外加 NSIS 字符串里容易出事的名字：空格、中文、$（含 $INSTDIR 和 $(语言串) 的样子）、引号以外的标点、点文件。 */
const PACKED_APP = {
  files: [
    'Nomi.exe',
    'ffmpeg.dll',
    'LICENSES.chromium.html',
    'locales\\en-US.pak',
    'locales\\zh-CN.pak',
    'resources\\app.asar',
    'resources\\app-update.yml',
    'resources\\app.asar.unpacked\\node_modules\\@ffmpeg-installer\\win32-x64\\ffmpeg.exe',
    'resources\\assets\\sound\\done.wav',
    'resources\\我的 资源\\说明 文件.txt',
    'resources\\price $5 $INSTDIR $(lang).txt',
    "resources\\it's & #1 (copy) [x] 100% ~.txt",
    'resources\\.dotfile',
  ],
  emptyDirs: ['resources\\app.asar.unpacked\\node_modules\\empty-pkg', 'swiftshader'],
}

/** 独立解析生成的 NSH（不复用生成器的任何函数）：宏名 → 条目（$$ 还原成 $），define 名 → 原文。单个 $ 没转义就解析失败。 */
function parseNsh(text) {
  const macros = new Map()
  const defines = new Map()
  let current = null
  for (const line of text.split('\n')) {
    if (line === '' || line.startsWith(';')) continue
    let match = /^!define (\w+) (.+)$/.exec(line)
    if (match) {
      defines.set(match[1], match[2])
      continue
    }
    match = /^!macro (\w+) _M$/.exec(line)
    if (match) {
      current = []
      macros.set(match[1], current)
      continue
    }
    if (line === '!macroend') {
      current = null
      continue
    }
    match = /^ {2}!insertmacro \$\{_M\} "((?:[^"$]|\$\$)*)"$/.exec(line)
    if (match && current) {
      current.push(match[1].replaceAll('$$', '$'))
      continue
    }
    throw new Error(`unexpected NSH line: ${line}`)
  }
  return { macros, defines }
}

/** 独立遍历打包目录（跟随符号链接，和 7z 打包一致）。 */
function independentWalk(root) {
  const files = []
  const dirs = []
  const visit = (absDir, relDir) => {
    for (const name of fs.readdirSync(absDir)) {
      const child = path.join(absDir, name)
      const rel = relDir ? `${relDir}\\${name}` : name
      if (fs.statSync(child).isDirectory()) {
        dirs.push(rel)
        visit(child, rel)
      } else {
        files.push(rel)
      }
    }
  }
  visit(root, '')
  return { files, dirs }
}

/** 三方对账：NSH ↔ JSON ↔ 独立遍历。返回差异描述，空数组 = 一致。 */
function crossCheck(manifest, nshText, root, { elevate = true } = {}) {
  const problems = []
  const sorted = (list) => [...list].sort()
  const compare = (label, actual, expected) => {
    const have = new Set(actual)
    const want = new Set(expected)
    for (const item of want) if (!have.has(item)) problems.push(`${label}: missing ${item}`)
    for (const item of have) if (!want.has(item)) problems.push(`${label}: unexpected ${item}`)
    if (actual.length !== have.size) problems.push(`${label}: duplicates`)
  }
  const tree = independentWalk(root)
  const treeFiles = elevate && !tree.files.includes(ELEVATE_HELPER) ? [...tree.files, ELEVATE_HELPER] : tree.files
  const treeTopLevel = [...new Set([...treeFiles, ...tree.dirs].map((rel) => rel.split('\\')[0]))]
  compare('JSON files vs tree', manifest.files, treeFiles)
  compare('JSON dirs vs tree', manifest.dirs, tree.dirs)
  compare('JSON top-level names vs tree', manifest.topLevelNames, treeTopLevel)

  const { macros, defines } = parseNsh(nshText)
  compare('NSH files vs JSON', macros.get('NOMI_INSTALLER_FILES') ?? [], manifest.files)
  compare('NSH dirs vs JSON', macros.get('NOMI_INSTALLER_DIRS') ?? [], manifest.dirs)
  compare('NSH top-level names vs JSON', macros.get('NOMI_INSTALLER_TOP_LEVEL_NAMES') ?? [], manifest.topLevelNames)
  if (defines.get('NOMI_INSTALLER_MANIFEST_VERSION') !== `"${manifest.version.replaceAll('$', '$$$$')}"`) problems.push('NSH version define does not match the JSON version')
  if (defines.get('NOMI_INSTALLER_MANIFEST_FILE_COUNT') !== String(manifest.files.length)) problems.push('NSH file count does not match')

  // 卸载时目录是非递归删的：子目录必须排在父目录之前，否则父目录永远删不掉、留残渣。
  const deepest = macros.get('NOMI_INSTALLER_DIRS_DEEPEST_FIRST') ?? []
  compare('NSH deepest-first dirs vs JSON', deepest, manifest.dirs)
  deepest.forEach((dir, index) => {
    for (const later of deepest.slice(index + 1)) {
      if (later.startsWith(`${dir}\\`)) problems.push(`deepest-first order: ${dir} comes before its subdirectory ${later}`)
    }
  })
  if (JSON.stringify(sorted(manifest.files)) !== JSON.stringify(sorted(new Set(manifest.files)))) problems.push('JSON files have duplicates')
  return problems
}

const BASE = { productFilename: 'Nomi', version: '0.24.1', arch: 1 }

describe('installer manifest generator (M1)', () => {
  it('lists every file and directory of the packed app — empty directories, dotfiles and awkward names included — and the NSH, the JSON and an independent walk agree', () => {
    const root = buildTree(tempRoot('installer-manifest-'), PACKED_APP)
    const manifest = computeInstallerManifest({ ...BASE, appOutDir: root })
    const nsh = renderNsh(manifest)
    expect(crossCheck(manifest, nsh, root)).toEqual([])

    expect(manifest.dirs).toContain('resources\\app.asar.unpacked\\node_modules\\empty-pkg')
    expect(manifest.dirs).toContain('swiftshader')
    expect(manifest.files).toContain('resources\\.dotfile')
    expect(manifest.topLevelNames).toEqual(['LICENSES.chromium.html', 'Nomi.exe', 'ffmpeg.dll', 'locales', 'resources', 'swiftshader'])
    expect(manifest.uninstallerFileName).toBe('Uninstall Nomi.exe')
    expect(manifest.arch).toBe('x64')
    // $ 在 NSIS 字符串里是变量 / 语言串的开头，必须写成 $$，否则 $INSTDIR 会被展开成真的安装目录。
    expect(nsh).toContain('"resources\\price $$5 $$INSTDIR $$(lang).txt"')
    expect(nsh).not.toMatch(/[^$]\$INSTDIR/)
  })

  it('adds resources\\elevate.exe exactly when electron-builder copies it in after afterPack', () => {
    const root = buildTree(tempRoot('installer-manifest-elevate-'), PACKED_APP)
    const withHelper = computeInstallerManifest({ ...BASE, appOutDir: root })
    expect(withHelper.files).toContain(ELEVATE_HELPER)
    expect(computeInstallerManifest({ ...BASE, appOutDir: root, nsisOptions: { packElevateHelper: false } }).files).not.toContain(ELEVATE_HELPER)
    expect(computeInstallerManifest({ ...BASE, appOutDir: root, nsisOptions: { packElevateHelper: false, perMachine: true } }).files).toContain(ELEVATE_HELPER)

    fs.writeFileSync(abs(root, ELEVATE_HELPER), 'already copied by an earlier build')
    const again = computeInstallerManifest({ ...BASE, appOutDir: root })
    expect(again.files.filter((rel) => rel === ELEVATE_HELPER)).toHaveLength(1)
    expect(crossCheck(again, renderNsh(again), root)).toEqual([])
  })

  it('refuses a packed app with no resources\\ directory when elevate.exe has to go there', () => {
    const root = buildTree(tempRoot('installer-manifest-nores-'), { files: ['Nomi.exe'] })
    expect(() => computeInstallerManifest({ ...BASE, appOutDir: root })).toThrow(/no resources directory/)
    expect(computeInstallerManifest({ ...BASE, appOutDir: root, nsisOptions: { packElevateHelper: false } }).files).toEqual(['Nomi.exe'])
  })

  it('follows a symlinked directory like the 7z packer does, and refuses a symlink cycle', () => {
    const root = buildTree(tempRoot('installer-manifest-link-'), { files: ['Nomi.exe', 'resources\\app.asar', 'real\\a.txt'] })
    const linkType = process.platform === 'win32' ? 'junction' : 'dir'
    fs.symlinkSync(abs(root, 'real'), abs(root, 'linked'), linkType)
    const manifest = computeInstallerManifest({ ...BASE, appOutDir: root })
    expect(manifest.files).toEqual(expect.arrayContaining(['linked\\a.txt', 'real\\a.txt']))
    expect(manifest.dirs).toEqual(expect.arrayContaining(['linked', 'real']))
    expect(crossCheck(manifest, renderNsh(manifest), root)).toEqual([])

    fs.symlinkSync(root, abs(root, 'real\\loop'), linkType)
    expect(() => walkAppOutDir(root)).toThrow(/symlink cycle/)
  })

  it('only handles x64 and refuses file associations, before anything is written', () => {
    const root = buildTree(tempRoot('installer-manifest-arch-'), PACKED_APP)
    for (const arch of [0, 3, 'arm64', 'ia32', undefined]) {
      expect(() => computeInstallerManifest({ ...BASE, appOutDir: root, arch })).toThrow(/not supported/)
    }
    expect(computeInstallerManifest({ ...BASE, appOutDir: root, arch: 'x64' }).arch).toBe('x64')
    expect(() => computeInstallerManifest({ ...BASE, appOutDir: root, fileAssociations: [{ ext: 'nomi' }] })).toThrow(/fileAssociations/)
  })

  it('refuses names NSIS cannot express instead of guessing', () => {
    const root = buildTree(tempRoot('installer-manifest-define-'), { files: ['Nomi.exe', 'resources\\app.asar', 'resources\\a${VERSION}.txt'] })
    expect(() => computeInstallerManifest({ ...BASE, appOutDir: root })).toThrow(/cannot be expressed in NSIS/)
    expect(() => nsisQuote('a"b')).toThrow(/quote or control character/)
    expect(() => nsisQuote('a\u0001b')).toThrow(/quote or control character/)
    expect(nsisQuote('$')).toBe('"$$"')
    expect(nsisQuote('中文 名字')).toBe('"中文 名字"')
  })

  it('renders byte-identical output for the same tree, whatever order the files were created in', () => {
    const first = buildTree(tempRoot('installer-manifest-order-a-'), PACKED_APP)
    const second = buildTree(tempRoot('installer-manifest-order-b-'), { files: [...PACKED_APP.files].reverse(), emptyDirs: [...PACKED_APP.emptyDirs].reverse() })
    const render = (root) => renderNsh(computeInstallerManifest({ ...BASE, appOutDir: root }))
    expect(render(first)).toBe(render(first))
    expect(render(second)).toBe(render(first))
  })

  it('needs a product name, a version and at least one file', () => {
    const root = buildTree(tempRoot('installer-manifest-empty-'), { emptyDirs: ['resources'] })
    expect(() => computeInstallerManifest({ ...BASE, appOutDir: root })).toThrow(/has no files/)
    const full = buildTree(tempRoot('installer-manifest-meta-'), PACKED_APP)
    expect(() => computeInstallerManifest({ ...BASE, appOutDir: full, version: '' })).toThrow(/required/)
    expect(() => computeInstallerManifest({ ...BASE, appOutDir: full, productFilename: '' })).toThrow(/required/)
    expect(uninstallerFileName('Nomi')).toBe('Uninstall Nomi.exe')
  })

  it('CX4: the cross-check catches a generator that drops empty directories, and the parser catches an unescaped $', () => {
    const root = buildTree(tempRoot('installer-manifest-cx4-'), PACKED_APP)
    const manifest = computeInstallerManifest({ ...BASE, appOutDir: root })
    const dropped = { ...manifest, dirs: manifest.dirs.filter((rel) => rel !== 'swiftshader') }
    dropped.topLevelNames = manifest.topLevelNames.filter((name) => name !== 'swiftshader')
    expect(crossCheck(dropped, renderNsh(dropped), root)).toEqual(expect.arrayContaining([
      'JSON dirs vs tree: missing swiftshader',
      'JSON top-level names vs tree: missing swiftshader',
    ]))
    const unescaped = renderNsh(manifest).replace('$$INSTDIR', '$INSTDIR')
    expect(() => parseNsh(unescaped)).toThrow(/unexpected NSH line/)
    // 「最深在前」排成父目录在前：非递归删目录时父目录永远删不掉。
    const parentFirst = renderNsh(manifest).replace(
      /(!macro NOMI_INSTALLER_DIRS_DEEPEST_FIRST _M\n)[\s\S]*?(!macroend)/,
      (_, head, tail) => `${head}${manifest.dirs.map((rel) => `  !insertmacro \${_M} ${nsisQuote(rel)}`).join('\n')}\n${tail}`,
    )
    expect(crossCheck(manifest, parentFirst, root)).toContain('deepest-first order: resources comes before its subdirectory resources\\assets')
  })
})

describe('afterPack wiring (M2)', () => {
  const contextFor = (electronPlatformName, appOutDir, projectDir) => ({
    electronPlatformName,
    appOutDir,
    arch: 1,
    packager: {
      projectDir,
      appInfo: { productFilename: 'Nomi', version: '0.24.1' },
      config: { nsis: { oneClick: false } },
      fileAssociations: [],
    },
  })

  it('a win32 pack writes <projectDir>/.tmp/installer-manifest/Nomi-x64.nsh and .json from the packed app', async () => {
    const projectDir = tempRoot('installer-manifest-project-')
    const appOutDir = buildTree(tempRoot('installer-manifest-unpacked-'), PACKED_APP)
    await afterPack(contextFor('win32', appOutDir, projectDir))
    const target = manifestPaths(projectDir, 'Nomi', 'x64')
    expect(target.nsh).toBe(path.join(projectDir, '.tmp', 'installer-manifest', 'Nomi-x64.nsh'))
    const written = JSON.parse(fs.readFileSync(target.json, 'utf8'))
    expect(written).toEqual(computeInstallerManifest({ ...BASE, appOutDir }))
    expect(crossCheck(written, fs.readFileSync(target.nsh, 'utf8'), appOutDir)).toEqual([])
  })

  it('a linux pack writes no installer manifest', async () => {
    const projectDir = tempRoot('installer-manifest-project-linux-')
    const appOutDir = buildTree(tempRoot('installer-manifest-unpacked-linux-'), PACKED_APP)
    await afterPack(contextFor('linux', appOutDir, projectDir))
    expect(fs.existsSync(path.join(projectDir, '.tmp'))).toBe(false)
  })
})
