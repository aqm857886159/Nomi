if (typeof globalThis.__playwright_run !== 'function') {
  throw new Error('Playwright ready loader was not installed before the app entry')
}

// Consume the same profile source before the app can read or save credentials.
module.require('./_credentialStorage.cjs')
