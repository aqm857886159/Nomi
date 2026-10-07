import assert from 'node:assert/strict'
import test from 'node:test'
import { compareWorkflowRef } from './verify-workflow-ref.mjs'

test('matching ref and workflow commit pass', () => {
  assert.deepEqual(
    compareWorkflowRef({
      ref: 'release/0.24',
      resolvedSha: 'abc123',
      workflowSha: 'abc123',
      triggerRef: 'refs/heads/release/0.24',
      triggerEvent: 'workflow_dispatch',
    }),
    { ref: 'release/0.24', sha: 'abc123' },
  )
})

test('mismatched ref and workflow commit fail with both SHAs and trigger context', () => {
  assert.throws(
    () =>
      compareWorkflowRef({
        ref: 'release/0.24',
        resolvedSha: 'release-sha',
        workflowSha: 'trigger-sha',
        triggerRef: 'refs/heads/main',
        triggerEvent: 'workflow_dispatch',
      }),
    (error) => {
      assert.match(error.message, /release-sha/)
      assert.match(error.message, /trigger-sha/)
      assert.match(error.message, /refs\/heads\/main/)
      assert.match(error.message, /inputs\.ref/)
      return true
    },
  )
})
