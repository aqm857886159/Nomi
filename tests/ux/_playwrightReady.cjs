const { app } = module.require('electron')

if (typeof globalThis.__playwright_run !== 'function') {
  throw new Error('Playwright ready loader was not installed before the app entry')
}

// The official loader selects mock credential backends; keep the caller's existing backend instead.
for (const name of ['use-mock-keychain', 'password-store']) {
  const requested = process.argv.findLast((arg) => arg === `--${name}` || arg.startsWith(`--${name}=`))
  app.commandLine.removeSwitch(name)
  if (requested) app.commandLine.appendSwitch(name, requested.slice(name.length + 3))
}
