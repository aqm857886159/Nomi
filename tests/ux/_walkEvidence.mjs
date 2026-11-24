import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { makeTempDir } from '../../scripts/_test-temp.mjs'

export function walkEvidenceDir({ argv = process.argv.slice(2), configured, absolute = false, checkouts = [] } = {}) {
  const flag = argv.indexOf('--out')
  const requested = flag < 0 ? configured : argv[flag + 1]
  if (flag >= 0 && (!requested || requested.startsWith('--'))) throw new Error('--out requires a directory')
  if (!requested) return makeTempDir('nomi-walk-', { retain: true })
  assert(!absolute || path.isAbsolute(requested), 'Evidence must name an absolute directory')
  const out = path.resolve(requested)
  for (const checkout of checkouts) {
    const relative = path.relative(checkout, out)
    assert(relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative), 'Evidence must stay outside the checkout')
  }
  fs.mkdirSync(out, { recursive: true })
  return out
}
