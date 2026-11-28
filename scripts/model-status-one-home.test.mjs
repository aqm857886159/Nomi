import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'
import {
  CATALOG_BINDING,
  OWNER,
  OWNER_SYMBOLS,
  READERS,
  RENDERER_GATE,
  VENDOR_CONNECTION_PREDICATES,
  scanAvailabilityBypasses,
  scanSource,
} from './model-status-one-home.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const lint = new ESLint({ cwd: root })
const list = 'src/ui/onboarding/ModelSettingsHome.tsx'
const detail = 'src/ui/onboarding/CustomVendorCard.tsx'
const red = [
  ['src/ui/onboarding/VendorOnboardCard.tsx', 'const subtitle = t("onboardingProviders.vendorCard.modelsAvailable", {count: models.filter(m => m.enabled).length})'],
  ['src/desktop/onboardingBridgeTypes.ts', 'type Bridge = { testConnection: () => Promise<void> }'],
  [list, `const color = model.availability.usable ? 'text-workbench-success' : 'text-workbench-danger'`],
  ['electron/main.ts', 'const rows = listModelCatalogModels(params)'],
  ['electron/runtime.ts', 'if (credential.verificationPending) await probeDirectKeyCredential(input)'],
  ['electron/textTaskRunner.ts', 'if (record["verificationPending"]) throw Error("verify first")'],
  ['electron/providerAdapter/serviceCatalog.ts', 'await deps.revalidatePendingCredential(input)'],
  [list, 'const state = model.meta?.adapter?.state'],
  [detail, 'const pending = vendor.credentialVerificationPending'],
  [list, 'const label = t("onboardingProviders.modelStatus.ready")'],
  [detail, 'const label = t("onboardingProviders.adapterVerification.cardStatus.failed")'],
  [list, 'const label = t("onboardingProviders.keyOnly.pendingTitle")'],
  ['electron/preload.ts', 'const channel = "nomi:onboarding:test-connection"'],
  [list, 'const label = t("parameters.untried")'],
]
describe('the four acceptance escapes fail through the actual gate and ESLint rule', () => {
  it.each(red)('%s: %s', async (filePath, source) => {
    expect(scanAvailabilityBypasses(filePath, source).length).toBeGreaterThan(0)
    const [result] = await lint.lintText(source, { filePath: path.join(root, filePath) })
    expect(result.messages.some(message => message.ruleId === 'nomi/model-status-one-home')).toBe(true)
  })
  it.each([
    [list, 'const usable = models.filter(m => m.availability.usable && m.kind === "text")'],
    [detail, 'const s = presentConnectionStatus({ models }); const badge = <ModelStatusMark status={s} variant="pill" />'],
    ['src/ui/onboarding/ModelAdapterStatusSection.tsx', 'const s = presentModelStatus(model); const color = TONES[s.tone]'],
    ['electron/providerAdapter/serviceCatalog.ts', 'const state = model.meta.adapter.state'],
    ['src/ui/onboarding/workflowPage/ComfyuiWorkflowSettingsPage.tsx', 'const verificationPending = workflow.pending'],
  ])('legitimate neighbour stays green: %s', (filePath, source) => {
    expect(scanAvailabilityBypasses(filePath, source)).toEqual([])
  })
})

describe('second availability predicate (CREDENTIAL && PUBLICATION) folded from check:model-availability', () => {
  it.each([
    ['src/workbench/ai/rogueAvailabilityA.ts', 'export const ok = (model: any, vendor: any) => model.enabled && model.published && vendor.hasApiKey'],
    ['src/workbench/rogueAvailabilityB.ts', 'export const usable = (vendor: any, row: any) => vendor.enabled && (vendor.authType === "none" || vendor.hasApiKey) && row.published'],
    ['electron/catalog/rogueAvailabilityC.ts', 'export const x = (m: any, e: any, rec: any, modelHasPublishedExecution: any, apiKeyDecryptStatus: any) => modelHasPublishedExecution(m, e) && apiKeyDecryptStatus(rec) === "ok"'],
  ])('catches second availability predicate in %s via scanSource and ESLint rule', async (filePath, source) => {
    expect(scanSource(filePath, source)).toHaveLength(1)
    const [result] = await lint.lintText(source, { filePath: path.join(root, filePath) })
    expect(result.messages.some(message => message.ruleId === 'nomi/model-status-one-home' && message.severity === 2)).toBe(true)
  })

  it('counts nested conjunctions once at outermost expression', () => {
    expect(scanSource('src/d.ts', 'const x = a && (b.published && c.hasApiKey) && d')).toHaveLength(1)
  })

  it.each([
    ['src/fixture.ts', 'export const row = { published: true, publishedModes: [], hasApiKey: true, enabled: true }'],
    ['src/imports.ts', 'import { apiKeyDecryptStatus, decryptApiKeyRecord } from "./secrets"\nimport { derivePublishedExecution } from "../shared/modelPublication"\nexport const keep = [apiKeyDecryptStatus, decryptApiKeyRecord, derivePublishedExecution]'],
    ['src/role.ts', 'export const fits = (model: any, modelSupportsToolCalls: any) => model.kind === "text" && modelSupportsToolCalls(model.meta)'],
    ['src/fixed.ts', 'export const rows = (models: any[]) => models.filter((m) => m.availability.usable && m.kind === "text")'],
    ['src/cred.ts', 'export const has = (vendor: any) => Boolean(vendor.hasApiKey) || vendor.authType === "none"'],
    [OWNER, 'export const ok = (vendor: any, model: any) => vendor.hasApiKey && model.published'],
    [CATALOG_BINDING, 'export const ok = (vendor: any, model: any) => vendor.hasApiKey && model.published'],
    ['electron/catalog/catalogHealth.ts', 'export const ok = (vendor: any, model: any) => vendor.hasApiKey && model.published'],
  ])('does not false-positive legitimate neighbour or owner/exempt file: %s', async (filePath, source) => {
    const [result] = await lint.lintText(source, { filePath: path.join(root, filePath) })
    expect(result.messages.filter(message => message.ruleId === 'nomi/model-status-one-home')).toEqual([])
  })
})

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('availability owner, 18 readers, and VENDOR_CONNECTION_PREDICATES wiring stay intact', () => {
  it('keeps owner, catalog binding, renderer gate, and all READERS wired to OWNER_SYMBOLS', () => {
    for (const required of [OWNER, CATALOG_BINDING, RENDERER_GATE]) {
      expect(fs.existsSync(path.join(root, required)), `missing ${required}`).toBe(true)
    }
    const ownerSource = fs.readFileSync(path.join(root, OWNER), 'utf8')
    expect(ownerSource).toContain('export function deriveModelAvailability')
    expect(ownerSource).toContain('export const MODEL_UNUSABLE_REASONS')

    expect(READERS.length).toBeGreaterThanOrEqual(15)
    for (const reader of READERS) {
      expect(reader.file.length).toBeGreaterThan(0)
      expect(reader.question.length).toBeGreaterThan(4)
      expect(reader.reads.length).toBeGreaterThan(0)
      const full = path.join(root, reader.file)
      expect(fs.existsSync(full), `reader missing: ${reader.file}`).toBe(true)
      const code = stripComments(fs.readFileSync(full, 'utf8'))
      expect(
        OWNER_SYMBOLS.some(symbol => code.includes(symbol)),
        `${reader.file} no longer references any OWNER_SYMBOLS`,
      ).toBe(true)
    }
  })

  it('keeps VENDOR_CONNECTION_PREDICATES documented and free of stale exemptions', () => {
    for (const [file, reason] of Object.entries(VENDOR_CONNECTION_PREDICATES)) {
      expect(reason.length, `${file} reason too short`).toBeGreaterThan(10)
      const full = path.join(root, file)
      expect(fs.existsSync(full), `exempt file missing: ${file}`).toBe(true)
      const hits = scanSource(file, fs.readFileSync(full, 'utf8'))
      expect(hits.length, `stale VENDOR_CONNECTION_PREDICATES entry: ${file}`).toBeGreaterThan(0)
    }
  })
})

function productionFiles(dir) {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(entry => {
    const relative = `${dir}/${entry.name}`
    if (entry.isDirectory()) return productionFiles(relative)
    return /\.tsx?$/.test(relative) && !/\.(test|spec|d)\.tsx?$/.test(relative) ? [relative] : []
  })
}
it('every production exit has zero retired inputs, status words, preflight calls, or unregistered second predicates', () => {
  const files = ['src', 'electron'].flatMap(productionFiles)
  const bypasses = files.flatMap(file => scanAvailabilityBypasses(file, fs.readFileSync(path.join(root, file), 'utf8')))
  expect(bypasses).toEqual([])
  const unregisteredPredicates = files
    .filter(file => file !== OWNER && file !== CATALOG_BINDING && !(file in VENDOR_CONNECTION_PREDICATES))
    .flatMap(file => scanSource(file, fs.readFileSync(path.join(root, file), 'utf8')))
  expect(unregisteredPredicates).toEqual([])
})
