import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'
import { FULL_WALK_JOURNEYS, CLICK_TARGETS } from '../tests/ux/full-walk/catalog.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export function buildControlInventory(root = repoRoot) {
  const files = []
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) { if (!['devlab', '__tests__', '__fixtures__'].includes(entry.name)) walk(file) }
      else if (/\.tsx$/.test(file) && !/\.test\./.test(file)) files.push(file)
    }
  }
  walk(path.join(root, 'src'))
  const bindings = []
  for (const file of files.sort()) {
    const source = path.relative(root, file), text = fs.readFileSync(file, 'utf8')
    const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const conditions = (node) => {
      const values = []
      for (let parent = node.parent; parent && !ts.isSourceFile(parent); parent = parent.parent) {
        if (ts.isConditionalExpression(parent)) values.push(parent.condition.getText(ast))
        if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) values.push(parent.left.getText(ast).slice(0, 180))
      }
      return values
    }
    const visit = (node) => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const attributes = node.attributes.properties.filter(ts.isJsxAttribute)
        const handlers = attributes.map((attribute) => attribute.name.getText(ast)).filter((name) => /^on(?:Click|DoubleClick|ContextMenu|Change|Submit|KeyDown|PointerDown|MouseDown|Wheel|Drop|DragStart|Select)$/.test(name))
        if (handlers.length) {
          const selectors = Object.fromEntries(attributes.filter((attribute) => /^(?:data-|aria-|role$|type$|name$)/.test(attribute.name.getText(ast))).map((attribute) => [attribute.name.getText(ast), attribute.initializer?.getText(ast) ?? 'true']))
          const line = ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1
          bindings.push({ id: `${source}:${line}`, source, line, tag: node.tagName.getText(ast), handlers, selectors, conditions: conditions(node), sourceSha256: createHash('sha256').update(node.getText(ast)).digest('hex'), runtimeStatus: 'planned' })
        }
      }
      if (ts.isObjectLiteralExpression(node)) {
        const properties = node.properties.filter(ts.isPropertyAssignment)
        const handlers = properties.map((property) => property.name.getText(ast)).filter((name) => name === 'onSelect')
        if (handlers.length) {
          const line = ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1
          bindings.push({ id: `${source}:${line}:menu`, source, line, tag: 'menu-action-definition', handlers, selectors: Object.fromEntries(properties.filter((property) => ['id', 'label', 'disabled'].includes(property.name.getText(ast))).map((property) => [property.name.getText(ast), property.initializer.getText(ast).slice(0, 240)])), conditions: conditions(node), sourceSha256: createHash('sha256').update(node.getText(ast)).digest('hex'), runtimeStatus: 'planned' })
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(ast)
  }
  const reconcile = (id, owner, action) => {
    const source = owner?.split('#')[0]
    const matching = bindings.filter((binding) => binding.source === source).map((binding) => binding.id)
    return { id, action, owner, controlBindings: matching, mapping: matching.length ? 'owner-source candidates; exact target runtime reconciliation pending' : 'gap: owner is logic/non-JSX or no matching binding', executed: false }
  }
  const existingWalkActions = FULL_WALK_JOURNEYS.flatMap((journey) => journey.states.flatMap((state) => state.actions.map((action, index) => reconcile(`${journey.id}/${state.id}/${index}`, state.owner, action))))
  const clickTargets = CLICK_TARGETS.map((target) => reconcile(target.id, target.owner, target.target))
  return { schemaVersion: 1, coverageUnit: 'source handler bindings and menu action definitions, including conditional/dynamic controls; not runtime control counts or execution', sourceFiles: files.length, bindings, existingWalkActions, clickTargets,
    limitations: ['Dynamic lists/menus and capability-dependent controls need runtime expansion; a source binding is not every rendered control instance.', 'Owner-source matches are candidates, not exact action coverage. Empty mappings are visible gaps; none is marked executed.', 'Performance family inventory remains a separate, smaller grouping. All source bindings remain runtime planned.'] }
}
function main() {
  const output = path.join(repoRoot, 'docs/evidence/2026-10-10-nomi-user-performance/control-inventory.json')
  const data = JSON.stringify(buildControlInventory(), null, 2) + '\n'
  if (process.argv.includes('--check')) {
    if (!fs.existsSync(output) || fs.readFileSync(output, 'utf8') !== data) throw new Error('Control inventory drift: regenerate from the real production AST and reconcile family entries')
  } else fs.writeFileSync(output, data)
  console.log(JSON.stringify({ output, bindingCount: JSON.parse(data).bindings.length, mode: process.argv.includes('--check') ? 'check' : 'generate' }))
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main()
