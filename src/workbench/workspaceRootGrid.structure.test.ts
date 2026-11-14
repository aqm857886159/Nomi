// 工作区根网格必须写行模板（2026-11-07 窄窗拍板 WindowNarrow / preview.grid-rows，F2）。
//
// 那一类：工作区根是 `display: grid`，左边是正文 / 画布 / 预览，右边是停靠的 Nomi 栏（AssistantPane）。
// 只写列模板、不写行模板时，那一行是隐式 auto 行——行高按内容定。预览页开着时把窗口从 900 缩到 720，内容还按上一次的
// 高摆着，这一行就留在原来的 852 高：Nomi 栏底边 892，付费卡「生成」767、时间轴 723 都在窗外，整页又不滚动，点不到
// （修前构建实测，tests/ux/window-narrow-pages.walk.mjs；直接以 720 高打开不出这个问题，所以只看「打开时」的走查抓不住）。
// 生成页早就写了 gridTemplateRows，预览、创作、分镜没写。
// 判据：凡是渲染 <AssistantPane 的文件，每一个 AssistantPane 都对应一处行模板（style 的 gridTemplateRows 或 grid-rows-[…]），
// 且行模板不许是 auto。新长一个工作区，只要它挂 Nomi 栏，就自动进这张普查表。
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = path.join(process.cwd(), 'src/workbench')

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name) ? [full] : []
  })
}
const stripComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '')

const hosts = walk(ROOT)
  .map((file) => ({ file: path.relative(process.cwd(), file).split(path.sep).join('/'), source: stripComments(fs.readFileSync(file, 'utf8')) }))
  .filter(({ source }) => /<AssistantPane\b/.test(source))

const count = (source: string, pattern: RegExp): number => source.match(pattern)?.length ?? 0
// 行模板以 minmax(0,1fr) 开头即可（生成页还跟着一行时间轴高度）。
const ROW_TEMPLATE = /gridTemplateRows\s*:\s*[`'"]minmax\(0,\s*1fr\)|grid-rows-\[minmax\(0,1fr\)/g

describe('挂 Nomi 栏的工作区根网格都写行模板', () => {
  it('普查对象非空：四个工作区都在', () => {
    expect(hosts.map(({ file }) => file).sort()).toEqual(expect.arrayContaining([
      'src/workbench/creation/CreationWorkspace.tsx',
      'src/workbench/creation/storyboard/StoryboardWorkspace.tsx',
      'src/workbench/generation/GenerationWorkspace.tsx',
      'src/workbench/preview/PreviewWorkspace.tsx',
    ]))
  })

  it('每一个 <AssistantPane 都有一处 minmax(0,1fr) 行模板', () => {
    const offenders = hosts
      .filter(({ source }) => count(source, ROW_TEMPLATE) < count(source, /<AssistantPane\b/g))
      .map(({ file, source }) => `${file}：AssistantPane ${count(source, /<AssistantPane\b/g)} 处，行模板 ${count(source, ROW_TEMPLATE)} 处`)
    expect(offenders).toEqual([])
  })

  it('行模板不许写成 auto（auto 就是 F2 本身）', () => {
    const offenders = hosts
      .filter(({ source }) => /gridTemplateRows\s*:\s*'auto'|grid-rows-\[auto\]|grid-rows-none/.test(source))
      .map(({ file }) => file)
    expect(offenders).toEqual([])
  })
})
