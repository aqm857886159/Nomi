import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (relative: string): string => fs.readFileSync(path.join(process.cwd(), relative), 'utf8')
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const toolbar = stripComments(read('src/workbench/creation/storyboard/StoryboardSelectionToolbar.tsx'))
const table = stripComments(read('src/workbench/creation/storyboard/StoryboardShotTable.tsx'))
const row = stripComments(read('src/workbench/creation/storyboard/shotRow/StoryboardShotRow.tsx'))
const planEdits = stripComments(read('src/workbench/generationCanvas/agent/storyboardPlanEdits.ts'))

describe('分镜多选条：「统一模型」按镜种分档，不再拼一条混列表', () => {
  /**
   * 2026-09-11 用户实测：多选几镜点「统一模型」，图片模型和视频模型混在一条列表里。
   * 这条测试固化的是**清单从哪来**——从 `storyboardBulkModelScope` 按镜种派生，
   * 而不是 `[...imageModelOptions, ...videoModelOptions]` 拼一份。
   */
  it('表不再把两份模型清单拼起来去重', () => {
    expect(table).not.toContain('[...imageModelOptions, ...videoModelOptions]')
    expect(table).not.toContain('selectableModelOptions')
    expect(table).toContain('storyboardBulkParamGroups(')
    expect(table).toContain('applyBulkModelToShots(')
  })

  it('多选条收的是分好档的 modelGroups，一档一个下拉', () => {
    expect(toolbar).toContain('modelGroups: readonly StoryboardBulkParamGroup[]')
    expect(toolbar).toContain('modelGroups.map(')
    expect(toolbar).toContain('data-storyboard-model-group={group.kind}')
  })

  it('作用域写在组前的小标签上（「图片 ×N」），与画布框选工具条同一套词', () => {
    expect(toolbar).toContain('generationCommon.production.modelGroup.${group.kind}')
    expect(toolbar).toContain('count: group.count')
    expect(toolbar).toContain('{scope}</span>')
  })

  /** 混选时条上有两枚下拉：无障碍名各带自己那一档，两个一模一样的「统一模型」等于没有名字。 */
  it('每组自带 data-storyboard-model-group 标记，走查与读屏分得清是哪一档', () => {
    expect(toolbar).toContain('data-storyboard-model-group={group.kind}')
  })

  it('选中回传 (kind, modelKey, vendor) 三件，镜种不留给下游猜', () => {
    expect(toolbar).toContain('onApplyModel: (kind: StoryboardShotKind, modelKey: string, vendor?: string) => void')
    expect(toolbar).toContain('onApplyModel(group.kind, value, vendor)')
  })

  /** P1：模型 + 参数全仓只有 `InlineParameterBar` 一份实现（画布节点、镜头行、这里同一个）——不许再长一个原生 <select>。 */
  it('复用 StoryboardBulkParams（InlineParameterBar），不自己写模型 <select>', () => {
    expect(toolbar).toContain("import StoryboardBulkParams from './StoryboardBulkParams'")
    expect(toolbar).not.toContain('BulkModelPicker')
    expect(toolbar).not.toContain('<select')
  })
})

describe('分镜行菜单承载低频动作', () => {
  /**
   * 2026-09-11 用户实测：没有分场的分镜里，「移到场」照样在条上，点开只有「移到场」和「未分场」
   * 两行——一个什么都做不了的下拉。判据写在渲染条件上，不靠一句提示去解释一个空控件。
   */
  it('移到场从多选浮条收回行菜单', () => {
    expect(toolbar).not.toContain('data-storyboard-move-to-scene')
    expect(toolbar).not.toContain('onMoveToScene')
    expect(row).toContain('rowMenu.moveToScene')
  })

  it('多选浮条不再提供批量锁定', () => {
    expect(toolbar).not.toContain('<select')
    expect(toolbar).not.toContain('onLock')
  })

  /**
   * 「未分场」那条命令值有三个写口（多选条、表的两条 onMoveToScene、行级菜单），
   * 各写一次字面量的代价是改名时只改得动其中几处、剩下那几处静默失效。
   * 所以它住 `storyboardPlanEdits`（plan 编辑词表的家），这条测试数的就是「还有没有第二份」。
   */
  it('NO_SCENE_VALUE 单一 owner，表与行菜单共用它', () => {
    expect(planEdits).toContain("export const NO_SCENE_VALUE = '__none__'")
    for (const consumer of [table, row]) {
      expect(consumer).toContain('NO_SCENE_VALUE')
      expect(consumer).not.toContain("'__none__'")
    }
  })
})
