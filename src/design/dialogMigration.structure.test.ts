import fs from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const migrations = [
  ['src/workbench/settings/SettingsDialog.tsx', null],
  ['src/workbench/skillLibrary/SkillDetail.tsx', 'data-skill-detail-add-to-chat'],
  ['src/ui/browser/prompt/BrowserPromptExtractionSettingsModal.tsx', 'primaryLabel'],
  ['src/workbench/onboarding/HandbookPanel.tsx', null],
  ['src/workbench/timeline/TimelineShortcutsDialog.tsx', null],
  ['src/ui/app-shell/UpdateDialog.tsx', 'onRetry'],
  ['src/workbench/generationCanvas/components/SelectionPromptSaveController.tsx', 'saveDraft'],
] as const

describe('阶段②：弹窗高度与决定栏只有一个 owner', () => {
  for (const [file, decision] of migrations) {
    it(`${file} 只用外壳，决定栏不在 children 中`, () => {
      const source = fs.readFileSync(file, 'utf8')
      const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
      const modals: ts.JsxElement[] = []
      const visit = (node: ts.Node): void => {
        if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === 'DesignModal') modals.push(node)
        ts.forEachChild(node, visit)
      }
      visit(ast)
      expect(modals).toHaveLength(1)
      expect(source).not.toMatch(/<Portal|fixed inset|(?:100(?:s|d)?vh|40vh)/)
      if (!file.includes('SelectionPrompt')) expect(source).not.toContain('createPortal')
      if (decision) {
        const actions = modals[0].openingElement.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText(ast) === 'actions')
        expect(actions?.getText(ast)).toContain(decision)
        expect(modals[0].children.map(child => child.getText(ast)).join('')).not.toContain(decision)
      } else if (file.includes('settings/SettingsDialog')) {
        expect(source).toContain('closeOnEscape={false}')
        expect(source).toContain('getSettingsEscapeOwnership(dialog, event.target)')
        expect(source).toContain("[data-model-settings-page]:not([data-model-settings-page=\"home\"])")
      }
    })
  }
  it('多镜清单不再叠一层 viewport 滚动区', () => {
    const source = fs.readFileSync('src/workbench/generationCanvas/spend/MultiShotContractSummary.tsx', 'utf8')
    expect(source).not.toMatch(/max-h-\[40vh\]|overflow-y-auto/)
  })
})
