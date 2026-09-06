import assert from 'node:assert/strict'
import test from 'node:test'
import { marketingPages, renderSitemap } from '../../scripts/build-marketing-sitemap.mjs'

test('manifest describes every canonical public route once', () => {
  assert.deepEqual(marketingPages.map((page) => page.path), ['/', '/en/', '/quickstart', '/handbook'])
  assert.ok(marketingPages.every((page) => /^2026-08-\d{2}$/.test(page.updatedAt)))
})

test('sitemap renderer is deterministic and XML-safe', () => {
  const xml = renderSitemap('https://nomiaqm.com')
  assert.equal((xml.match(/<url>/g) || []).length, marketingPages.length)
  assert.match(xml, /<loc>https:\/\/nomiaqm\.com\/quickstart<\/loc>/)
  assert.doesNotMatch(xml, /<loc>https:\/\/nomiaqm\.com\/(?:quickstart|handbook)\.html<\/loc>/)
  assert.match(xml, /<lastmod>2026-08-23<\/lastmod>/)
  assert.doesNotMatch(xml, /&(?!(amp|lt|gt);)/)
})
