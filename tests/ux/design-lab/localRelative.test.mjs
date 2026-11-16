import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { chromium } from '@playwright/test'
import { describe, expect, it, vi } from 'vitest'
import { makeTempDir } from '../../../scripts/_test-temp.mjs'
import { cacheKey, localConfigSource, readRelativeReport, runLocalRelative, withBaselineSource } from './localRelative.mjs'

const inputs = { runner: { platform: 'darwin', arch: 'arm64', osVersion: '26.5' }, host: 'developer', browser: 'Chromium 145', viewport: { width: 1440, height: 1000, deviceScaleFactor: 1 }, colorScheme: 'light', commit: 'abc' }
const spec = (id, errors = [], attachments = []) => ({ title: `状态 ${id} · 示例`, tests: [{ results: [{ status: errors.length ? 'failed' : 'passed', errors, attachments }] }] })
const report = (specs, errors = []) => ({ errors, suites: [{ title: 'file', suites: [{ title: 'design lab · settings', specs }] }] })

describe('本机相对视觉检查', () => {
  it('缓存隔离机器、浏览器、视口和基准提交', () => {
    expect(cacheKey(inputs)).toBe(cacheKey({ ...inputs }))
    for (const replacement of [{ host: 'other' }, { runner: { ...inputs.runner, osVersion: '26.7' } }, { browser: 'Chromium 146' }, { viewport: { ...inputs.viewport, width: 1280 } }, { commit: 'def' }]) {
      expect(cacheKey({ ...inputs, ...replacement })).not.toBe(cacheKey(inputs))
    }
  })
  it('只对工作树外同机缓存比，不读写 CI 基线，CLI 才能更新临时基准', () => {
    const code = localConfigSource({ sourceRoot: '/source', snapshots: '/cache/shots', results: '/results', report: '/report.json', calibration: { viewport: inputs.viewport, colorScheme: inputs.colorScheme }, unstable: ['settings/s-02'] })
    expect(code).toContain('snapshotPathTemplate: "/cache/shots/{arg}{ext}"')
    expect(code).toContain('/source/tests/ux/design-lab/playwright.config.mjs')
    expect(code).not.toContain('__baselines__')
    expect(code).not.toContain("updateSnapshots: 'all'")
    expect(code).toContain('s-02')
    expect(spawnSync(process.execPath, ['--input-type=module', '--check'], { input: code, encoding: 'utf8' }).status).toBe(0)
  })
  it('旧提交配置不同也用当前校准上下文，且只排除指定的不稳定格', async () => {
    const root = makeTempDir('nomi-relative-config-')
    const lab = path.join(root, 'tests/ux/design-lab')
    fs.mkdirSync(lab, { recursive: true })
    fs.writeFileSync(path.join(lab, 'playwright.config.mjs'), 'export default { use: { viewport: { width: 1, height: 2 }, deviceScaleFactor: 3, colorScheme: "dark" }, webServer: {} }')
    const file = path.join(root, 'local.mjs')
    fs.writeFileSync(file, localConfigSource({ sourceRoot: root, snapshots: '/cache', results: '/results', report: '/report.json', calibration: { viewport: inputs.viewport, colorScheme: inputs.colorScheme }, unstable: ['settings/s-02'] }))
    const config = (await import(pathToFileURL(file).href)).default
    expect(config.use).toMatchObject({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, colorScheme: 'light' })
    expect(config.grepInvert.test('file design lab · settings 状态 s-02 · demo')).toBe(true)
    expect(config.grepInvert.test('file design lab · settings 状态 s-03 · demo')).toBe(false)
  })
  it('有格变化必须列名字与差异图；新增、删除、不稳定分列', () => {
    const result = readRelativeReport(report([
      spec('same'), spec('changed', [{ message: 'Error: expect(locator).toHaveScreenshot(expected) failed\n1390 pixels (ratio 0.01 of all image pixels) are different.' }], [{ name: 'screenshot-diff', path: '/results/changed-diff.png' }]),
      spec('added', [{ message: "A snapshot doesn't exist at /cache/shots/settings/added.png" }]),
    ]), { baseline: ['settings/same', 'settings/changed', 'settings/removed', 'settings/unstable'], unstable: ['settings/unstable'] })
    expect(result.changed).toEqual([{ name: 'settings/changed', diff: '/results/changed-diff.png' }])
    expect(result.added).toEqual(['settings/added'])
    expect(result.removed).toEqual(['settings/removed'])
    expect(result.unstable).toEqual(['settings/unstable'])
    expect(result.compared).toBe(2)
  })
  it('Playwright 的尺寸差异也算变化，而不是基础设施错误', () => {
    expect(readRelativeReport(report([spec('resized', [{ message: 'Expected an image 800px by 600px, received 800px by 900px.' }], [{ path: '/resized-diff.png' }])]), { baseline: ['settings/resized'] }).changed).toEqual([{ name: 'settings/resized', diff: '/resized-diff.png' }])
  })
  it('基准渲染失败、页面错误、半途没跑完不能冒充没变（即使也有差异图）', () => {
    for (const invalid of [report([spec('broken')], [{ message: 'webServer failed' }]), report([spec('broken', [{ message: 'page.goto: net::ERR_CONNECTION_REFUSED' }])]), report([]), report([spec('mixed', [{ message: 'Screenshot comparison failed' }, { message: 'page crashed' }], [{ path: '/x-diff.png' }])])]) {
      expect(() => readRelativeReport(invalid, { baseline: ['settings/broken'], unstable: [] })).toThrow()
    }
  })
  it('基准真实子进程失败时退出非零，写失败报告并清理临时工作树', async () => {
    const root = makeTempDir('nomi-relative-failure-')
    const git = (...args) => {
      const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
      if (result.status !== 0) throw new Error(result.stderr)
      return result.stdout
    }
    fs.writeFileSync(path.join(root, 'pnpm-lock.yaml'), 'lock')
    fs.writeFileSync(path.join(root, 'package.json'), '{}')
    fs.symlinkSync(path.resolve('node_modules'), path.join(root, 'node_modules'), 'dir')
    const lab = path.join(root, 'tests/ux/design-lab')
    fs.mkdirSync(lab, { recursive: true })
    fs.writeFileSync(path.join(lab, 'playwright.config.mjs'), "throw new Error('baseline render failed')")
    fs.writeFileSync(path.join(lab, 'labServer.mjs'), "export const labOriginFor = () => 'http://127.0.0.1:5197'")
    git('init', '--quiet')
    git('add', 'package.json', 'pnpm-lock.yaml', 'tests')
    git('-c', 'commit.gpgsign=false', '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'fixture')
    git('update-ref', 'refs/remotes/origin/main', 'HEAD')
    const homedir = vi.spyOn(os, 'homedir').mockReturnValue(root)
    const launch = vi.spyOn(chromium, 'launch').mockResolvedValue({ version: () => 'test-engine', close: async () => {} })
    try {
      expect(await runLocalRelative({ repoRoot: root, runner: inputs.runner, calibration: { viewport: inputs.viewport, colorScheme: inputs.colorScheme }, resultsDir: path.join(root, 'results') })).toBe(1)
      const receipt = JSON.parse(fs.readFileSync(path.join(root, 'outputs/design-lab/relative.json'), 'utf8'))
      expect(receipt.status).toBe('failed')
      expect(receipt.error).toContain('视觉道失败')
      expect(git('worktree', 'list', '--porcelain').match(/^worktree /gm)).toHaveLength(1)
    } finally {
      homedir.mockRestore()
      launch.mockRestore()
    }
  })

  it('渲染基准只建隔离工作树，用完清掉，不写当前未提交文件；失败也清', async () => {
    const root = makeTempDir('nomi-relative-source-')
    fs.writeFileSync(path.join(root, 'pnpm-lock.yaml'), 'lock')
    fs.mkdirSync(path.join(root, 'node_modules'))
    const uncommitted = path.join(root, 'draft.txt')
    fs.writeFileSync(uncommitted, '未提交\n')
    const calls = []
    const git = (_root, args) => {
      calls.push(args)
      if (args[0] === 'worktree' && args[1] === 'add') {
        fs.mkdirSync(args[3], { recursive: true })
        fs.writeFileSync(path.join(args[3], 'pnpm-lock.yaml'), 'lock')
      }
      return ''
    }
    await expect(withBaselineSource({ repoRoot: root, commit: 'abc', tempRoot: root, git }, async (source) => {
      expect(source).not.toBe(root)
      expect(fs.realpathSync(path.join(source, 'node_modules'))).toBe(path.join(root, 'node_modules'))
      throw new Error('baseline render failed')
    })).rejects.toThrow('baseline render failed')
    expect(fs.readFileSync(uncommitted, 'utf8')).toBe('未提交\n')
    expect(calls[0].slice(0, 3)).toEqual(['worktree', 'add', '--detach'])
    expect(calls.at(-1).slice(0, 3)).toEqual(['worktree', 'remove', '--force'])
  })
})
