import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import ts from 'typescript'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const owner = path.join(root, 'src/workbench/common/NomiMarkdown.tsx')
const wrapper = path.join(root, 'src/workbench/common/LazyNomiMarkdown.tsx')
const edges = new Map()
function staticImports(file) {
  if (edges.has(file)) return edges.get(file)
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  const dependencies = []
  for (const node of source.statements) {
    if (!(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) || node.isTypeOnly || node.importClause?.isTypeOnly || !node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) continue
    const resolved = ts.resolveModuleName(node.moduleSpecifier.text, file, { moduleResolution: ts.ModuleResolutionKind.Bundler, allowJs: true }, ts.sys).resolvedModule?.resolvedFileName
    if (resolved?.startsWith(path.join(root, 'src/')) && /\.(?:ts|tsx|js|jsx)$/.test(resolved)) dependencies.push(resolved)
  }
  edges.set(file, dependencies)
  return dependencies
}
function eagerPath(entry, target) {
  const queue = [[entry]], seen = new Set()
  while (queue.length) {
    const chain = queue.shift(), file = chain.at(-1)
    if (file === target) return chain.map((item) => path.relative(root, item))
    if (seen.has(file)) continue
    seen.add(file)
    for (const next of staticImports(file)) queue.push([...chain, next])
  }
  return null
}

for (const entry of ['src/workbench/WorkbenchShell.tsx', 'src/workbench/skillLibrary/SkillDetail.tsx', 'src/workbench/promptLibrary/PromptPreviewOverlay.tsx', 'src/workbench/generationCanvas/nodes/artifact/ArtifactBody.tsx']) {
  test(`project-open static graph excludes optional Markdown owner: ${entry}`, () => {
    assert.equal(eagerPath(path.join(root, entry), owner), null, 'Eager import path to heavy Markdown owner')
    assert.ok(eagerPath(path.join(root, entry), wrapper), 'Positive control: real consumers still reach the common lazy boundary')
  })
}

test('graph distinguishes a real owner from its dynamic lazy boundary and type-only contract', () => {
  assert.equal(eagerPath(wrapper, owner), null)
  assert.deepEqual(eagerPath(owner, owner), ['src/workbench/common/NomiMarkdown.tsx'])
  assert.ok(staticImports(owner).length, 'The real rendering owner has static production dependencies')
})
