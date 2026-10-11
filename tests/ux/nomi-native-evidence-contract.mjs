import assert from 'node:assert/strict'
import fs from 'node:fs'

// A native functional receipt requires actual runtime finalization, every
// launched process's offline guard and the declared bounded request cost.
export function validateNativeWalkEvidence(report, logPath, expectedTextRequests) {
  const bytes = fs.readFileSync(logPath, 'utf8').trim()
  assert.ok(bytes, 'Native guard receipt cannot be empty')
  const events = bytes.split('\n').map((line) => JSON.parse(line))
  assert.ok(events.every((event) => event && typeof event === 'object'), 'Native guard records must be objects')
  assert.ok(Array.isArray(report.launches) && report.launches.length > 0, 'Actual native launches are required')
  const launchPids = report.launches.map(({ pid }) => pid)
  assert.ok(launchPids.every((pid) => Number.isInteger(pid) && pid > 0))
  assert.equal(new Set(launchPids).size, launchPids.length, 'Each launch must identify its distinct actual process')
  const loaded = events.filter((event) => event.kind === 'guard-loaded')
  const guard = { loaded: loaded.map((event) => event.layers), verifiedLaunchPids: launchPids, blockedAttempts: events.filter((event) => event.kind === 'blocked').length, errors: events.filter((event) => event.kind === 'guard-error') }
  try {
    assert.equal(loaded.length, launchPids.length, 'Guard evidence must cover every actual launch exactly once')
    for (const pid of launchPids) {
      const matches = loaded.filter((event) => event.pid === pid)
      assert.equal(matches.length, 1, 'Duplicate/unrelated PID cannot replace a launched process guard')
      assert.ok(Array.isArray(matches[0].layers) && ['fetch', 'http', 'https', 'socket', 'chromium'].every((layer) => matches[0].layers.includes(layer)))
    }
    assert.equal(guard.blockedAttempts, 0)
    assert.equal(guard.errors.length, 0)
    assert.equal(report.result, 'passed', 'Native runtime cleanup/collection must have passed')
    assert.ok(!report.error, 'A runtime failure cannot certify the walk')
    assert.ok(Number.isInteger(expectedTextRequests) && expectedTextRequests >= 0)
    assert.equal(report.textRequests, expectedTextRequests, 'Native walk must match its declared text requests')
    assert.equal(report.imageRequests, 0, 'Native text-only walk cannot generate images')
    assert.equal(report.paidCalls, 0, 'Native offline walk cannot incur paid calls')
    assert.ok(Array.isArray(report.unexpected) && report.unexpected.length === 0)
  } catch (error) { error.guard = guard; throw error }
  return guard
}

export function assertNativeProjectIsolation(bytes, ownPrefix, otherPrefix) {
  assert.equal(typeof bytes, 'string')
  assert.ok(typeof ownPrefix === 'string' && ownPrefix && typeof otherPrefix === 'string' && otherPrefix && ownPrefix !== otherPrefix)
  assert.ok(bytes.includes(`${ownPrefix}PROMPT`) && bytes.includes(`${ownPrefix}DONE`))
  assert.equal(bytes.includes(otherPrefix), false, 'Every original transcript record must exclude the other project marker family')
}
