import { describe, expect, it } from 'vitest'
import { ESLint } from 'eslint'

const lint = new ESLint()
const channelRule = 'hosting-channel-owner/no-restricted-syntax'
const settingRule = 'hosting-setting-owner/no-restricted-syntax'
const retiredRule = 'hosting-consent-retired/no-restricted-syntax'
const cases = [
  ['caller allow', 'const options = { anonymousAssetHostingConsent: "allow" }', 'electron/catalog/customCallDispatch.ts', retiredRule],
  ['channel reference outside loop', 'import { ANON_UPLOAD_CHAIN } from "./assetIngestionRegistry"', 'electron/catalog/customCallDispatch.ts', channelRule],
  ['hardcoded address', 'const url = "https://tmpfiles.org/api/v1/upload"', 'electron/catalog/customCallDispatch.ts', channelRule],
  ['settings write outside settings', 'policy.set({ anonymousAssetHosting: "allow" })', 'src/workbench/NomiStudioApp.tsx', settingRule],
  ['computed settings write', 'policy.set({ ["anonymousAssetHosting"]: "allow" })', 'src/workbench/NomiStudioApp.tsx', settingRule],
  ['handover consent', 'const request = { hostingAllowed: true }', 'electron/capabilityCore/canvasHandOver.ts', retiredRule],
  ['confirmation UI', 'const notice = <div data-hosting-disclosure>Remember my choice</div>', 'src/workbench/generationCanvas/spend/SpendConfirmDialog.tsx', retiredRule],
  ['confirmation disclosure', 'const card = { hostingDisclosure: {} }', 'src/workbench/generationCanvas/spend/spendConfirm.ts', retiredRule],
] as const

describe('hosting ownership boundary', () => {
  it.each(cases)('%s is rejected', async (_name, code, filePath, rule) => {
    const [result] = await lint.lintText(code, { filePath })
    expect(result.messages.some(message => message.ruleId === rule && message.severity === 2)).toBe(true)
  })
  it.each([
    ['const candidate = ANON_UPLOAD_CHAIN', 'electron/catalog/assetLocalization.ts', channelRule],
    ['onChange({ anonymousAssetHosting: checked ? "allow" : "ask" })', 'src/workbench/settings/AiModelsSection.tsx', settingRule],
    ['const value = settings.anonymousAssetHosting', 'src/workbench/ai/v4/agentPanelSpendCard.ts', settingRule],
    ['const channel = { visibility: "public-provider" }', 'electron/catalog/customCallDispatch.ts', channelRule],
  ])('allows the owner or a read: %s', async (code, filePath, rule) => {
    const [result] = await lint.lintText(code, { filePath })
    expect(result.messages.filter(message => message.ruleId === rule)).toEqual([])
  })
})
