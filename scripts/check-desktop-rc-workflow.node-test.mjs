import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workflow = load(fs.readFileSync(path.join(repoRoot, '.github/workflows/desktop-rc.yml'), 'utf8'))

test('desktop RC collects every release-critical journey before deciding', () => {
  const steps = workflow.jobs.validate.steps
  const names = [
    'Clip editing journey',
    'Production MCP journey',
    'MCP journey suite',
    'MCP elicitation journey',
    'Canvas performance RC journey',
  ]
  for (const name of names) {
    const step = steps.find((candidate) => candidate.name === name)
    assert.ok(step, `${name} must remain in the RC workflow`)
    assert.equal(step['continue-on-error'], true, `${name} must not hide later release-critical failures`)
    assert.equal(step['timeout-minutes'], 20, `${name} needs a bounded timeout so a hang cannot hide later evidence`)
    assert.ok(step.id, `${name} needs an id for the final outcome summary`)
    assert.equal(typeof step.run, 'string')
  }

  const summary = steps.find((step) => step.name === 'Release-critical journey summary')
  assert.ok(summary)
  assert.equal(summary.if, 'always()')
  assert.equal(summary.run, 'node scripts/summarize-e2e-chain.mjs')
  assert.equal(summary['continue-on-error'], undefined)
  assert.match(summary.env.CHAIN, /clip:\$\{\{ steps\.clip\.outcome \}\}/)
  assert.match(summary.env.CHAIN, /canvas-performance:\$\{\{ steps\.canvas-performance\.outcome \}\}/)

  const upload = steps.find((step) => step.name === 'Upload release-critical evidence')
  assert.ok(upload)
  assert.equal(upload.if, 'always()')
  assert.equal(upload.uses, 'actions/upload-artifact@v4')
})

test('desktop RC rejects a checkout ref that differs from the triggering commit before validation', () => {
  const steps = workflow.jobs.validate.steps
  const guardIndex = steps.findIndex((step) => step.name === 'Verify workflow ref matches dispatched commit')
  assert.equal(guardIndex, 1, 'the ref guard must be the first step after checkout')
  const guard = steps[guardIndex]
  assert.equal(guard.run, 'node scripts/verify-workflow-ref.mjs')
  assert.equal(guard.env.WORKFLOW_REF, '${{ inputs.ref }}')
  assert.equal(guard.env.WORKFLOW_SHA, '${{ github.sha }}')
  assert.equal(guard.env.TRIGGER_REF, '${{ github.ref }}')
  assert.equal(guard.env.TRIGGER_EVENT, '${{ github.event_name }}')
})

test('desktop RC audits every packaged platform against its budget before uploading the candidate', () => {
  // docs/plan/2026-09-28-release-audit.md §3 A：包体审计是候选包能不能出门的判据之一。
  // 它红了必须让作业红（不许 continue-on-error），报告无论红绿都要上传，审计必须排在候选包上传之前。
  const expectations = {
    windows: { upload: 'rc-windows', reports: ['release/package-audit-win32-x64.json'], packaged: ['release/win-unpacked --installer release/Nomi-win-x64.exe'] },
    macos: {
      upload: 'rc-macos',
      reports: ['release/package-audit-darwin-arm64.json', 'release/package-audit-darwin-x64.json'],
      packaged: [
        'release/mac-arm64/Nomi.app --installer release/Nomi-mac-arm64.dmg --installer release/Nomi-mac-arm64.zip',
        'release/mac/Nomi.app --installer release/Nomi-mac-x64.dmg --installer release/Nomi-mac-x64.zip',
      ],
    },
  }
  for (const [jobName, expected] of Object.entries(expectations)) {
    const steps = workflow.jobs[jobName].steps
    const auditIndex = steps.findIndex((step) => typeof step.run === 'string' && step.run.includes('node scripts/audit-package.mjs'))
    assert.ok(auditIndex >= 0, `${jobName} must run scripts/audit-package.mjs`)
    const audit = steps[auditIndex]
    assert.equal(audit['continue-on-error'], undefined, `${jobName}: an over-budget package must fail the job`)
    assert.equal(audit.if, undefined, `${jobName}: the audit must run on every candidate`)
    for (const target of expected.packaged) assert.ok(audit.run.includes(`node scripts/audit-package.mjs ${target}`), `${jobName} audits ${target}`)
    for (const report of expected.reports) assert.ok(audit.run.includes(`--report ${report}`), `${jobName} writes ${report}`)
    const reportUpload = steps.find((step) => step.uses === 'actions/upload-artifact@v4' && step.with?.path === 'release/package-audit-*.json')
    assert.ok(reportUpload, `${jobName} uploads the audit report`)
    assert.equal(reportUpload.if, 'always()', `${jobName}: the report must be uploaded even when the audit fails`)
    const candidateIndex = steps.findIndex((step) => step.uses === 'actions/upload-artifact@v4' && step.with?.name === expected.upload)
    assert.ok(candidateIndex > auditIndex, `${jobName}: the candidate is uploaded only after the audit passed`)
    // ffmpeg/ffprobe 平台目标检查已并进包体审计，不许再留一个并行的入口。
    assert.ok(!steps.some((step) => typeof step.run === 'string' && step.run.includes('audit-packaged-media.cjs')), `${jobName}: media target check lives inside audit-package`)
  }
})
