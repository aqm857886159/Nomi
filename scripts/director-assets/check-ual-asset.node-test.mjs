import test from 'node:test'
import assert from 'node:assert/strict'
import { checkUalAsset } from './check-ual-asset.mjs'

test('UAL native GLB has all 45 actions and semantic bones', () => {
  const result = checkUalAsset()
  assert.equal(result.pass, true)
  assert.equal(result.missingBones.length, 0)
  assert.equal(result.missingActions.length, 0)
  assert.equal(result.animationCount, 45)
})
