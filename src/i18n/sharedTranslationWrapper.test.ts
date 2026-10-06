import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { useTranslation } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from './index'

// 类级检查（逃逸 FB-20261005-01-open-mount）：useTranslation 给每个组件实例首挂都复制一遍 i18n 实例的全部属性描述符
//（react-i18next 17.0.10 / 17.0.15 的 createI18nWrapper）。打开大项目时可见的 180 张卡、每张好几个组件都调它，
// 实测首挂里约 46ms 花在这上面。修在依赖本身（pnpm patch：同一个 i18n 实例 + 语言只建一个包装，所有组件共用），
// 所以对仓库里全部 useTranslation 调用点同时成立，不用逐个改组件。
// 矩阵：挂 1 / 10 / 180 / 500 个用 useTranslation 的组件，包装都只建一次；换语言恰好再建一次、身份随之变化（上游要的语义）。

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '../..')
const MOUNT_MATRIX = [1, 10, 180, 500]

function Leaf(): React.ReactElement {
  const { t, i18n: wrapper } = useTranslation()
  seen.add(wrapper)
  return React.createElement('span', null, t('common.retry'))
}
const seen = new Set<unknown>()

function wrapperBuilds(count: number): number {
  const spy = vi.spyOn(Object, 'getOwnPropertyDescriptors')
  try {
    renderToString(React.createElement(React.Fragment, null, ...Array.from({ length: count }, (_, index) => React.createElement(Leaf, { key: index }))))
    return spy.mock.calls.filter(([target]) => target === i18n).length
  } finally {
    spy.mockRestore()
  }
}

afterEach(() => seen.clear())

describe('useTranslation shares one i18n wrapper per instance + language across every component', () => {
  for (const count of MOUNT_MATRIX) {
    it(`mounting ${count} translated components builds the wrapper at most once`, () => {
      wrapperBuilds(1) // 预热：本语言的包装先建好
      expect(wrapperBuilds(count)).toBe(0)
      expect(seen.size).toBe(1)
    })
  }

  it('a language change builds exactly one new wrapper, and every component sees the new identity', async () => {
    const original = i18n.language
    const other = original === 'en' ? 'zh-CN' : 'en'
    wrapperBuilds(1)
    const before = [...seen][0]
    seen.clear()
    await i18n.changeLanguage(other)
    try {
      expect(wrapperBuilds(180)).toBe(1)
      expect(seen.size).toBe(1)
      expect([...seen][0]).not.toBe(before)
    } finally {
      await i18n.changeLanguage(original)
    }
  })

  it('the dependency patch is registered and actually installed (an upgrade without re-applying it must fail here)', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
    const patched = Object.keys(manifest.pnpm?.patchedDependencies ?? {})
    const installed = createRequire(import.meta.url)('react-i18next/package.json').version as string
    expect(patched).toContain(`react-i18next@${installed}`)
    const esm = fs.readFileSync(path.join(path.dirname(createRequire(import.meta.url).resolve('react-i18next/package.json')), 'dist/es/useTranslation.js'), 'utf8')
    expect(esm).toContain('sharedI18nWrapper')
  })
})
