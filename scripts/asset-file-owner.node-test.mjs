import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ESLint } from 'eslint'
const eslint = new ESLint()
const rule = 'asset-file-owner/no-restricted-syntax'
for (const code of [
  'bridge.workspace.deleteFiles(payload)',
  'const trash = bridge.workspace.deleteFiles; trash(payload)',
  'const { deleteFiles: trash } = bridge.workspace; trash(payload)',
  "const trash = bridge.workspace['deleteFiles']; trash(payload)",
]) {
  test(`non-owner bridge access fails: ${code}`, async () => {
    const [result] = await eslint.lintText(code, { filePath: 'src/workbench/assets/invalidDeletionProbe.ts' })
    assert.ok(result.messages.some(message => message.ruleId === rule && message.severity === 2))
  })
}
test('the single physical trash owner is allowed', async () => {
  const [result] = await eslint.lintText('bridge.workspace.deleteFiles(payload)', { filePath: 'src/workbench/assets/assetFileDeletion.ts' })
  assert.equal(result.messages.filter(message => message.ruleId === rule).length, 0)
})

for (const code of [
  "import { trashProjectFiles } from './assetFileDeletion'; trashProjectFiles('p', [])",
  "import * as files from './assetFileDeletion'; files.trashProjectFiles('p', [])",
]) {
  test(`non-domain physical trash import fails: ${code}`, async () => {
    const [result] = await eslint.lintText(code, { filePath: 'src/workbench/assets/invalidDeletionProbe.ts' })
    assert.ok(result.messages.some(message => message.ruleId === 'asset-command-owner/no-restricted-imports' && message.severity === 2))
  })
}
