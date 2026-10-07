#!/usr/bin/env node
import fs from 'node:fs'
import crypto from 'node:crypto'
import { pathToFileURL } from 'node:url'

export function readGlb(file) {
  const bytes = fs.readFileSync(file)
  if (bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2) throw new Error(`bad GLB header: ${file}`)
  const jsonLength = bytes.readUInt32LE(12)
  if (bytes.toString('ascii', 16, 20) !== 'JSON') throw new Error(`missing GLB JSON chunk: ${file}`)
  return { bytes, json: JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').replace(/\0+$/, '')) }
}

export function checkUalAsset({ root = process.cwd(), asset = 'src/assets/director/ual/ual-mannequin.glb', manifest = 'src/assets/director/ual/ual-mannequin.manifest.json', rig = 'src/assets/director/ual/ual-rig.json' } = {}) {
  const assetPath = `${root}/${asset}`
  const manifestPath = `${root}/${manifest}`
  const rigPath = `${root}/${rig}`
  const { bytes, json } = readGlb(assetPath)
  const manifestData = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const rigData = JSON.parse(fs.readFileSync(rigPath, 'utf8'))
  const nodes = new Set((json.nodes ?? []).map((node) => node.name).filter(Boolean))
  const animations = new Set((json.animations ?? []).map((animation) => animation.name))
  const expectedBones = Object.values(rigData.semanticBones).concat(Object.values(rigData.childBones))
  const missingBones = [...new Set(expectedBones)].filter((bone) => !nodes.has(bone))
  const missingActions = manifestData.actions.map((action) => action.id).filter((id) => !animations.has(id))
  const hash = crypto.createHash('sha256').update(bytes).digest('hex')
  const result = {
    file: asset,
    bytes: bytes.length,
    sha256: hash,
    manifestBytesMatch: bytes.length === manifestData.outputBytes,
    manifestShaMatch: hash === manifestData.outputSha256,
    nodeCount: nodes.size,
    animationCount: animations.size,
    actionCount: manifestData.actions.length,
    missingBones,
    missingActions,
    materialNames: (json.materials ?? []).map((material) => material.name),
    imageCount: (json.images ?? []).length,
    textureCount: (json.textures ?? []).length,
    pass: bytes.length === manifestData.outputBytes && hash === manifestData.outputSha256 && manifestData.actions.length === 45 && animations.size === 45 && missingBones.length === 0 && missingActions.length === 0 && (json.images ?? []).length === 0 && (json.textures ?? []).length === 0 && (json.materials ?? []).map((material) => material.name).includes('UAL_WhiteModel'),
  }
  return result
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = checkUalAsset()
  console.log(JSON.stringify(result, null, 2))
  if (!result.pass) process.exit(1)
}
