import fs from 'node:fs'

const STATUSES = new Set(['documented', 'observed', 'inferred', 'proposed', 'blocked'])
const CATEGORIES = new Set(['script', 'cinematic-visual', 'editing'])
const CONTENT_TYPES = new Set(['text', 'image', 'video', 'workflow'])
const RIGHTS = new Set(['allowed', 'conditional', 'forbidden', 'unknown'])
const DOWNLOAD_POLICIES = new Set(['metadata-only', 'source-download', 'licensed-copy', 'blocked'])

export function loadCatalog(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function isUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function validateEntry(entry, index) {
  const errors = []
  const prefix = `entries[${index}]`
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [`${prefix} must be an object`]
  for (const field of ['id', 'title', 'summary']) {
    if (!isNonEmptyString(entry[field])) errors.push(`${prefix}.${field} is required`)
  }
  if (!CATEGORIES.has(entry.category)) errors.push(`${prefix}.category is invalid`)
  if (!Array.isArray(entry.useCases) || entry.useCases.length === 0 || entry.useCases.some((item) => !isNonEmptyString(item))) {
    errors.push(`${prefix}.useCases is required`)
  }
  if (!entry.author || !isNonEmptyString(entry.author.name)) errors.push(`${prefix}.author.name is required`)
  if (!isUrl(entry.originUrl)) errors.push(`${prefix}.originUrl must be an http(s) URL`)
  if (!Array.isArray(entry.contentTypes) || entry.contentTypes.length === 0 || entry.contentTypes.some((item) => !CONTENT_TYPES.has(item))) {
    errors.push(`${prefix}.contentTypes is invalid`)
  }
  if (!STATUSES.has(entry.status)) errors.push(`${prefix}.status is invalid`)
  if (entry.status === 'blocked' && !isNonEmptyString(entry.blockedReason)) errors.push(`${prefix}.blockedReason is required for blocked entries`)

  const rights = entry.rights
  if (!rights || !isNonEmptyString(rights.license)) errors.push(`${prefix}.rights.license is required`)
  for (const field of ['redistribution', 'adaptation']) {
    if (!rights || !RIGHTS.has(rights[field])) errors.push(`${prefix}.rights.${field} is invalid`)
  }
  const downloadPolicy = entry.nomi?.downloadPolicy ?? 'metadata-only'
  if (!DOWNLOAD_POLICIES.has(downloadPolicy)) errors.push(`${prefix}.nomi.downloadPolicy is invalid`)
  if ((downloadPolicy === 'source-download' || downloadPolicy === 'licensed-copy') && (!rights || rights.redistribution === 'unknown' || rights.adaptation === 'unknown')) {
    errors.push(`${prefix}.nomi.downloadPolicy requires known redistribution and adaptation rights`)
  }
  const evidence = entry.sourceEvidence
  if (!Array.isArray(evidence) || evidence.length === 0 || evidence.some((item) => !item || !isUrl(item.url) || !isNonEmptyString(item.claim))) {
    errors.push(`${prefix}.sourceEvidence is required with valid URLs and claims`)
  }
  return errors
}

export function validateCatalog(catalog) {
  const errors = []
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) return { errors: ['catalog must be an object'], entryCount: 0 }
  if (catalog.schemaVersion !== 1) errors.push('schemaVersion must be 1')
  if (!isNonEmptyString(catalog.generatedAt) || Number.isNaN(Date.parse(catalog.generatedAt))) errors.push('generatedAt must be an ISO date')
  if (!Array.isArray(catalog.entries)) return { errors: [...errors, 'entries must be an array'], entryCount: 0 }
  const ids = new Set()
  for (let index = 0; index < catalog.entries.length; index += 1) {
    const entry = catalog.entries[index]
    if (entry?.id && ids.has(entry.id)) errors.push(`duplicate id: ${entry.id}`)
    if (entry?.id) ids.add(entry.id)
    errors.push(...validateEntry(entry, index))
  }
  return { errors, entryCount: catalog.entries.length }
}
