/**
 * Paste this in Nomi desktop DevTools Console after app boots.
 * Verifies M5.1-M5.4 paths end-to-end without needing GUI clicks.
 *
 * Usage:
 *   open DevTools (Cmd+Opt+I) → Console → paste this whole file
 */
(async () => {
  const D = window.nomiDesktop
  if (!D) {
    console.error('✗ nomiDesktop bridge missing — preload didn\'t load')
    return
  }
  console.log('▶ Nomi smoke probe starting…')

  // 1. Catalog should have auto-migrated v1→v2 on first read
  const vendors = await D.modelCatalog.listVendors()
  console.log(`✓ vendors loaded: ${vendors.length} (`, vendors.map(v => v.key), ')')

  // 2. Seeded models should appear
  const models = await D.modelCatalog.listModels()
  console.log(`✓ models loaded: ${models.length} (`, models.map(m => m.modelKey), ')')

  // 3. Health check
  const h = await D.modelCatalog.health()
  console.log('✓ catalog health:', h)

  // 4. Onboarding bridge wired?
  if (D.onboarding && typeof D.onboarding.start === 'function') {
    console.log('✓ onboarding bridge present')
  } else {
    console.error('✗ onboarding bridge missing')
  }

  // 5. Check if we have an api key for any vendor (shouldn\'t — fresh install)
  const apiKeyless = vendors.filter(v => !v.hasApiKey)
  console.log(`ⓘ ${apiKeyless.length}/${vendors.length} vendors need a key (expected on fresh install)`)

  console.log('▶ Probe done. If all ✓ — wizard path should work end-to-end.')
})()
