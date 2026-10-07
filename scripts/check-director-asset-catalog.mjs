#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const root = process.cwd()
const catalogSource = fs.readFileSync(path.join(root, 'src/workbench/generationCanvas/nodes/director/model/assetCatalog/index.ts'), 'utf8')
const license = JSON.parse(fs.readFileSync(path.join(root, 'docs/engineering/third-party-assets.json'), 'utf8'))
const referenced = [...catalogSource.matchAll(/'((?:src\/assets\/director\/)[^']+)'/g)].map((match) => match[1])
const assetFiles = []
for (const dir of ['src/assets/director/actions', 'src/assets/director/pose/restored', 'src/assets/director/props', 'src/assets/director/ual']) {
  const dirPath = path.join(root, dir)
  if (!fs.existsSync(dirPath)) continue
  for (const entry of fs.readdirSync(dirPath)) if (/\.(fbx|glb)$/i.test(entry)) assetFiles.push(path.join(dir, entry))
}
if (catalogSource.includes('UAL_MANNEQUIN_FILE')) referenced.push('src/assets/director/ual/ual-mannequin.glb')
const uniqueReferenced = [...new Set(referenced)]
const missingFiles = uniqueReferenced.filter((file) => !fs.existsSync(path.join(root, file)))
const unreferenced = assetFiles.filter((file) => !uniqueReferenced.includes(file))
const byFile = new Map(license.assets.map((asset) => [asset.file, asset]))
const missingLicense = assetFiles.filter((file) => !byFile.has(file))
const hashMismatches = assetFiles.filter((file) => {
  const entry = byFile.get(file)
  if (!entry) return false
  const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')
  return hash !== entry.sha256 || fs.statSync(path.join(root, file)).size !== entry.bytes
})
const glbErrors = []
for (const file of assetFiles.filter((file) => file.endsWith('.glb'))) {
  const bytes = fs.readFileSync(path.join(root, file))
  if (bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2) glbErrors.push(`${file}: bad GLB header`)
  const jsonLength = bytes.readUInt32LE(12)
  const jsonType = bytes.toString('ascii', 16, 20)
  if (jsonType !== 'JSON' || !jsonLength) glbErrors.push(`${file}: missing JSON chunk`)
}
const newBytes = assetFiles.reduce((sum, file) => sum + fs.statSync(path.join(root, file)).size, 0)
const report = { referenced: uniqueReferenced.length, assetFiles: assetFiles.length, missingFiles, unreferenced, missingLicense, hashMismatches, glbErrors, newBytes, newMiB: Number((newBytes / 1024 / 1024).toFixed(3)), budgetMiB: 30 }
console.log(JSON.stringify(report, null, 2))
if (missingFiles.length || unreferenced.length || missingLicense.length || hashMismatches.length || glbErrors.length || newBytes > 30 * 1024 * 1024) process.exit(1)
