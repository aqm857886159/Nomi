import { isDeepStrictEqual } from 'node:util'

const TOP_LEVEL_FIELDS = Object.freeze(['edges', 'groups', 'nodes', 'selectedNodeIds'])
const NODE_FIELDS = new Set([
  'currentResultId',
  'hasResult',
  'id',
  'kind',
  'locked',
  'position',
  'prompt',
  'resultIds',
  'shotIndex',
  'status',
  'title',
])
const EDGE_FIELDS = new Set(['id', 'mode', 'order', 'source', 'target'])
const GROUP_FIELDS = new Set(['collapsed', 'id', 'name', 'nodeIds'])
const POSITION_FIELDS = new Set(['x', 'y'])
const URI_SCHEME = /^[a-z][a-z0-9+.-]*:/i

function fail(label, message) {
  throw new Error(`Canonical canvas.read ${label} failed: ${message}`)
}

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(label, 'expected an object')
  return value
}

function exactFields(value, allowed, label) {
  const actual = Object.keys(value)
  const extras = actual.filter((key) => !allowed.has(key))
  if (extras.length) fail(label, `unexpected field(s): ${extras.join(', ')}`)
}

function stringArray(value, label, { nonEmpty = false, opaque = false } = {}) {
  if (
    !Array.isArray(value) ||
    value.some(
      (item) => typeof item !== 'string' || (nonEmpty && item.trim().length === 0) || (opaque && URI_SCHEME.test(item)),
    )
  ) {
    fail(label, 'expected a string array')
  }
}

function requiredString(value, field, label, { nonEmpty = false, opaque = false } = {}) {
  const candidate = value[field]
  if (
    typeof candidate !== 'string' ||
    (nonEmpty && candidate.trim().length === 0) ||
    (opaque && URI_SCHEME.test(candidate))
  ) {
    fail(label, `${field} must be a${nonEmpty ? ' non-empty' : ''} string`)
  }
}

function requiredBoolean(value, field, label) {
  if (typeof value[field] !== 'boolean') fail(label, `${field} must be a boolean`)
}

function optionalSequence(value, field, label) {
  const candidate = value[field]
  if (candidate !== undefined && (!Number.isSafeInteger(candidate) || candidate < 0)) {
    fail(label, `${field} must be a nonnegative safe integer`)
  }
}

/** Parse the first JSON text block used by ordinary (non-canonical) MCP tools. */
export function parseJsonToolResult(result, label = 'tool result') {
  if (result?.isError) fail(label, 'tool returned isError')
  const block = Array.isArray(result?.content)
    ? result.content.find((item) => item?.type === 'text' && typeof item.text === 'string')
    : undefined
  if (!block) fail(label, 'missing text content')
  try {
    return JSON.parse(block.text)
  } catch {
    fail(label, 'text content is not JSON')
  }
}

/**
 * Package-level proof for the canonical canvas.read MCP boundary. It verifies
 * both wire projections, the exact safe schema, and that text cannot drift
 * from structuredContent.
 */
export function proveCanonicalCanvasReadToolResult(result) {
  const structured = record(result?.structuredContent, 'structured result')
  const actualTopLevel = Object.keys(structured).sort()
  if (!isDeepStrictEqual(actualTopLevel, TOP_LEVEL_FIELDS)) {
    fail('structured result', `expected only ${TOP_LEVEL_FIELDS.join(', ')}`)
  }

  for (const field of TOP_LEVEL_FIELDS) {
    if (!Array.isArray(structured[field])) fail('structured result', `${field} must be an array`)
  }
  stringArray(structured.selectedNodeIds, 'selectedNodeIds', { nonEmpty: true })

  for (const [index, value] of structured.nodes.entries()) {
    const label = `nodes[${index}]`
    const node = record(value, label)
    exactFields(node, NODE_FIELDS, label)
    requiredString(node, 'id', label, { nonEmpty: true })
    requiredString(node, 'kind', label, { nonEmpty: true })
    requiredString(node, 'title', label)
    requiredString(node, 'prompt', label)
    requiredString(node, 'status', label)
    requiredBoolean(node, 'locked', label)
    requiredBoolean(node, 'hasResult', label)
    optionalSequence(node, 'shotIndex', label)
    if (node.currentResultId !== undefined)
      requiredString(node, 'currentResultId', label, { nonEmpty: true, opaque: true })
    if (node.resultIds !== undefined)
      stringArray(node.resultIds, `${label}.resultIds`, { nonEmpty: true, opaque: true })
    const position = record(node.position, `${label}.position`)
    exactFields(position, POSITION_FIELDS, `${label}.position`)
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) {
      fail(`${label}.position`, 'x and y must be finite numbers')
    }
  }
  for (const [index, value] of structured.edges.entries()) {
    const label = `edges[${index}]`
    const edge = record(value, label)
    exactFields(edge, EDGE_FIELDS, label)
    requiredString(edge, 'id', label, { nonEmpty: true })
    requiredString(edge, 'source', label, { nonEmpty: true })
    requiredString(edge, 'target', label, { nonEmpty: true })
    requiredString(edge, 'mode', label)
    optionalSequence(edge, 'order', label)
  }
  for (const [index, value] of structured.groups.entries()) {
    const label = `groups[${index}]`
    const group = record(value, label)
    exactFields(group, GROUP_FIELDS, label)
    requiredString(group, 'id', label, { nonEmpty: true })
    requiredString(group, 'name', label)
    requiredBoolean(group, 'collapsed', label)
    stringArray(group.nodeIds, `${label}.nodeIds`, { nonEmpty: true })
  }

  const text = parseJsonToolResult(result, 'text result')
  if (!isDeepStrictEqual(text, structured)) fail('wire projection', 'text and structuredContent differ')
  return structured
}
