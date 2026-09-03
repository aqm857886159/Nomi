import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { test } from 'node:test'

import { validateReportDirectory } from './check-competitive-research-report.mjs'

const execFileAsync = promisify(execFile)

async function makeReportFixture(options = {}) {
  const reportDir = await mkdtemp(path.join(os.tmpdir(), 'nomi-research-report-'))
  const assetsDir = path.join(reportDir, 'assets')
  if (options.assets !== false) await mkdir(assetsDir)

  const action = options.actionWithoutScreenshot
    ? 'Action: click the product tab without an evidence image.'
    : options.actionWithScreenshot
      ? 'Action: click the product tab.\n![Product tab](./assets/01-product-tab.png)\n\nResult: the tab opens.'
      : ''
  await writeFile(
    path.join(reportDir, 'README.md'),
    `# Example research report\n\n## Scope\nA source-only framework comparison.\n\n## Evidence\nThe repository README is documented evidence.\n\n${action}\n\n## Decision\nBorrow the interaction pattern and keep the existing renderer.\n\n## Source ledger\n- [Official repository](https://github.com/example/project)\n`,
  )

  if (options.source !== false) {
    await writeFile(
      path.join(reportDir, 'report-source.md'),
      '# Evidence ledger\n\n- documented: [Official repository](https://github.com/example/project)\n',
    )
  }

  if (options.mediaFile) await writeFile(path.join(assetsDir, options.mediaFile), '')
  return reportDir
}

test('accepts a complete report package', async () => {
  const report = await makeReportFixture()
  assert.deepEqual(validateReportDirectory(report), { ok: true, errors: [] })
})

test('rejects a package without the source ledger and assets directory', async () => {
  const report = await makeReportFixture({ source: false, assets: false })
  const result = validateReportDirectory(report)
  assert.equal(result.ok, false)
  assert.match(result.errors.join('\n'), /report-source\.md/)
  assert.match(result.errors.join('\n'), /assets/)
})

test('requires a screenshot for every browser action', async () => {
  const report = await makeReportFixture({ actionWithoutScreenshot: true })
  const result = validateReportDirectory(report)
  assert.equal(result.ok, false)
  assert.match(result.errors.join('\n'), /截图/)
})

test('accepts a browser action when the same paragraph includes a screenshot', async () => {
  const report = await makeReportFixture({ actionWithScreenshot: true })
  assert.deepEqual(validateReportDirectory(report), { ok: true, errors: [] })
})

test('rejects source video and audio files in a report package', async () => {
  const report = await makeReportFixture({ mediaFile: 'source.mp4' })
  const result = validateReportDirectory(report)
  assert.equal(result.ok, false)
  assert.match(result.errors.join('\n'), /源视频|源音频/)
})

test('CLI returns success for a valid report and failure for a missing directory', async () => {
  const report = await makeReportFixture()
  const script = path.resolve('scripts/check-competitive-research-report.mjs')
  const success = await execFileAsync(process.execPath, [script, '--report', report])
  assert.equal(success.code ?? 0, 0)

  await assert.rejects(
    execFileAsync(process.execPath, [script, '--report', path.join(report, 'missing')]),
    (error) => error.code === 1,
  )
})

test('the valid fixture contains the evidence shape used by the gate', async () => {
  const report = await makeReportFixture()
  const source = await readFile(path.join(report, 'report-source.md'), 'utf8')
  assert.match(source, /documented/)
  assert.match(source, /https:\/\//)
})
