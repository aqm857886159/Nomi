import assert from 'node:assert/strict'
import fs from 'node:fs'
import { describe, it } from 'vitest'
import { validateExternalApprovalSurface } from '../../scripts/productionTrajectoryContract.mjs'

function traceWithSurface(decisions) {
  return {
    client: { name: 'OpenAI Codex', originHost: 'codex' },
    project: { projectId: 'project-1', runId: 'run-1' },
    decisions,
    calls: decisions.map((decision, index) => ({
      callId: `c${index + 1}`,
      tool: decision.kind === 'artifact-review' ? 'nomi_review_artifact' : 'nomi_decide_gate',
      humanDecision: {
        actorRole: decision.actorRole,
        inputSource: decision.inputSource,
        control: decision.control,
      },
    })),
  }
}

describe('external-agent-only approval surface', () => {
  it('rejects normal production approvals recorded as desktop clicks', () => {
    const errors = validateExternalApprovalSurface(traceWithSurface([
      { actorRole: 'human-simulator', inputSource: 'desktop-click', control: 'approve-script', kind: 'artifact-review' },
      { actorRole: 'human-simulator', inputSource: 'desktop-click', control: 'shot-1-approve', kind: 'gate' },
      { actorRole: 'human-simulator', inputSource: 'desktop-click', control: 'export-approve', kind: 'gate' },
    ]))
    assert.equal(errors.length, 3)
    assert.ok(errors.every((error) => /external-agent run|desktop-click/.test(error)))
  })

  it('allows MCP decisions and explicit takeover/recovery clicks', () => {
    const errors = validateExternalApprovalSurface(traceWithSurface([
      { actorRole: 'human-simulator', inputSource: 'mcp-elicitation', control: 'approve-script', kind: 'artifact-review' },
      { actorRole: 'human-simulator', inputSource: 'mcp-elicitation', control: 'reconcile-found', kind: 'recovery' },
      { actorRole: 'human-simulator', inputSource: 'desktop-click', control: 'takeover-run', kind: 'takeover' },
    ]))
    assert.deepEqual(errors, [])
  })

  it('keeps the real media harness on MCP for normal approvals', () => {
    const source = fs.readFileSync(new URL('../../scripts/real-mcp-review-only.mjs', import.meta.url), 'utf8')
    assert.doesNotMatch(source, /guiApprove\(/)
    assert.match(source, /nomi_decide_gate/)
    assert.match(source, /nomi_approve_rough_cut/)
    assert.match(source, /nomi_reconcile_job/)
    assert.match(source, /approveGateViaMcp\('contract-approve'/)
    assert.match(source, /surface: 'mcp-elicitation'/)
  })
})
