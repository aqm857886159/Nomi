import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (relative: string): string =>
  fs.readFileSync(path.join(process.cwd(), relative), 'utf8')
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const row = stripComments(read('src/workbench/creation/storyboard/shotRow/StoryboardShotRow.tsx'))
const zone = stripComments(read('src/workbench/creation/storyboard/shotRow/ShotReferenceZone.tsx'))

describe('分镜行：展开箭头', () => {
  /**
   * 真 bug：`onClickCapture={(e) => e.stopPropagation()}` 写在**按钮自己身上**。React 合成事件在同一棵
   * 派发树里先走完捕获再走冒泡，捕获阶段停派发会连同该元素自己的 `onClick` 一起吃掉 —— 箭头点了没反应，
   * 只有点 subline 空白处（父层 onClick）才展开。这条断言钉的是「别再用捕获阶段拦自己」。
   */
  it('不用捕获阶段的 stopPropagation（那会吃掉元素自己的 onClick）', () => {
    expect(row).not.toContain('onClickCapture')
  })
})

describe('分镜行：参考区复用画布那套参考槽（不许再造一套）', () => {
  it('行内不自己画槽 tile —— 渲染交给 ShotReferenceZone', () => {
    expect(row).toContain('<ShotReferenceZone')
    expect(row).not.toContain('data-storyboard-ref-tile="named-slot"')
  })

  it('参考区消费共享的 AssetReference（AssetTile / AssetPicker 一并复用）', () => {
    expect(zone).toContain("from '../../../assets/AssetReference'")
    expect(zone).toContain('<AssetReference')
  })

  it('槽的容量/类型判定不在渲染层就地写，走 shotReferenceSlots 的纯函数', () => {
    expect(zone).toContain("from './shotReferenceSlots'")
    // 供应商名字不该出现在分镜行的任何一层（P4：按声明渲染，不为具体模型写 if）。
    for (const source of [row, zone]) {
      expect(source.toLowerCase()).not.toContain('seedance')
      expect(source.toLowerCase()).not.toContain('veo')
    }
  })
})
