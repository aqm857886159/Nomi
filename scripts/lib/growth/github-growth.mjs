const API_ROOT = 'https://api.github.com'

const requestHeaders = (token) => {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'nomi-growth-observatory',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

async function requestJson(pathname, { fetchImpl, token }) {
  const response = await fetchImpl(`${API_ROOT}${pathname}`, { headers: requestHeaders(token) })
  if (!response.ok) {
    const body = await response.text()
    const error = new Error(`GitHub API ${response.status}: ${body.slice(0, 200)}`)
    error.status = response.status
    throw error
  }
  return response.json()
}

const trafficUnavailable = (error) => ({
  status: 'unavailable',
  reason: error?.status ? `github_api_${error.status}` : 'request_failed',
})

export async function collectGithubGrowth({
  repo,
  fetchImpl = globalThis.fetch,
  token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN,
  observedAt = new Date().toISOString(),
} = {}) {
  if (!repo) throw new Error('A GitHub owner/repository is required')
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required')

  const repository = await requestJson(`/repos/${repo}`, { fetchImpl, token })
  const trafficRequests = [
    requestJson(`/repos/${repo}/traffic/views`, { fetchImpl, token }),
    requestJson(`/repos/${repo}/traffic/clones`, { fetchImpl, token }),
    requestJson(`/repos/${repo}/traffic/popular/referrers`, { fetchImpl, token }),
    requestJson(`/repos/${repo}/traffic/popular/paths`, { fetchImpl, token }),
  ]
  const trafficResults = await Promise.allSettled(trafficRequests)
  const rejected = trafficResults.find((result) => result.status === 'rejected')
  const traffic = rejected
    ? trafficUnavailable(rejected.reason)
    : {
        status: 'ok',
        windowDays: 14,
        views: {
          count: trafficResults[0].value.count,
          uniques: trafficResults[0].value.uniques,
        },
        clones: {
          count: trafficResults[1].value.count,
          uniques: trafficResults[1].value.uniques,
        },
        referrers: trafficResults[2].value.slice(0, 10),
        paths: trafficResults[3].value.slice(0, 10),
      }

  return {
    observedAt,
    repository: {
      stars: repository.stargazers_count,
      forks: repository.forks_count,
      watchers: repository.subscribers_count,
      openIssues: repository.open_issues_count,
    },
    traffic,
  }
}

export function upsertSnapshot(history, snapshot) {
  const snapshots = Array.isArray(history?.snapshots) ? history.snapshots : []
  return {
    schemaVersion: 1,
    snapshots: [...snapshots.filter((item) => item.date !== snapshot.date), snapshot]
      .sort((left, right) => left.date.localeCompare(right.date)),
  }
}
