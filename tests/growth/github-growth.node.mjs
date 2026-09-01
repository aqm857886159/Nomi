import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { collectGithubGrowth, upsertSnapshot } from '../../scripts/lib/growth/github-growth.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const response = (body, status = 200) => ({
  ok: status >= 200 && status < 400,
  status,
  async json() { return body },
  async text() { return typeof body === 'string' ? body : JSON.stringify(body) },
})

const repository = {
  stargazers_count: 475,
  forks_count: 100,
  subscribers_count: 2,
  open_issues_count: 12,
}

test('collectGithubGrowth records repository and traffic metrics', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('/traffic/views')) return response({ count: 2926, uniques: 607 })
    if (url.endsWith('/traffic/clones')) return response({ count: 5988, uniques: 675 })
    if (url.endsWith('/traffic/popular/referrers')) return response([{ referrer: 'Google', count: 93, uniques: 34 }])
    if (url.endsWith('/traffic/popular/paths')) return response([{ path: '/owner/repo', count: 1481, uniques: 509 }])
    return response(repository)
  }

  const result = await collectGithubGrowth({ repo: 'owner/repo', fetchImpl, token: 'test-token' })
  assert.deepEqual(result.repository, { stars: 475, forks: 100, watchers: 2, openIssues: 12 })
  assert.equal(result.traffic.status, 'ok')
  assert.equal(result.traffic.views.uniques, 607)
  assert.equal(result.traffic.referrers[0].referrer, 'Google')
})

test('collectGithubGrowth marks restricted traffic unavailable instead of reporting zero', async () => {
  const fetchImpl = async (url) => url.endsWith('/repos/owner/repo')
    ? response(repository)
    : response({ message: 'Resource not accessible by integration' }, 403)

  const result = await collectGithubGrowth({ repo: 'owner/repo', fetchImpl })
  assert.deepEqual(result.traffic, { status: 'unavailable', reason: 'github_api_403' })
})

test('upsertSnapshot replaces the same date and preserves chronological order', () => {
  const history = { schemaVersion: 1, snapshots: [{ date: '2026-09-01', repository: { stars: 470 } }] }
  const result = upsertSnapshot(history, { date: '2026-09-01', repository: { stars: 475 } })
  const withNextDay = upsertSnapshot(result, { date: '2026-09-02', repository: { stars: 480 } })
  assert.equal(withNextDay.snapshots.length, 2)
  assert.equal(withNextDay.snapshots[0].repository.stars, 475)
  assert.equal(withNextDay.snapshots[1].date, '2026-09-02')
})

test('growth workflow persists with a normal push to the dedicated data branch', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/growth-observatory.yml'), 'utf8')
  assert.match(workflow, /git push --set-upstream origin automation\/growth-data/)
  assert.match(workflow, /if: always\(\) && steps\.branch\.outcome == 'success'/)
  assert.match(workflow, /Preserve collector failure status/)
  assert.doesNotMatch(workflow, /force(?:-with-lease)?/)
  assert.doesNotMatch(workflow, /git push(?:\s+origin)?\s+(?:HEAD:)?main/)
})
