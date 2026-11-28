import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { MEDIA_ASSET_SIZES } from '../../worker/mediaAssetSizes.ts'

// How nomiaqm.com serves marketing/ is decided by three artifacts synced at build/deploy time:
// wrangler.json (which requests reach the site worker first), marketing/_headers, and
// worker/mediaAssetSizes.ts (静态媒体字节清单，彻底消除运行时读流计数).
// _headers patterns are Cloudflare globs: `*` is `.*`, anchored at both ends
// (workers-shared asset-worker/src/utils/rules-engine.ts, generateGlobOnlyRuleRegExp).

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const siteDir = path.join(root, 'marketing')
const config = JSON.parse(readFileSync(path.join(root, 'wrangler.json'), 'utf8'))

// Browsers seek audio/video with Range requests; Safari and every iOS browser refuse to
// play media from a server that ignores them, and Cloudflare's asset server does.
const MEDIA_EXTENSIONS = new Set(['.mp4', '.m4v', '.mov', '.webm', '.ogv', '.mp3', '.m4a', '.aac', '.wav', '.ogg', '.oga', '.flac'])

function glob(pattern) {
  const source = pattern.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')
  return new RegExp(`^${source}$`)
}

function servedPaths(dir = siteDir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return servedPaths(full)
    if (entry.name.startsWith('_')) return [] // _headers / _redirects are config, not served
    return ['/' + path.relative(siteDir, full).split(path.sep).join('/')]
  })
}

// Mirrors attachCustomHeaders: rules apply in file order; within a rule `! Name` unsets first,
// then each set replaces a default but appends when an earlier rule already set that header.
function parseHeaderRules(text) {
  const rules = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue
    if (!/^\s/.test(line)) {
      rules.push({ pattern: line.trim(), set: [], unset: [] })
      continue
    }
    const rule = rules.at(-1)
    const entry = line.trim()
    if (entry.startsWith('!')) rule.unset.push(entry.slice(1).trim().toLowerCase())
    else {
      const colon = entry.indexOf(':')
      rule.set.push([entry.slice(0, colon).trim().toLowerCase(), entry.slice(colon + 1).trim()])
    }
  }
  return rules
}

function customHeaders(rules, pathname) {
  const headers = new Map()
  const setByRules = new Set()
  for (const rule of rules.filter((candidate) => glob(candidate.pattern).test(pathname))) {
    for (const name of rule.unset) headers.delete(name)
    for (const [name, value] of rule.set) {
      if (setByRules.has(name)) headers.set(name, [...(headers.get(name) ?? []), value])
      else {
        headers.set(name, [value])
        setByRules.add(name)
      }
    }
  }
  return headers
}

const paths = servedPaths()
const mediaPaths = paths.filter((pathname) => MEDIA_EXTENSIONS.has(path.extname(pathname).toLowerCase())).sort()
const headerRules = parseHeaderRules(readFileSync(path.join(siteDir, '_headers'), 'utf8'))

describe('marketing site serving contract', () => {
  it('routes the site worker through a declared ASSETS binding', () => {
    expect(config.main).toBe('./worker/index.ts')
    expect(config.assets.directory).toBe('./marketing')
    expect(config.assets.binding).toBe('ASSETS')
  })

  it('sends every media type through the site worker so Range requests get 206, and nothing else', () => {
    // Worker-first routes are only `/*.<ext>` for media extensions, so pages and images stay
    // on the direct asset path, and a new media type fails here until it is routed.
    const mediaExtensions = [...new Set(mediaPaths.map((pathname) => path.extname(pathname).toLowerCase()))]
    expect(mediaExtensions).toContain('.mp4')
    expect([...config.assets.run_worker_first].sort()).toEqual(mediaExtensions.map((extension) => `/*${extension}`).sort())
  })

  it('gives every served file at most one Cache-Control value and gives every media file a positive max-age for edge caching', () => {
    const conflicting = paths
      .map((pathname) => [pathname, customHeaders(headerRules, pathname).get('cache-control') ?? []])
      .filter(([, values]) => values.length > 1)
    expect(conflicting).toEqual([])
    expect(customHeaders(headerRules, '/assets/video/nomi-0.22-film.mp4').get('cache-control'))
      .toEqual(['public, max-age=3600, must-revalidate'])
    expect(customHeaders(headerRules, '/assets/promo-0.22/cover-zh-light.jpg').get('cache-control'))
      .toEqual(['public, max-age=31536000, immutable'])

    for (const mediaPath of mediaPaths) {
      const cc = customHeaders(headerRules, mediaPath).get('cache-control') ?? []
      expect(cc, `${mediaPath} needs a single cacheable Cache-Control header for caches.default`).toHaveLength(1)
      expect(cc[0], mediaPath).toMatch(/\bmax-age=[1-9]\d*/)
    }
  })

  it('census: keeps MEDIA_ASSET_SIZES 100% aligned with the exact stat.size of every media file under marketing/', () => {
    const actualSizes = Object.fromEntries(
      mediaPaths.map((pathname) => [pathname, statSync(path.join(siteDir, pathname.slice(1))).size]),
    )
    expect(Object.keys(actualSizes).length).toBeGreaterThan(0)
    expect(MEDIA_ASSET_SIZES).toEqual(actualSizes)
  })
})
