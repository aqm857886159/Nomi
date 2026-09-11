import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (relative: string): string => fs.readFileSync(path.join(process.cwd(), relative), 'utf8')
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const toolbar = stripComments(read('src/workbench/creation/storyboard/StoryboardSelectionToolbar.tsx'))
const table = stripComments(read('src/workbench/creation/storyboard/StoryboardShotTable.tsx'))

describe('分镜多选条：「统一模型」按镜种分档，不再拼一条混列表', () => {
  /**
   * 2026-09-11 用户实测：多选几镜点「统一模型」，图片模型和视频模型混在一条列表里。
   * 这条测试固化的是**清单从哪来**——从 `storyboardBulkModelScope` 按镜种派生，
   * 而不是 `[...imageModelOptions, ...videoModelOptions]` 拼一份。
   */
  it('表不再把两份模型清单拼起来去重', () => {
    expect(table).not.toContain('[...imageModelOptions, ...videoModelOptions]')
    expect(table).not.toContain('selectableModelOptions')
    expect(table).toContain('storyboardBulkModelGroups(')
    expect(table).toContain('applyBulkModelToShots(')
  })

  it('多选条收的是分好档的 modelGroups，一档一个下拉', () => {
    expect(toolbar).toContain('modelGroups: readonly StoryboardBulkModelGroup[]')
    expect(toolbar).toContain('modelGroups.map(')
    expect(toolbar).toContain('data-storyboard-model-group={group.kind}')
  })

  it('作用域写在下拉的 leadingLabel 上（「图片 ×N」），与画布框选工具条同一套词', () => {
    expect(toolbar).toContain('generationCommon.production.modelGroup.${group.kind}')
    expect(toolbar).toContain('count: group.count')
    expect(toolbar).toContain('leadingLabel={scope}')
  })

  /** 混选时条上有两枚下拉：无障碍名各带自己那一档，两个一模一样的「统一模型」等于没有名字。 */
  it('无障碍名带作用域，不是两枚同名控件', () => {
    expect(toolbar).toContain("ariaLabel={t('storyboardEditor.selection.applyModelScoped', { scope })}")
  })

  it('选中回传 (kind, modelKey, vendor) 三件，镜种不留给下游猜', () => {
    expect(toolbar).toContain('onApplyModel: (kind: StoryboardShotKind, modelKey: string, vendor?: string) => void')
    expect(toolbar).toContain('onApplyModel(group.kind, value, vendor)')
  })

  /** P1：批量下拉全仓只有 `BulkModelPicker` 一份实现——这里不许再长一个原生 <select>。 */
  it('复用 BulkModelPicker，不自己写模型 <select>', () => {
    expect(toolbar).toContain("import BulkModelPicker from '../../common/BulkModelPicker'")
    expect(toolbar).not.toContain('selection.applyModel\')}</option>')
  })
})
