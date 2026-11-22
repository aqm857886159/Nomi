import assert from 'node:assert/strict'
import { expect } from '@playwright/test'
import { stationTimeout } from './_station-budget.mjs'

export const LOCK_EXIT_JOURNEY_CONDITIONS = Object.freeze({ anonymousAssetHosting: 'ask', hostedUploads: true, localReferenceUpload: true })

export async function applyLockExitJourneyConditions(page) {
  await page.evaluate(async conditions => {
    const policy = window.nomiDesktop.settings.automationPolicy
    await policy.set({ ...await policy.get(), anonymousAssetHosting: conditions.anonymousAssetHosting })
  }, LOCK_EXIT_JOURNEY_CONDITIONS)
}

/** Wait for the actual action; a single user run may have no card. */
export async function confirmLockExitSpend(page, report, { until, context = 'generation' } = {}) {
  const dialog = page.locator('[data-spend-confirm-dialog]')
  await expect.poll(async () => {
    let confirmed = false
    if (await dialog.isVisible()) {
      assert.equal(await dialog.count(), 1, 'Only one spend card may be open')
      const hostingDisclosure = await page.locator('[data-spend-confirm-dialog] [data-hosting-disclosure]').isVisible()
      report.observations ??= { batchConfirmations: [], hostingConsents: [] }
      if (context.startsWith('batch')) report.observations.batchConfirmations.push({ context, hostingDisclosure })
      assert.equal(hostingDisclosure, false, 'Per-run hosting disclosure is retired')
      await page.locator('[data-spend-confirm-dialog] [data-spend-confirm-action="confirm"]').click()
      await dialog.waitFor({ state: 'hidden' })
      confirmed = true
    }
    return until ? await until() : confirmed
  }, { timeout: stationTimeout({ turns: 1 }) }).toBe(true)
}

export function assertLockExitHostingReceipt(receipt) {
  assert.deepEqual(receipt.report?.journeyConditions, LOCK_EXIT_JOURNEY_CONDITIONS, 'Paid and free journey conditions must match')
  assert.ok(receipt.report?.observations?.batchConfirmations?.length > 0, 'Rehearsal must exercise batch confirmation')
  assert.ok(receipt.report.observations.batchConfirmations.every(value => value.hostingDisclosure === false), 'Hosting disclosure is retired')
}
