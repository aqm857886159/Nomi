// 真实旧版本落的目录（tests/fixtures/old-user-data/catalogs）升级后点发送：反馈包里模型目录还在，老用户接的连接只留「是自建」和个数。
// 读法和生产一样：盘上的文件原样 JSON.parse（feedbackIpc.ts 的 readModelCatalog），不先升格式。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildFeedbackReport } from '../../electron/feedback/feedbackReport'
import { FEEDBACK_MANIFEST_ITEMS as ITEMS } from '../../electron/shared/contracts/feedback'

const CATALOGS = fileURLToPath(new URL('../fixtures/old-user-data/catalogs', import.meta.url))
const DIRECTORIES = ['v0.20.0-wizard', 'v0.24.0-wizard', 'v0.24.0-native-wire', 'v0.24.0-declared-card', 'v0.24.0-wizard-audio']
const STAMP = '2026-11-01T00:00:00.000Z'

const report = (catalog, provider, model) => buildFeedbackReport({ surface: 'generation', summary: 'old user summary', provider, model }, {
  now: new Date(STAMP),
  app: { version: '0.24.0', electron: '43.0.0', node: '22.0.0', chrome: '130' },
  system: { platform: 'darwin', arch: 'arm64', osRelease: '25.5.0', locale: 'zh-CN', timeZone: 'Asia/Shanghai' },
  projectId: null,
  readLogTail: () => [`[${STAMP}] WARN  vendor         call vendor=${provider} model=${model} status=500 ms=12`],
  readModelCatalog: () => catalog,
  readTrajectory: async () => null,
})

describe('老用户的目录，升级后点发送', () => {
  it.each(DIRECTORIES)('%s：目录附件还在，连接只留是自建和个数，名字、地址、key、模型名都不出门', async (directory) => {
    const catalog = JSON.parse(fs.readFileSync(path.join(CATALOGS, directory, 'model-catalog.json'), 'utf8'))
    const [vendor] = catalog.vendors
    const built = await report(catalog, vendor.key, catalog.models[0].modelKey)

    expect(built.manifest.entries.map((entry) => entry.path)).toEqual(expect.arrayContaining([ITEMS.modelCatalog, ITEMS.logTail]))
    const outgoing = built.attachments[ITEMS.modelCatalog]
    expect(outgoing.vendors).toEqual([expect.objectContaining({ key: 'custom', enabled: vendor.enabled, modelCount: catalog.models.length, mappingCount: catalog.mappings.length })])
    expect(outgoing.models).toEqual([])
    expect(outgoing.mappings).toEqual([])
    expect(outgoing.modelsOmitted).toBe(catalog.models.length)
    expect(outgoing.mappingsOmitted).toBe(catalog.mappings.length)
    expect(built.context.provider).toBe('custom')
    expect(built.context.model).toBeNull()
    expect(built.attachments[ITEMS.logTail].join('\n')).toContain('vendor=custom model=…')

    const text = JSON.stringify(built)
    const usersOwn = [
      vendor.key,
      vendor.name,
      new URL(vendor.baseUrlHint).host,
      ...catalog.models.map((model) => model.modelKey),
      ...Object.values(catalog.apiKeysByVendor).map((record) => record.apiKey),
    ]
    expect(usersOwn.filter((value) => text.includes(value))).toEqual([])
  })
})
