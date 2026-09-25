// 钉住「真实资料目录」与「付费走查护栏」两个 owner 的判据。全部用合成目录，不碰任何真实资料、不起 App、不花钱。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import {
  REAL_PROFILE_ENV, realNomiProfile, realProfileFingerprint, removeRealCredentials, seedRealCredentials, seedRealModels,
} from './_realProfile.mjs'
import { paidRunRefusal, spendReceipt } from './_paidRun.mjs'

const roots = []
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })
function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-real-profile-test-'))
  roots.push(root)
  return root
}
const writeJson = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)) }
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))

describe('realNomiProfile：三个平台一份判据', () => {
  test('macOS 在 Application Support，钥匙在系统钥匙串（不拷文件）', () => {
    const profile = realNomiProfile({ platform: 'darwin', env: {}, homedir: '/Users/a' })
    expect(profile.userDataDir).toBe('/Users/a/Library/Application Support/nomi')
    expect(profile.catalogPath).toBe('/Users/a/Library/Application Support/nomi/model-catalog.json')
    expect(profile.credentialStoreFiles).toEqual([])
  })
  test('Windows 在 %APPDATA%，钥匙是 userData 里的 Local State（只拷目录就解不开）', () => {
    const profile = realNomiProfile({ platform: 'win32', env: { APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, homedir: 'C:\\Users\\a' })
    expect(profile.userDataDir).toBe('C:\\Users\\a\\AppData\\Roaming\\nomi')
    expect(profile.catalogPath).toBe('C:\\Users\\a\\AppData\\Roaming\\nomi\\model-catalog.json')
    expect(profile.credentialStoreFiles).toEqual(['Local State'])
    expect(realNomiProfile({ platform: 'win32', env: {}, homedir: 'C:\\Users\\a' }).userDataDir).toBe('C:\\Users\\a\\AppData\\Roaming\\nomi')
  })
  test('Linux 走 XDG_CONFIG_HOME，缺省 ~/.config', () => {
    expect(realNomiProfile({ platform: 'linux', env: {}, homedir: '/home/a' }).userDataDir).toBe('/home/a/.config/nomi')
    expect(realNomiProfile({ platform: 'linux', env: { XDG_CONFIG_HOME: '/xdg' }, homedir: '/home/a' }).userDataDir).toBe('/xdg/nomi')
  })
  test('唯一覆盖口优先于平台默认', () => {
    expect(realNomiProfile({ platform: 'darwin', env: { [REAL_PROFILE_ENV]: '/elsewhere' }, homedir: '/Users/a' }).userDataDir).toBe('/elsewhere')
  })
})

/** 一份合成的「真实资料目录」：两家图模型、一把 safeStorage 密文、Windows 钥匙文件。 */
function syntheticRealProfile() {
  const userDataDir = path.join(tempRoot(), 'real')
  writeJson(path.join(userDataDir, 'model-catalog.json'), {
    version: 11,
    vendors: [{ key: 'apimart', enabled: true }, { key: 'plainco', enabled: true }],
    models: [
      { vendorKey: 'apimart', modelKey: 'img-cheap', kind: 'image', labelZh: '便宜图', enabled: true },
      { vendorKey: 'apimart', modelKey: 'img-dear', kind: 'image', enabled: true },
      { vendorKey: 'plainco', modelKey: 'img', kind: 'image', enabled: true },
    ],
    mappings: [{ vendorKey: 'apimart', modelKey: 'img-cheap', taskKind: 'text_to_image', enabled: false }],
    apiKeysByVendor: { apimart: { apiKey: 'SYNTHETIC_CIPHERTEXT', enc: 'safeStorage' }, plainco: { apiKey: 'x', enc: 'plain' } },
  })
  fs.writeFileSync(path.join(userDataDir, 'Local State'), '{"synthetic":true}')
  return { ...realNomiProfile({ env: { [REAL_PROFILE_ENV]: userDataDir } }), credentialStoreFiles: ['Local State'] }
}

function isolatedCopy() {
  const root = tempRoot()
  const settingsDir = path.join(root, 'settings')
  const userDataDir = path.join(root, 'user-data')
  writeJson(path.join(settingsDir, 'model-catalog.json'), {
    version: 8, vendors: [], mappings: [], apiKeysByVendor: {},
    models: [{ vendorKey: 'fixture', modelKey: 'fixture-img', kind: 'image', published: true, enabled: true }],
  })
  return { settingsDir, userDataDir }
}

describe('把真实凭据带进隔离副本', () => {
  test('整份目录 + 钥匙文件一起拷，原库一字不动', () => {
    const profile = syntheticRealProfile()
    const before = realProfileFingerprint(profile)
    const { settingsDir, userDataDir } = isolatedCopy()
    expect(seedRealCredentials({ settingsDir, userDataDir, profile })).toEqual({ catalog: 'model-catalog.json', credentialStore: ['Local State'] })
    expect(fs.readFileSync(path.join(userDataDir, 'Local State'), 'utf8')).toBe('{"synthetic":true}')
    expect(readJson(path.join(settingsDir, 'model-catalog.json')).version).toBe(11)
    expect(realProfileFingerprint(profile)).toEqual(before)
  })

  test('只装点名的那一个：同类别的其余生成模型停掉，新卡默认就是它', () => {
    const profile = syntheticRealProfile()
    const { settingsDir, userDataDir } = isolatedCopy()
    const seeded = seedRealModels({ settingsDir, userDataDir, profile, models: [{ vendorKey: 'apimart', modelKey: 'img-cheap' }] })
    expect(seeded).toEqual([{ vendorKey: 'apimart', modelKey: 'img-cheap', kind: 'image', labelZh: '便宜图' }])
    const catalog = readJson(path.join(settingsDir, 'model-catalog.json'))
    expect(catalog.apiKeysByVendor).toEqual({ apimart: { apiKey: 'SYNTHETIC_CIPHERTEXT', enc: 'safeStorage' } })
    expect(catalog.models.find((model) => model.modelKey === 'img-cheap')).toMatchObject({ published: true, enabled: true })
    expect(catalog.models.find((model) => model.modelKey === 'fixture-img')).toMatchObject({ published: false, enabled: false })
    expect(catalog.mappings).toEqual([{ vendorKey: 'apimart', modelKey: 'img-cheap', taskKind: 'text_to_image', enabled: true }])
    expect(readJson(path.join(settingsDir, 'generation-model-defaults.json')).byTaskKind.text_to_image).toEqual({ vendorKey: 'apimart', modelKey: 'img-cheap' })
    expect(fs.existsSync(path.join(userDataDir, 'Local State'))).toBe(true)
  })

  test('明文 key 的供应商 fail-closed，不往副本里写任何东西', () => {
    const profile = syntheticRealProfile()
    const { settingsDir, userDataDir } = isolatedCopy()
    const before = fs.readFileSync(path.join(settingsDir, 'model-catalog.json'), 'utf8')
    expect(() => seedRealModels({ settingsDir, userDataDir, profile, models: [{ vendorKey: 'plainco', modelKey: 'img' }] })).toThrow(/safeStorage/)
    expect(fs.readFileSync(path.join(settingsDir, 'model-catalog.json'), 'utf8')).toBe(before)
  })

  test('收尾删掉整族目录文件（含 App 升级留下的备份）和钥匙，别的证据留着', () => {
    const profile = syntheticRealProfile()
    const { settingsDir, userDataDir } = isolatedCopy()
    seedRealCredentials({ settingsDir, userDataDir, profile })
    for (const name of ['model-catalog.bak.json', 'model-catalog.v11.bak.json']) fs.writeFileSync(path.join(settingsDir, name), '{"apiKeysByVendor":{}}')
    fs.writeFileSync(path.join(settingsDir, 'preferences.json'), '{}')
    expect(removeRealCredentials({ settingsDir, userDataDir, profile })).toBe(true)
    expect(fs.readdirSync(settingsDir).sort()).toEqual(['preferences.json'])
    expect(fs.existsSync(path.join(userDataDir, 'Local State'))).toBe(false)
  })

  test('指纹随内容变：原库被写过一定看得出来', () => {
    const profile = syntheticRealProfile()
    const before = realProfileFingerprint(profile)
    fs.appendFileSync(profile.catalogPath, ' ')
    expect(realProfileFingerprint(profile)['model-catalog.json']).not.toBe(before['model-catalog.json'])
    expect(realProfileFingerprint(profile)['Local State']).toBe(before['Local State'])
  })
})

describe('付费走查的闸', () => {
  test('CI 拒、没显式开关拒、用户 Nomi 开着拒，三条都过才放行', () => {
    expect(paidRunRefusal('x', { env: { CI: 'true', NOMI_SPEND_OK: '1' } })).toMatch(/CI/)
    expect(paidRunRefusal('x', { env: {} })).toMatch(/NOMI_SPEND_OK=1/)
    expect(paidRunRefusal('x', { env: { NOMI_SPEND_OK: 'yes' } })).toMatch(/NOMI_SPEND_OK=1/)
    expect(paidRunRefusal('x', { env: { NOMI_SPEND_OK: '1' }, nomiRunning: true })).toMatch(/Nomi 正开着/)
    expect(paidRunRefusal('x', { env: { NOMI_SPEND_OK: '1' }, nomiRunning: false })).toBeNull()
  })

  test('收据按供应商任务号去重：画布与制作 Run 记的同一笔只算一次', () => {
    const projectRoot = tempRoot()
    writeJson(path.join(projectRoot, '.nomi', 'project.json'), { payload: { generationCanvas: { nodes: [
      { id: 'a', kind: 'image', meta: { modelVendor: 'v', modelKey: 'm' }, runs: [{ id: 'r1', status: 'success', taskId: 't1' }],
        result: { taskId: 't1', provenance: { cost: { amount: 1, currency: 'credits', unit: 'actual' } } } },
      { id: 'b', kind: 'video', meta: {}, runs: [{ id: 'r2', status: 'success' }] },
    ] } } })
    writeJson(path.join(projectRoot, '.nomi', 'runs', 'op-1', 'run.json'), { run: { runId: 'op-1', createdAt: '1', jobs: [
      { jobId: 'j1', nodeId: 'b', provider: 'v', model: 'video', providerTaskId: 't2', status: 'adopted' },
      { jobId: 'j0', nodeId: 'b', provider: 'v', model: 'video', status: 'authorized' },
    ] } })
    const receipt = spendReceipt(projectRoot)
    expect(receipt.media.map((entry) => [entry.source, entry.taskId]).sort()).toEqual([['canvas', 't1'], ['production-run', 't2']])
    expect(receipt.media.find((entry) => entry.taskId === 't1').providerCost).toEqual({ amount: 1, currency: 'credits', unit: 'actual' })
  })
})
