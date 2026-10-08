import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const editor = fs.readFileSync(path.join(process.cwd(), 'src/ui/onboarding/CustomCallEditor.tsx'), 'utf8')
const testRunHook = fs.readFileSync(path.join(process.cwd(), 'src/ui/onboarding/useCustomCallTestRun.ts'), 'utf8')
const scopeSelector = fs.readFileSync(path.join(process.cwd(), 'src/ui/onboarding/CustomCallScopeSelector.tsx'), 'utf8')
const scopeSource = `${editor}\n${scopeSelector}`

describe('CustomCallEditor mode scripts', () => {
  it('renders an explicit scope selector and keeps direct drafts on fallback only', () => {
    expect(editor).toContain('resolveCustomCallScriptModes(catalogModel, !target?.draft)')
    expect(scopeSource).toContain('<NomiSelect')
    expect(scopeSource).toContain('scopeConfigured')
    expect(scopeSource).not.toContain('role="radiogroup"')
    expect(scopeSource).not.toContain('role="radio"')
    expect(scopeSource).toContain('scopeFallback')
    expect(editor).toContain('customCall.aiHelpTitle')
    expect(editor).toContain('customCall.templatesMenu')
  })

  it('sends the selected mode context to both AI generation and test-run', () => {
    expect(`${editor}\n${testRunHook}`.match(/taskKind: selectedMode\.taskKind/g)?.length).toBeGreaterThanOrEqual(3)
    expect(`${editor}\n${testRunHook}`.match(/modeId: selectedMode\.id/g)?.length).toBeGreaterThanOrEqual(3)
    expect(testRunHook).toContain('runId: testRunId')
    expect(testRunHook).toContain('const result = snapshot?.result')
    expect(testRunHook).toContain('generation !== generationRef.current')
  })

  it('lets the user stop a trial and cancels stale trials when script context changes', () => {
    expect(editor).toContain('const runOrCancelTest = React.useCallback')
    expect(editor).toContain('await cancelTest()')
    expect(editor).toContain('persistVendorConfig()')
    expect(editor).toContain('await runTest()')
    expect(editor).toContain('void runOrCancelTest()')
    expect(testRunHook).toContain('customCallTestCancel?.({ runId: activeRunId })')
    expect(testRunHook).toContain('customCallTestCancel({ runId: testRunId })')
  })

  it('saves and removes only the selected scope', () => {
    expect(editor).toContain('customCall: customCallScriptPatch(selectedModeId, trimmed)')
    expect(editor).toContain("customCallScriptPatch(selectedModeId, '')")
    expect(editor).not.toContain('customCall: null')
  })

  it('saves only after a successful test and continues media drafts into capability setup', () => {
    expect(editor).toContain("const testPassed = test.phase === 'done' && test.ok")
    expect(editor).toContain('const saveTestedScript = React.useCallback')
    expect(editor).toContain('onPrimary: saveTestedScript')
    expect(editor).toContain('requiresCapabilitySetup && onContinueCapability')
    expect(editor).toContain('customCall.saveAndContinueCapability')
    expect(editor).toContain("customCall.saveScope', { scope: selectedScopeLabel }")
    expect(editor).toContain('onClick={saveDraft}')
    expect(editor).toContain('enabled: false')
  })

  it('publishes persisted script and config edits to the shared unsaved-change contract', () => {
    expect(editor).toContain('customCallPersistedStateSignature(scriptDrafts, configRows)')
    expect(editor).toContain("initialPersistedState.targetKey === targetKey")
    expect(editor).toContain("data-settings-unsaved={dirty ? 'true' : undefined}")
  })
})
