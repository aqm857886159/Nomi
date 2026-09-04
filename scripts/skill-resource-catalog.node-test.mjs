import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { loadCatalog, validateCatalog } from './skill-resource-catalog.mjs'

const root = path.resolve(import.meta.dirname, '..')
const catalogPath = path.join(root, 'docs/research/2026-09-05-skill-resource-catalog/catalog.seed.json')

test('catalog seed is valid and every entry has rights and source evidence', () => {
  const result = validateCatalog(loadCatalog(catalogPath))
  assert.deepEqual(result.errors, [])
  assert.equal(result.entryCount, 5)
})

test('blocked entries must explain why they cannot be copied or used', () => {
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
  catalog.entries[0].status = 'blocked'
  delete catalog.entries[0].blockedReason
  const result = validateCatalog(catalog)
  assert.ok(result.errors.some((error) => error.includes('blockedReason')))
})

test('unknown rights cannot become a downloadable or adaptable catalog entry', () => {
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
  catalog.entries[0].rights.redistribution = 'unknown'
  catalog.entries[0].rights.adaptation = 'unknown'
  catalog.entries[0].nomi.downloadPolicy = 'licensed-copy'
  const result = validateCatalog(catalog)
  assert.ok(result.errors.some((error) => error.includes('downloadPolicy')))
})

test('duplicate ids and missing source evidence are rejected', () => {
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
  catalog.entries[1].id = catalog.entries[0].id
  catalog.entries[1].sourceEvidence = []
  const result = validateCatalog(catalog)
  assert.ok(result.errors.some((error) => error.includes('duplicate id')))
  assert.ok(result.errors.some((error) => error.includes('sourceEvidence')))
})
