// 实验室打包产物进不了安装包（2026-11-14）：目录不在 package.json build.files 收的任何顶层位置里，
// 也在 .gitignore 里。谁把 LAB_BUNDLE_DIR 挪进 dist/ 之类会打包的位置，这里先红。
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { LAB_BUNDLE_DIR, bundleDirIsPackaged, packagedRoots } from './labBundle.mjs'
import { REPO_ROOT } from './labStates.mjs'

const buildFiles = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')).build.files

describe('实验室打包产物的位置', () => {
  it('不在安装包会收的位置里', () => {
    expect(packagedRoots(buildFiles)).toContain('dist')
    expect(bundleDirIsPackaged(LAB_BUNDLE_DIR, buildFiles)).toBe(false)
  })

  it('判据本身会红：挪进 dist/ 或 resources/ 就判成会进安装包', () => {
    expect(bundleDirIsPackaged(path.join(REPO_ROOT, 'dist', 'design-lab'), buildFiles)).toBe(true)
    expect(bundleDirIsPackaged(path.join(REPO_ROOT, 'resources', 'lab'), buildFiles)).toBe(true)
  })

  it('目录被 git 忽略，打出来的东西不会被误提交', () => {
    const top = path.relative(REPO_ROOT, LAB_BUNDLE_DIR).split(path.sep)[0]
    const ignore = fs.readFileSync(path.join(REPO_ROOT, '.gitignore'), 'utf8').split('\n').map((line) => line.trim())
    expect(ignore).toContain(`${top}/`)
  })

  it('视觉基线那一趟真的对着这个目录托管（打包和托管用同一份配置）', () => {
    const config = fs.readFileSync(path.join(REPO_ROOT, 'tests/ux/design-lab/playwright.config.mjs'), 'utf8')
    expect(config).toMatch(/vite build --config tests\/ux\/design-lab\/vite\.lab\.config\.mjs/)
    expect(config).toMatch(/vite preview --config tests\/ux\/design-lab\/vite\.lab\.config\.mjs/)
    expect(config).toMatch(/reuseExistingServer: false/)
    expect(config).not.toMatch(/npx vite --host/)
  })
})
