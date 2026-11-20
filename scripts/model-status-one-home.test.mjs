import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'
import { scanAvailabilityBypasses } from './check-model-availability.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const lint = new ESLint({ cwd: root })
const list = 'src/ui/onboarding/ModelSettingsHome.tsx'
const detail = 'src/ui/onboarding/CustomVendorCard.tsx'
const red = [
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

function productionFiles(dir) {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(entry => {
    const relative = `${dir}/${entry.name}`
    if (entry.isDirectory()) return productionFiles(relative)
    return /\.tsx?$/.test(relative) && !/\.(test|spec|d)\.tsx?$/.test(relative) ? [relative] : []
  })
}
it('every production exit has zero retired inputs, status words or preflight calls', () => {
  const findings = ['src', 'electron'].flatMap(productionFiles).flatMap(file => scanAvailabilityBypasses(file, fs.readFileSync(path.join(root, file), 'utf8')))
  expect(findings).toEqual([])
})
