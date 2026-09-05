import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const sourceRoot = path.join(root, 'src', 'workbench')
const forbidden = [
  /\bstoryboardPlans\b/,
  /(?:^|[.{])\s*storyboardPlan\s*:/,
  /(?:^|[.{])\s*storyboardPlanCommitted\s*:/,
]
const files = []
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(file)
    else if (/\.(?:ts|tsx)$/.test(entry.name)) files.push(file)
  }
}
walk(sourceRoot)
const violations = []
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8')
  for (const pattern of forbidden) {
    if (pattern.test(source)) violations.push(`${path.relative(root, file)} matches ${pattern}`)
  }
}
if (violations.length) {
  console.error('❌ storyboard owner gate: retired projection names found')
  for (const violation of violations) console.error(`  - ${violation}`)
  process.exit(1)
}
console.log(`✅ storyboard owner gate: ${files.length} renderer files checked; owner is storyboardDesignsByDocumentId`)
