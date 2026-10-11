import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import ts from 'typescript'
import { waitForMarkdownModuleRequest } from './nomi-markdown-runtime-probe.mjs'

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

test('the shared Markdown lazy owner retains the existing local chunk failure domain for all consumers', () => {
  const source = fs.readFileSync(wrapper, 'utf8')
  assert.ok(source.includes("lazyWithChunkBoundary('Markdown'"), 'Optional Markdown rejection must stay local instead of replacing the workbench')
  assert.ok(!source.includes('React.lazy('), 'Consumers must not bypass the shared retry/error owner')
})

test('controlled Markdown runtime clears inherited outbound exceptions at the actual launch call', () => {
  const text = fs.readFileSync(path.join(root, 'tests/ux/nomi-markdown-runtime.e2e.mjs'), 'utf8')
  function assertClosedLaunch(source) {
    const tree = ts.createSourceFile('runtime.mjs', source, ts.ScriptTarget.Latest, true)
    let environment
    function visit(node) {
      if (ts.isCallExpression(node) && node.expression.getText(tree) === 'launchNomiApp') {
        const env = node.arguments[0].properties.find(property => property.name?.getText(tree) === 'env')
        environment = env.initializer.properties
      }
      ts.forEachChild(node, visit)
    }
    visit(tree)
    assert.ok(environment, 'Actual launch environment is missing')
    for (const [key, expected] of [['NOMI_WALK_ALLOW_ORIGINS', ''], ['NOMI_WALK_URL_REDIRECTS', '[]']]) {
      const property = environment.find(item => item.name?.getText(tree) === key)
      assert.ok(property && ts.isStringLiteral(property.initializer), `${key} must be explicitly closed at launch`)
      assert.equal(property.initializer.text, expected)
    }
  }
  assertClosedLaunch(text)
  for (const key of ['NOMI_WALK_ALLOW_ORIGINS', 'NOMI_WALK_URL_REDIRECTS']) {
    assert.throws(() => assertClosedLaunch(text.replace(new RegExp(`, ${key}: '[^']*'`), '')), /explicitly closed/)
  }
})

test('an absent real Markdown module request fails at a deadline instead of hanging its cell', async () => {
  await assert.rejects(waitForMarkdownModuleRequest(new Promise(() => {}), 10), /module request deadline/)
  assert.equal(await waitForMarkdownModuleRequest(Promise.resolve('actual route')), 'actual route')
  await assert.rejects(waitForMarkdownModuleRequest(Promise.reject(new Error('route failure'))), /route failure/)
  const source = fs.readFileSync(path.join(root, 'tests/ux/nomi-markdown-runtime.e2e.mjs'), 'utf8')
  assert.match(source, /await waitForMarkdownModuleRequest\(requested\)/)
  assert.doesNotMatch(source, /await requested\b/)
})
