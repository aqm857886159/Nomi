import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'
import { MODEL_ARCHETYPES, resolveArchetypeForModel } from './index'
import { anchorsConsumedBy } from './anchorPolicy'

const stripComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? sources(path.join(directory, entry.name)) : /\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name) ? [path.join(directory, entry.name)] : [])
}
it('profiles never author derived consumesAnchors and all resolved modes agree with slots', () => {
  const files = [...sources('electron/shared/modelArchetypes'), ...sources('electron/shared/videoCapabilities')]
  for (const file of files.filter(file => path.basename(file) !== 'index.ts' && path.basename(file) !== 'types.ts')) {
    expect(stripComments(readFileSync(file, 'utf8')), file).not.toMatch(/\bconsumesAnchors\s*:/)
  }
  for (const profile of MODEL_ARCHETYPES) {
    const resolved = resolveArchetypeForModel({ modelKey: profile.identifierPatterns[0], vendorKey: null, meta: { archetypeId: profile.id } })!
    for (const mode of resolved.modes) expect(mode.consumesAnchors).toEqual(anchorsConsumedBy(mode))
  }
})
it('shot/node precedence is owned by effectiveShotValue, not inline fallbacks', () => {
  for (const file of sources('src/workbench')) {
    expect(stripComments(readFileSync(file, 'utf8')), file).not.toMatch(/node\??\.prompt\s*(?:\?\?|\|\|)\s*shot\.prompt/)
  }
})
