import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { ensureElectronSignature } from './ensure-electron-signature.mjs'

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8').trim()
  } catch {
    return null
  }
}

function normalizeVersion(value) {
  if (typeof value !== 'string') return null
  const normalized = value.trim().replace(/^v/, '')
  return normalized || null
}

function nodeModulesKind(nodeModulesPath) {
  try {
    const stat = fs.lstatSync(nodeModulesPath)
    if (stat.isSymbolicLink()) return 'symlink'
    if (stat.isDirectory()) return 'directory'
    return 'other'
  } catch {
    return 'missing'
  }
}

function resolveRuntimeExecutable(electronRoot) {
  const relativePath = readText(path.join(electronRoot, 'path.txt'))
  if (!relativePath || path.isAbsolute(relativePath)) return null
  const distRoot = path.resolve(electronRoot, 'dist')
  const executablePath = path.resolve(distRoot, relativePath)
  if (executablePath !== distRoot && !executablePath.startsWith(`${distRoot}${path.sep}`)) return null
  return fs.existsSync(executablePath) ? executablePath : null
}

export function isPathInside(candidate, root, pathApi = path) {
  const relative = pathApi.relative(root, candidate)
  return (
    relative === '' || (relative !== '..' && !relative.startsWith(`..${pathApi.sep}`) && !pathApi.isAbsolute(relative))
  )
}

export function isPhysicalPathInside(candidate, root, fsApi = fs, pathApi = path) {
  const realRoot = fsApi.realpathSync(root)
  const rootIdentity = fsApi.statSync(realRoot, { bigint: true })
  let current = fsApi.realpathSync(candidate)

  while (true) {
    const currentIdentity = fsApi.statSync(current, { bigint: true })
    if (currentIdentity.dev === rootIdentity.dev && currentIdentity.ino === rootIdentity.ino) return true
    const parent = pathApi.dirname(current)
    if (parent === current) return false
    current = parent
  }
}

function externalElectronPath(packagePath, allowedRoot, runtimeExecutable) {
  try {
    const normalizedRoot = path.resolve(allowedRoot)
    if (fs.lstatSync(packagePath).isSymbolicLink()) {
      const target = fs.readlinkSync(packagePath)
      const lexicalTarget = path.resolve(path.dirname(packagePath), target)
      if (!isPathInside(lexicalTarget, normalizedRoot)) return `package link -> ${target}`
    }

    for (const [label, candidate] of [
      ['package', packagePath],
      ['dist', path.join(packagePath, 'dist')],
      ['executable', runtimeExecutable],
    ]) {
      if (!candidate || !fs.existsSync(candidate)) continue
      const realCandidate = fs.realpathSync(candidate)
      if (!isPhysicalPathInside(candidate, allowedRoot)) return `${label} realpath -> ${realCandidate}`
    }
    return null
  } catch {
    return null
  }
}

function defaultProbeRuntimeVersion(executablePath) {
  if (ensureElectronSignature(executablePath) === 'failed') return null
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const args = ['--version', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])]
  const result = spawnSync(executablePath, args, {
    encoding: 'utf8',
    env,
    timeout: 15_000,
    windowsHide: true,
  })
  if (result.error || result.signal || result.status !== 0) return null
  return normalizeVersion(`${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim())
}

function problem(code, detail) {
  return { code, detail }
}

export function inspectElectronInstallIdentity(repoRoot, options = {}) {
  const probeRuntimeVersion = options.probeRuntimeVersion ?? defaultProbeRuntimeVersion
  const packageJson = readJson(path.join(repoRoot, 'package.json'))
  const declaredVersion = normalizeVersion(packageJson?.devDependencies?.electron)
  const nodeModulesPath = path.join(repoRoot, 'node_modules')
  const modulesKind = nodeModulesKind(nodeModulesPath)
  const electronRoot = path.join(nodeModulesPath, 'electron')
  const installedVersion = normalizeVersion(readJson(path.join(electronRoot, 'package.json'))?.version)
  const distVersion = normalizeVersion(readText(path.join(electronRoot, 'dist', 'version')))
  const runtimeExecutable = resolveRuntimeExecutable(electronRoot)
  const externalElectronLink = externalElectronPath(electronRoot, nodeModulesPath, runtimeExecutable)
  const mayProbeRuntime = modulesKind === 'directory' && !externalElectronLink
  const runtimeVersion =
    mayProbeRuntime && runtimeExecutable ? normalizeVersion(probeRuntimeVersion(runtimeExecutable)) : null
  const problems = []

  if (modulesKind === 'symlink') {
    problems.push(problem('shared-node-modules', 'top-level node_modules is a symbolic link or junction'))
  } else if (modulesKind !== 'directory') {
    problems.push(problem('node-modules-missing', `top-level node_modules is ${modulesKind}`))
  }
  if (externalElectronLink) {
    problems.push(
      problem('external-electron-package-link', `Electron installation escapes this worktree: ${externalElectronLink}`),
    )
  }
  if (!declaredVersion) {
    problems.push(problem('electron-declaration-missing', 'package.json must declare an exact Electron version'))
  }
  if (!installedVersion) {
    problems.push(problem('electron-package-missing', 'node_modules/electron/package.json is unavailable'))
  } else if (declaredVersion && installedVersion !== declaredVersion) {
    problems.push(
      problem(
        'installed-version-mismatch',
        `package.json declares ${declaredVersion}, installed package is ${installedVersion}`,
      ),
    )
  }

  if (!distVersion || !runtimeExecutable) {
    problems.push(problem('runtime-not-installed', 'Electron dist/version or executable is missing'))
  } else {
    if (declaredVersion && distVersion !== declaredVersion) {
      problems.push(
        problem('dist-version-mismatch', `package.json declares ${declaredVersion}, downloaded dist is ${distVersion}`),
      )
    }
    if (mayProbeRuntime) {
      if (!runtimeVersion) {
        problems.push(problem('runtime-probe-failed', 'Electron executable did not report a version'))
      } else if (declaredVersion && runtimeVersion !== declaredVersion) {
        problems.push(
          problem(
            'runtime-version-mismatch',
            `package.json declares ${declaredVersion}, executable reports ${runtimeVersion}`,
          ),
        )
      }
    }
  }

  return {
    repoRoot,
    nodeModulesKind: modulesKind,
    declaredVersion,
    installedVersion,
    distVersion,
    runtimeVersion,
    runtimeExecutable,
    problems,
  }
}

export function formatElectronInstallError(identity) {
  const facts = [
    `declared=${identity.declaredVersion ?? 'missing'}`,
    `installed=${identity.installedVersion ?? 'missing'}`,
    `dist=${identity.distVersion ?? 'missing'}`,
    `runtime=${identity.runtimeVersion ?? 'missing'}`,
    `node_modules=${identity.nodeModulesKind}`,
  ].join(' · ')
  const details = identity.problems.map((entry) => `  - [${entry.code}] ${entry.detail}`).join('\n')
  const repair = identity.problems.some((entry) => entry.code === 'shared-node-modules')
    ? '只删除当前 worktree 顶层的 node_modules 链接（macOS/Linux: `unlink node_modules`；PowerShell: `Remove-Item node_modules`），再执行 `pnpm install --frozen-lockfile --prefer-offline`。'
    : '把当前 worktree 的 node_modules 移到备份目录，再执行 `pnpm install --frozen-lockfile --prefer-offline`。'
  return `Electron 安装身份不一致（${facts}）：\n${details}\n${repair}\n禁止在 worktree 之间共享 node_modules；pnpm store 会自行复用包内容。`
}

export function assertElectronInstallIdentity(repoRoot, options = {}) {
  const identity = inspectElectronInstallIdentity(repoRoot, options)
  if (identity.problems.length === 0) return identity
  const error = new Error(formatElectronInstallError(identity))
  error.name = 'ElectronInstallIdentityError'
  error.identity = identity
  throw error
}
