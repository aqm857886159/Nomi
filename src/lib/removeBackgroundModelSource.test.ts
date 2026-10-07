// 抠图模型镜像的版本钉：镜像目录名里的版本号必须等于装着的 @imgly/background-removal 包版本。
// 升级 @imgly 而不同步这里（以及镜像里那一套文件），抠图会去一个不存在的目录拉文件——首次抠图必失败，
// 而任何类型检查都看不出来。
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  IMGLY_BACKGROUND_REMOVAL_DATA_VERSION,
  REMOVE_BACKGROUND_MODEL,
  REMOVE_BACKGROUND_PUBLIC_PATH,
  REMOVE_BACKGROUND_RESOURCE_KEYS,
} from './removeBackgroundModelSource'

const require = createRequire(import.meta.url)

describe('抠图模型镜像', () => {
  it('镜像版本 = 装着的 @imgly/background-removal 版本（升级时必须同步改、并先把新版本文件传上镜像）', () => {
    const entry = require.resolve('@imgly/background-removal')
    const pkg = JSON.parse(readFileSync(path.join(path.dirname(entry), '..', 'package.json'), 'utf8')) as { version: string }
    expect(IMGLY_BACKGROUND_REMOVAL_DATA_VERSION).toBe(pkg.version)
  })

  it('镜像根以版本目录结尾、带结尾斜杠（@imgly 用 new URL(chunk, publicPath) 拼地址）', () => {
    expect(REMOVE_BACKGROUND_PUBLIC_PATH).toBe(`https://models.nomiaqm.com/@imgly/background-removal-data/${IMGLY_BACKGROUND_REMOVAL_DATA_VERSION}/dist/`)
    expect(REMOVE_BACKGROUND_RESOURCE_KEYS).toContain(`/models/${REMOVE_BACKGROUND_MODEL}`)
  })

  it('worker 用的是镜像根，没有退回外站的第二条路', () => {
    const worker = readFileSync(new URL('./removeBackground.worker.ts', import.meta.url), 'utf8')
    expect(worker).toContain('publicPath: REMOVE_BACKGROUND_PUBLIC_PATH')
    expect(worker).not.toMatch(/staticimgly/)
    const lib = readFileSync(new URL('./removeBackground.ts', import.meta.url), 'utf8')
    expect(lib).not.toMatch(/staticimgly/)
  })
})
