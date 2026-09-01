import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

test('growth observatory runs SEO weekly and persists outside protected main', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/growth-observatory.yml'), 'utf8')
  assert.match(workflow, /schedule:/)
  assert.match(workflow, /cron: ['"]\d+ \d+ \* \* \*['"]/)
  assert.match(workflow, /workflow_dispatch:/)
  assert.match(workflow, /contents: write/)
  assert.match(workflow, /date -u \+%u/)
  assert.match(workflow, /scripts\/seo\/seo-audit\.mjs/)
  assert.match(workflow, /docs\/seo\/data|docs\/seo\/reports/)
  assert.match(workflow, /automation\/growth-data/)
  assert.doesNotMatch(workflow, /pull-requests: write/)
  assert.doesNotMatch(workflow, /create-pull-request/)
  assert.doesNotMatch(workflow, /force(?:-with-lease)?/)
  assert.doesNotMatch(workflow, /git push(?:\s+origin)?\s+(?:HEAD:)?main/)
  assert.doesNotMatch(workflow, /git add -A|git add \.\s*$/)
})
