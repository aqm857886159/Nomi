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

describe('分镜多选条：「移到场」没有场就不出现', () => {
  /**
   * 2026-09-11 用户实测：没有分场的分镜里，「移到场」照样在条上，点开只有「移到场」和「未分场」
   * 两行——一个什么都做不了的下拉。判据写在渲染条件上，不靠一句提示去解释一个空控件。
   */
  it('整枚下拉挂在 sceneOptions.length > 0 上', () => {
    expect(toolbar).toContain('{sceneOptions.length > 0 ? (')
    expect(toolbar).toContain('data-storyboard-move-to-scene="true"')
  })

  it('标题是真占位，不再是那条既当标签又当选项的 <option value="">', () => {
    expect(toolbar).not.toContain('<select')
    expect(toolbar).not.toContain('<option value="">')
    expect(toolbar).toContain("placeholder={t('storyboardEditor.selection.moveToScene')}")
  })

  /**
   * 「未分场」那条命令值有三个写口（多选条、表的两条 onMoveToScene、行级菜单），
   * 各写一次字面量的代价是改名时只改得动其中几处、剩下那几处静默失效。
   * 所以它住 `storyboardPlanEdits`（plan 编辑词表的家），这条测试数的就是「还有没有第二份」。
   */
  it('NO_SCENE_VALUE 单一 owner，三个写口都 import 它', () => {
    expect(planEdits).toContain("export const NO_SCENE_VALUE = '__none__'")
    for (const consumer of [toolbar, table, row]) {
      expect(consumer).toContain('NO_SCENE_VALUE')
      expect(consumer).not.toContain("'__none__'")
    }
  })
})
