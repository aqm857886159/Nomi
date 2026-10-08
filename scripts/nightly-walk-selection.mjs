import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function loadNightlyExclusions(root = repoRoot) {
  const source = JSON.parse(fs.readFileSync(path.join(root, 'tests/ux/nightly-ci-exclusions.json'), 'utf8'))
  return new Map(source.exclusions.map((entry) => [entry.path, entry]))
}

export function selectNightlyWalks(files, { root = repoRoot } = {}) {
  const exclusions = loadNightlyExclusions(root)
  return [...files]
    .map((file) => file.replaceAll('\\', '/'))
    .filter((file) => file.endsWith('.walk.mjs') && !file.endsWith('.paid.mjs'))
    .filter((file) => !exclusions.has(file))
    .sort()
}

function listWalks(directory) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.posix.join(path.relative(repoRoot, directory).replaceAll('\\', '/'), entry.name))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = path.resolve(repoRoot, process.argv[2] ?? 'tests/ux')
  for (const file of selectNightlyWalks(listWalks(directory))) console.log(file)
}
