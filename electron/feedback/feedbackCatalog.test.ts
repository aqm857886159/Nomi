import { describe, expect, it } from 'vitest'
import { enFeedbackReport, zhFeedbackReport } from '../../src/i18n/locales/feedbackReport'
import { BUILTIN_VENDOR_SEEDS, isLocalSeed } from '../catalog/builtinVendorSeeds'
import { applyBuiltinSeeds } from '../catalog/seedBuiltins'
import { CURRENT_CATALOG_VERSION } from '../catalog/types'
import { redactModelCatalog } from '../diagnostics/catalogRedaction'
import { builtinVendorKeyOfKey } from '../shared/builtinVendorIdentity'
import { projectCatalogForReport } from './feedbackCatalog'
import { projectLogLine } from './feedbackLogTail'
import { buildFeedbackReport } from './feedbackReport'

type Row = Record<string, unknown>
const project = (catalog: unknown, provider: string | null = null): Row | null => projectCatalogForReport(redactModelCatalog(catalog), provider)
const vendorRows = (projected: Row | null): Row[] => (projected?.vendors ?? []) as Row[]

/** 同一个自建中转和它的连接名，塞进目录里每一处能写字的格子。 */
const NEEDLES = [
  'gw-corp-example', 'gw.corp.example', 'upload.corp.example', 'proxy.corp.example', 'relay.corp.example', 'Corp Gateway',
  'corp-team', '团队专线', 'corp-exec-model', 'corp-alias', '内部模型', '内部映射', 'X-Corp-Tenant', 'corp-tenant-42', 'corp-ak',
  'studio-rig', 'studio rig', '192.168.50.60', '10.20.30.40', 'user:pw', 'plain-corp-secret', 'futureField',
]
const STAMP = '2026-11-01T00:00:00.000Z'
const LOCAL_SEED_KEYS = ['comfyui-local', 'local-text', 'codex-local', 'antigravity-cli', 'local-speech']
const plantedCatalog = {
  version: CURRENT_CATALOG_VERSION,
  futureField: { vendorKey: 'gw-corp-example', note: 'gw.corp.example' },
  suppressedBuiltinModels: [{ vendorKey: 'apimart--corp-team', modelKey: 'gpt-5.5' }, { vendorKey: 'gw-corp-example', modelKey: 'corp-exec-model' }],
  vendors: [
    {
      key: 'gw-corp-example', name: 'Corp Gateway', enabled: true, baseUrlHint: 'https://gw.corp.example/v1', authType: 'bearer', authHeader: 'X-Corp-Tenant', providerKind: 'openai-compatible',
      credentialBinding: { origin: 'https://gw.corp.example', confirmedAt: STAMP },
      assetIngestion: { strategy: 'upload-multipart', endpoint: 'https://upload.corp.example/files', urlPath: 'url' },
      network: { proxyUrl: 'http://user:pw@proxy.corp.example:8080', proxyEnabled: true },
      meta: { extraHeaders: { 'X-Corp-Tenant': 'corp-tenant-42' }, connectionName: '团队专线' },
    },
    { key: 'gw-corp-example--corp-team', name: '团队专线', enabled: false, baseUrlHint: 'https://gw.corp.example/team' },
    { key: 'comfyui-local-studio-rig', name: 'studio rig', enabled: true, baseUrlHint: 'http://192.168.50.60:8188', authType: 'none' },
    { key: 'apimart', name: 'APIMart', enabled: true, baseUrlHint: 'https://api.apimart.ai', authType: 'bearer' },
    { key: 'apimart--corp-team', name: '团队专线', enabled: true, baseUrlHint: 'https://api.apib.ai', authType: 'bearer', meta: { connectionName: 'corp-team' } },
    { key: 'apimart--candidate-0123456789abcdef', name: 'relay.corp.example', enabled: false, baseUrlHint: 'https://relay.corp.example/v1' },
    { key: 'kie', name: 'Corp Gateway', enabled: true, baseUrlHint: 'gw.corp.example/kie', authType: 'bearer', assetIngestion: { strategy: 'upload-multipart', endpoint: 'https://upload.corp.example/files', urlPath: 'url' } },
    { key: 'comfyui-local', name: 'studio rig', enabled: true, baseUrlHint: 'http://10.20.30.40:8188', authType: 'none' },
  ],
  models: [
    { vendorKey: 'gw-corp-example', modelKey: 'corp-exec-model', modelAlias: 'corp-alias', labelZh: '内部模型', kind: 'text', enabled: true },
    { vendorKey: 'gw-corp-example--corp-team', modelKey: 'corp-exec-model', labelZh: '内部模型', kind: 'text', enabled: true },
    { vendorKey: 'apimart', modelKey: 'gpt-5.5', labelZh: 'GPT 5.5', kind: 'text', enabled: true, customCall: { script: 'fetch("https://gw.corp.example/x", { headers: { "X-Corp-Tenant": "corp-tenant-42" } })', updatedAt: STAMP } },
    { vendorKey: 'apimart--corp-team', modelKey: 'seedance-2.5', labelZh: 'Seedance 2.5', kind: 'video', enabled: true, meta: { note: 'see https://gw.corp.example/doc', archetypeId: 'seedance' } },
  ],
  mappings: [
    { id: 'map-gw-corp-example-1', vendorKey: 'gw-corp-example', taskKind: 'chat', name: '内部映射', enabled: true, create: { method: 'POST', path: 'https://gw.corp.example/v1/run' } },
    { id: 'apimart--corp-team-video', vendorKey: 'apimart--corp-team', taskKind: 'text_to_video', name: 'Seedance', enabled: true, create: { method: 'POST', path: 'https://api.apib.ai/v1/videos' }, query: { method: 'GET', path: 'https://relay.corp.example/poll' } },
    { id: 'seed-apimart-chat', vendorKey: 'apimart', taskKind: 'chat', name: 'GPT', enabled: true, create: { method: 'POST', path: '/v1/chat/completions' } },
    { id: 'seed-kie-video', vendorKey: 'kie', taskKind: 'text_to_video', name: 'KIE', enabled: true, create: { method: 'POST', path: '/api/v1/jobs' } },
  ],
  apiKeysByVendor: {
    'gw-corp-example': {
      vendorKey: 'gw-corp-example', apiKey: 'plain-corp-secret', enc: 'plain', enabled: true, createdAt: STAMP, updatedAt: STAMP,
      customConfig: { 'corp-ak': 'corp-tenant-42' },
      networkConfig: { proxyUrl: 'http://user:pw@proxy.corp.example:8080', extraHeaders: { 'X-Corp-Tenant': 'corp-tenant-42' } },
    },
    apimart: { vendorKey: 'apimart', apiKey: 'plain-corp-secret', enc: 'safeStorage', enabled: true, verificationPending: true, createdAt: STAMP, updatedAt: STAMP },
    'apimart--corp-team': {
      vendorKey: 'apimart--corp-team', apiKey: 'plain-corp-secret', enc: 'safeStorage', enabled: true, createdAt: STAMP, updatedAt: STAMP,
      networkConfig: { proxyUrl: 'http://user:pw@proxy.corp.example:8080' },
    },
  },
}

describe('反馈包里的模型目录', () => {
  it('自建地址和连接名塞进每一格，出门的目录一处都没有', () => {
    const text = JSON.stringify(project(plantedCatalog, 'apimart'))
    expect(NEEDLES.filter((needle) => text.includes(needle))).toEqual([])
  })

  it('自建行只留「是自建」和排查要用的事实，名下的模型和映射只留个数', () => {
    const rows = vendorRows(project(plantedCatalog))
    expect(rows.filter((row) => row.key === 'custom')).toEqual([
      {
        key: 'custom', enabled: true, authType: 'bearer', providerKind: 'openai-compatible', modelCount: 1, mappingCount: 1,
        credential: { enc: 'plain', enabled: true, createdAt: STAMP, updatedAt: STAMP, hasProxy: true, hasExtraHeaders: true },
      },
      { key: 'custom', enabled: false, authType: null, providerKind: null, credential: null, modelCount: 1, mappingCount: 0 },
      { key: 'custom', enabled: true, authType: 'none', providerKind: null, credential: null, modelCount: 0, mappingCount: 0 },
    ])
  })

  it('内置家：名字用代码里的，兄弟连接换成序号，身上每一处旧 key 都跟着换', () => {
    const projected = project(plantedCatalog, 'apimart')
    expect(vendorRows(projected).map((row) => row.key)).toEqual(['custom', 'custom', 'custom', 'apimart', 'apimart--2', 'apimart--3', 'kie', 'comfyui-local'])
    const apimart = BUILTIN_VENDOR_SEEDS.find((seed) => seed.key === 'apimart')
    expect(vendorRows(projected)[4].name).toBe(apimart?.name)
    expect((projected?.models as Row[]).map((model) => model.vendorKey)).toEqual(['apimart', 'apimart--2'])
    expect((projected?.mappings as Row[])[0]).toMatchObject({ id: 'apimart--2-video', vendorKey: 'apimart--2' })
    expect(projected?.apiKeysByVendor).toHaveProperty(['apimart--2', 'vendorKey'], 'apimart--2')
    expect(projected?.suppressedBuiltinModels).toEqual([{ vendorKey: 'apimart--2', modelKey: 'gpt-5.5' }])
  })

  it('内置家的地址：代码里登记过的原样留，用户改成自己的换成标记，不带协议的也算', () => {
    const address = (key: string): unknown => vendorRows(project(plantedCatalog)).find((row) => row.key === key)?.baseUrlHint
    expect(address('apimart')).toBe('https://api.apimart.ai')
    expect(address('apimart--2')).toBe('https://api.apib.ai')
    expect(address('apimart--3')).toBe('<custom-address>')
    expect(address('kie')).toBe('<custom-address>')
    expect(address('comfyui-local')).toBe('<custom-address>')
  })

  it('映射里混着的自建地址也换掉，官方备用域留着', () => {
    const [mapping] = project(plantedCatalog, 'apimart')?.mappings as { create: Row; query: Row }[]
    expect(mapping.create.path).toBe('https://api.apib.ai/v1/videos')
    expect(mapping.query.path).toBe('<custom-address>')
  })

  it('用户写的调用脚本不出门，只说有', () => {
    const [model] = project(plantedCatalog)?.models as Row[]
    expect(model.customCall).toBe(true)
  })

  it('密钥记录只留事实：材料、自定义配置的名字、自定义头的名字都不要', () => {
    const records = project(plantedCatalog)?.apiKeysByVendor as Record<string, Row>
    expect(Object.keys(records).sort()).toEqual(['apimart', 'apimart--2'])
    expect(records.apimart).toEqual({ vendorKey: 'apimart', enc: 'safeStorage', enabled: true, verificationPending: true, createdAt: STAMP, updatedAt: STAMP, hasProxy: false, hasExtraHeaders: false })
    expect(records['apimart--2']).toMatchObject({ hasProxy: true, hasExtraHeaders: false })
  })

  it('接口映射只留配过的厂商和这次出问题的那一家，自建的算进省略数', () => {
    const noProvider = project(plantedCatalog)
    expect((noProvider?.mappings as Row[]).map((mapping) => mapping.vendorKey)).toEqual(['apimart--2', 'apimart'])
    expect(noProvider?.mappingsOmitted).toBe(2)
    expect(noProvider?.modelsOmitted).toBe(2)
    expect((project(plantedCatalog, 'kie')?.mappings as Row[]).map((mapping) => mapping.vendorKey)).toEqual(['apimart--2', 'apimart', 'kie'])
    expect((project(plantedCatalog, 'custom')?.mappings as Row[]).map((mapping) => mapping.vendorKey)).toEqual(['apimart--2', 'apimart'])
  })

  it('新装机的目录，内置家一格都不该被当成自建', () => {
    const { state } = applyBuiltinSeeds({ version: CURRENT_CATALOG_VERSION, vendors: [], models: [], mappings: [], apiKeysByVendor: {} }, STAMP)
    const everyVendorConfigured = Object.fromEntries(BUILTIN_VENDOR_SEEDS.map((seed) => [seed.key, { vendorKey: seed.key, apiKey: 'x', enabled: true, createdAt: STAMP, updatedAt: STAMP }]))
    const projected = project({ ...state, apiKeysByVendor: everyVendorConfigured })
    const localKeys = new Set(LOCAL_SEED_KEYS)
    const cloudMappings = state.mappings.filter((mapping) => !localKeys.has(mapping.vendorKey))
    expect(cloudMappings.length).toBeGreaterThan(0)
    expect((projected?.mappings as Row[]).length).toBe(cloudMappings.length)
    expect(JSON.stringify(projected)).not.toContain('<custom-address>')
    const seededMeta = (key: string, field: string): unknown => (state.models.find((model) => model.modelKey === key)?.meta as Row | undefined)?.[field]
    const [seeded] = state.models.filter((model) => !localKeys.has(model.vendorKey) && seededMeta(model.modelKey, 'archetypeId'))
    expect((projected?.models as { modelKey: string; meta: Row }[]).find((model) => model.modelKey === seeded.modelKey)?.meta.archetypeId).toBe(seededMeta(seeded.modelKey, 'archetypeId'))
    expect(vendorRows(projected).map((row) => row.key)).toEqual(state.vendors.map((vendor) => vendor.key))
    for (const row of vendorRows(projected)) {
      expect(row.baseUrlHint).toBe(BUILTIN_VENDOR_SEEDS.find((seed) => seed.key === row.key)?.baseUrl || null)
    }
  })

  it('模型行：表外的字段不出门，`meta` 也一样；用户和 Agent 能写的格子只说有', () => {
    const [row] = project({
      vendors: [{ key: 'apimart' }],
      models: [{
        vendorKey: 'apimart', modelKey: 'gpt-5.5', modelAlias: 'gpt-55', labelZh: 'GPT 5.5', kind: 'text', enabled: true, unlisted: true, createdAt: STAMP, updatedAt: STAMP,
        futureField: 'planted-future-field',
        customCall: { script: 'planted-script', updatedAt: STAMP },
        meta: {
          archetypeId: 'gpt', wireProfile: 'newapi', canonicalModelId: 'gpt 5.5', catalogLifecycle: 'current', supportsImageInput: true, promptRefineOnly: false,
          note: 'planted-meta-note',
          futureMeta: { nested: 'planted-future-meta' },
          parameters: [{ key: 'prompt', default: 'planted-parameter-default' }],
          customCapabilityContract: { note: 'planted-contract' },
          customCallDraft: { createdAt: STAMP, script: 'planted-draft' },
          comfyWorkflowImport: { text: 'planted-workflow' },
          adapter: { state: 'declared', evidence: 'self-check', updatedAt: STAMP, runId: 'planted-run', publicationModes: ['planted-mode'] },
          imageOptions: { supportsReferenceImages: true, imageEditProtocol: 'newapi', future: 'planted-option' },
        },
      }],
    })?.models as Row[]
    expect(row).toEqual({
      vendorKey: 'apimart', modelKey: 'gpt-5.5', modelAlias: 'gpt-55', labelZh: 'GPT 5.5', kind: 'text', enabled: true, unlisted: true, createdAt: STAMP, updatedAt: STAMP,
      customCall: true,
      meta: {
        archetypeId: 'gpt', wireProfile: 'newapi', canonicalModelId: 'gpt 5.5', catalogLifecycle: 'current', supportsImageInput: true, promptRefineOnly: false,
        parameters: true, customCapabilityContract: true, customCallDraft: true,
        adapter: { state: 'declared', evidence: 'self-check', updatedAt: STAMP },
        imageOptions: { supportsReferenceImages: true, imageEditProtocol: 'newapi' },
      },
    })
    expect(JSON.stringify(row)).not.toContain('planted')
  })

  describe('种子地址在本机的家：模型和映射是用户自己的，和自建一样只留个数', () => {
    const PROMPT = 'a girl walks in the planted rain'
    const FILE_NAME = 'planted-portrait.png'
    const LABEL = '我的私人工作流'
    const MODEL_KEY = 'comfy-planted-portrait-1'
    const SECRETS = [PROMPT, FILE_NAME, LABEL, MODEL_KEY]
    const WORKFLOW = { 3: { class_type: 'CLIPTextEncode', inputs: { text: PROMPT } }, 4: { class_type: 'LoadImage', inputs: { image: FILE_NAME } } }
    const workflowRows = (vendorKey: string, modelKey = MODEL_KEY) => ({
      model: {
        vendorKey, modelKey, labelZh: LABEL, kind: 'image', enabled: true, createdAt: STAMP, updatedAt: STAMP,
        meta: {
          parameters: [{ key: 'prompt', label: LABEL, default: PROMPT }],
          comfyWorkflowImport: { text: JSON.stringify(WORKFLOW), uiWorkflowText: JSON.stringify({ nodes: [{ widgets_values: [PROMPT, FILE_NAME] }] }), binding: { positivePrompt: { nodeId: '3' } } },
        },
      },
      mapping: {
        id: `map-${vendorKey}-${modelKey}`, vendorKey, modelKey, taskKind: 'text_to_image', name: LABEL, enabled: true, createdAt: STAMP, updatedAt: STAMP,
        create: { method: 'POST', path: '/prompt', body: { prompt: WORKFLOW, extra_data: { extra_pnginfo: { workflow: { nodes: [{ widgets_values: [PROMPT, FILE_NAME] }] } } } } },
      },
    })
    const first = workflowRows('comfyui-local')
    const second = workflowRows('comfyui-local--second-rig', 'comfy-planted-portrait-2')
    const workflowCatalog = {
      version: CURRENT_CATALOG_VERSION,
      vendors: [
        { key: 'comfyui-local', name: 'ComfyUI', enabled: true, baseUrlHint: 'http://127.0.0.1:8188', authType: 'none' },
        { key: 'comfyui-local--second-rig', name: '二号机', enabled: true, baseUrlHint: 'http://192.168.50.60:8188', authType: 'none' },
        { key: 'apimart', name: 'APIMart', enabled: true, baseUrlHint: 'https://api.apimart.ai', authType: 'bearer' },
      ],
      models: [first.model, second.model, { vendorKey: 'apimart', modelKey: 'gpt-5.5', labelZh: 'GPT 5.5', kind: 'text', enabled: true }],
      mappings: [first.mapping, second.mapping, { id: 'seed-apimart-chat', vendorKey: 'apimart', taskKind: 'chat', name: 'GPT', enabled: true, create: { method: 'POST', path: '/v1/chat/completions' } }],
      apiKeysByVendor: { 'comfyui-local--second-rig': { vendorKey: 'comfyui-local--second-rig', apiKey: 'plain-corp-secret', enc: 'plain', enabled: true } },
      suppressedBuiltinModels: [{ vendorKey: 'comfyui-local', modelKey: MODEL_KEY }, { vendorKey: 'apimart', modelKey: 'gpt-4' }],
    }
    const wholeReport = (provider: string | undefined, model: string | undefined): Promise<string> => buildFeedbackReport({
      surface: 'generation', summary: '生成失败', provider, model,
    }, {
      now: new Date(STAMP),
      app: { version: '0.24.0', electron: '43.0.0', node: '22.0.0', chrome: '130' },
      system: { platform: 'darwin', arch: 'arm64', osRelease: '25.5.0', locale: 'zh-CN', timeZone: 'Asia/Shanghai' },
      projectId: 'planted-project',
      readLogTail: () => [`[${STAMP}] WARN  vendor         call vendor=comfyui-local model=${MODEL_KEY} status=500`, `[${STAMP}] WARN  vendor         call vendor=comfyui-local--second-rig model=comfy-planted-portrait-2 status=500`],
      readModelCatalog: () => workflowCatalog,
      readTrajectory: async () => null,
    }).then((report) => JSON.stringify(report))

    it.each([
      ['问题就是这一家', 'comfyui-local', MODEL_KEY],
      ['问题是这一家的第二台', 'comfyui-local--second-rig', 'comfy-planted-portrait-2'],
      ['问题不是这一家', 'apimart', 'gpt-5.5'],
      ['没说是哪一家', undefined, undefined],
    ])('%s：整个包里搜不到提示词、文件名、标签和模型名', async (_name, provider, model) => {
      const text = await wholeReport(provider, model)
      expect(text).toContain('modelsOmitted')
      expect(SECRETS.filter((secret) => text.includes(secret))).toEqual([])
      expect(text).not.toContain('comfy-planted')
    })

    it('这一家的行留着和个数，模型和映射的省略数都算上', () => {
      const projected = project(workflowCatalog, 'comfyui-local')
      const [own, secondRow, cloud] = vendorRows(projected)
      expect(own).toMatchObject({ key: 'comfyui-local', baseUrlHint: 'http://127.0.0.1:8188', modelCount: 1, mappingCount: 1 })
      expect(cloud).not.toHaveProperty('modelCount')
      expect((projected?.models as Row[]).map((row) => row.vendorKey)).toEqual(['apimart'])
      expect((projected?.mappings as Row[])).toEqual([])
      expect(projected?.modelsOmitted).toBe(2)
      expect(projected?.mappingsOmitted).toBe(3)
      expect(projected?.suppressedBuiltinModels).toEqual([{ vendorKey: 'apimart', modelKey: 'gpt-4' }])
      expect(secondRow.key).toBe('comfyui-local--2')
    })

    it('第二台连接：名字换成序号，地址换成标记，也只留个数', () => {
      const [, secondRow] = vendorRows(project(workflowCatalog, 'comfyui-local--second-rig'))
      expect(secondRow).toMatchObject({ key: 'comfyui-local--2', baseUrlHint: '<custom-address>', modelCount: 1, mappingCount: 1 })
      expect(secondRow.name).toBe(BUILTIN_VENDOR_SEEDS.find((seed) => seed.key === 'comfyui-local')?.name)
      expect(project(workflowCatalog)?.apiKeysByVendor).toHaveProperty(['comfyui-local--2', 'enc'], 'plain')
    })

    it('判种子，不判当前地址：本机那家改成局域网地址还算；云端那家改成回环地址也不算', () => {
      const moved = project({
        vendors: [
          { key: 'comfyui-local', baseUrlHint: 'http://192.168.50.60:8188' },
          { key: 'apimart', baseUrlHint: 'http://127.0.0.1:9000' },
        ],
        models: [first.model, { vendorKey: 'apimart', modelKey: 'gpt-5.5', labelZh: 'GPT 5.5', kind: 'text', enabled: true }],
        mappings: [first.mapping],
      }, 'comfyui-local')
      expect(vendorRows(moved)[0]).toMatchObject({ baseUrlHint: '<custom-address>', modelCount: 1, mappingCount: 1 })
      expect((moved?.models as Row[]).map((row) => row.vendorKey)).toEqual(['apimart'])
      expect(moved?.mappings).toEqual([])
      expect(JSON.stringify(moved)).not.toContain(PROMPT)
    })

    it('种子表里本机的家就这几个；新加一个要来这里看一眼', () => {
      expect(BUILTIN_VENDOR_SEEDS.filter(isLocalSeed).map((seed) => seed.key).sort()).toEqual([...LOCAL_SEED_KEYS].sort())
    })

    it.each(LOCAL_SEED_KEYS)('%s：模型和映射都不出门', (key) => {
      const rows = workflowRows(key)
      const projected = project({ vendors: [{ key }], models: [rows.model], mappings: [rows.mapping] }, key)
      expect(vendorRows(projected)[0]).toMatchObject({ key, modelCount: 1, mappingCount: 1 })
      expect(SECRETS.filter((secret) => JSON.stringify(projected).includes(secret))).toEqual([])
    })
  })

  it('不是认识的形状就不带：认不出哪几行是自建，保证不了地址不出门', () => {
    for (const shape of [{ somethingElse: 'gw.corp.example' }, { vendors: 'gw.corp.example' }, ['gw.corp.example'], 'gw.corp.example', null]) {
      expect(project(shape)).toBeNull()
    }
  })

  describe('和日志尾巴两边一致：一家在日志里是 custom，在目录里也是', () => {
    const keys = [
      ...BUILTIN_VENDOR_SEEDS.map((seed) => seed.key),
      'apimart--mini', 'apimart--candidate-0123456789abcdef', 'kie--corp-team',
      'gw-example-com', 'gw-example-com--mini', 'internal-proxy-corp-local', 'comfyui-local-studio', 'local-8080', 'x',
    ]
    it.each(keys)('%s', (key) => {
      const logged = /vendor=(\S+)/.exec(projectLogLine(`[${STAMP}] WARN  vendor         call vendor=${key} status=500`) ?? '')?.[1]
      const [row] = vendorRows(project({ vendors: [{ key, name: key, baseUrlHint: `https://${key}.corp.example` }] }))
      if (logged === 'custom') expect(row.key).toBe('custom')
      else expect(builtinVendorKeyOfKey(String(row.key))).toBe(logged)
    })

    it('表里两种都有', () => {
      const outcomes = new Set(keys.map((key) => vendorRows(project({ vendors: [{ key }] }))[0].key === 'custom'))
      expect(outcomes).toEqual(new Set([true, false]))
    })
  })

  it('清单中英都说自建连接不带地址、本机连接只留个数，也不再说带「各家的接口地址」', () => {
    expect(zhFeedbackReport.manifestItem.modelCatalog).toContain('自建连接只留「是自建」，不带地址')
    expect(zhFeedbackReport.manifestItem.modelCatalog).toContain('本机连接的模型只留个数')
    expect(zhFeedbackReport.manifestItem.modelCatalog).not.toContain('各家的接口地址')
    expect(enFeedbackReport.manifestItem.modelCatalog).toContain('Self-hosted connections show no address')
    expect(enFeedbackReport.manifestItem.modelCatalog).toContain('local ones only model counts')
    expect(enFeedbackReport.manifestItem.modelCatalog).not.toContain('endpoint addresses')
  })
})
