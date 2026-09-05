#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const matrixPath = path.join(root, 'tests/ux/fixtures/storyboard-table-coverage-matrix.json')
const matrix = JSON.parse(fs.readFileSync(matrixPath, 'utf8'))
const statuses = new Set(['runtime-present-measured', 'runtime-present-unmeasured', 'missing-runtime-anchor', 'blocked'])
let failed = false
for (const [id, anchor] of Object.entries(matrix.anchors ?? {})) {
  if (!statuses.has(anchor.status)) { console.error(`invalid status: ${id}`); failed = true }
  if (anchor.source?.path && !fs.existsSync(path.join(root, anchor.source.path))) { console.error(`missing source: ${id} -> ${anchor.source.path}`); failed = true }
}
if (failed) process.exit(1)
const counts = Object.values(matrix.anchors).reduce((acc, item) => { acc[item.status] = (acc[item.status] ?? 0) + 1; return acc }, {})
console.log(`✅ storyboard table coverage inventory valid: ${Object.keys(matrix.anchors).length} anchors; ${JSON.stringify(counts)}`)
