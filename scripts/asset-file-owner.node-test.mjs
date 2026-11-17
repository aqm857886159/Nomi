import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ESLint } from 'eslint'
import fs from 'node:fs'
import path from 'node:path'
const eslint = new ESLint()
const rule = 'asset-file-owner/no-restricted-syntax'
for (const method of ['deleteFiles', 'deleteAssets']) for (const code of [
  `bridge.workspace.${method}(payload)`,
  `const trash = bridge.workspace.${method}; trash(payload)`,
  `const { ${method}: trash } = bridge.workspace; trash(payload)`,
  `const trash = bridge.workspace['${method}']; trash(payload)`,
]) {
  test(`non-owner bridge access fails: ${code}`, async () => {
    const [result] = await eslint.lintText(code, { filePath: 'src/workbench/assets/invalidDeletionProbe.ts' })
    assert.ok(result.messages.some(message => message.ruleId === rule && message.severity === 2))
  })
}
test('the real deletion owner is allowed', async () => {
  const [result] = await eslint.lintFiles(['src/workbench/assets/assetFileDeletion.ts'])
  assert.equal(result.errorCount, 0)
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

for (const code of [
  "getDesktopBridge().workspace.deleteAssets({ projectId: 'p', relativePaths: ['assets/a.png'] })",
  "import { handleCapabilityApply } from '../../capability/capabilityApplyHandler'; handleCapabilityApply('assets.delete-files', payload)",
  "import { useBrowserAssetActions } from '../../../../ui/browser/popover/useBrowserAssetActions'; useBrowserAssetActions(payload)",
  "await import('../../capability/capabilityApplyHandler')",
  "import { handleCapabilityApply as apply } from '../capability/capabilityApplyHandler.js'; apply('assets.delete-files', payload)",
  "await import('../capability/capabilityApplyHandler.ts')",
  "export * from '../../../../ui/browser/popover/useBrowserAssetActions'",
]) {
  for (const filePath of [
    'src/workbench/generationCanvas/nodes/versionCards/NodeVersionCardsHost.tsx',
    'src/workbench/assets/removeAssetVersion.ts',
    'src/workbench/assets/assetResultMutation.ts',
  ]) test(`version removal cannot recycle (${filePath}): ${code}`, async () => {
    const [result] = await eslint.lintText(code, { filePath })
    assert.ok(result.messages.some(message => message.severity === 2 && [rule, 'asset-version-only/no-restricted-syntax'].includes(message.ruleId)))
  })
}

// Scan the real version surface too: a new version-card module inherits the same boundary.
test('all real version-card modules obey the deletion boundary', async () => {
  const repoRoot = path.resolve(import.meta.dirname, '..')
  const directory = path.join(repoRoot, 'src/workbench/generationCanvas/nodes/versionCards')
  const files = fs.readdirSync(directory, { recursive: true })
    .filter(name => /\.tsx?$/.test(name) && !/\.test\./.test(name))
    .map(name => path.join(directory, name))
  assert.ok(files.length > 0)
  const results = await eslint.lintFiles(files)
  assert.deepEqual(results.flatMap(result => result.messages.filter(message =>
    message.severity === 2 && /^(asset-file-owner|asset-command-owner|asset-version-only)\//.test(message.ruleId || ''),
  ).map(message => `${result.filePath}: ${message.message}`)), [])
})
