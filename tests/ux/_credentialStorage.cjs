const { app, safeStorage, ipcMain } = module.require('electron')

const mode = process.env.NOMI_WALK_CREDENTIAL_SOURCE
if (mode !== 'synthetic' && mode !== 'real') throw new Error('Missing or invalid walk credential source')
const args = JSON.parse(process.env.NOMI_WALK_CREDENTIAL_ARGS || '[]')
if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string' || !/^--(password-store|use-mock-keychain)(=|$)/.test(arg))) {
  throw new Error('Invalid credential backend arguments')
}
if (mode === 'synthetic' && process.platform !== 'win32' && !args.length) throw new Error('Synthetic credential source requires backend arguments')
// Playwright's loader injects defaults; replay only the already-decided source contract.
for (const name of ['use-mock-keychain', 'password-store']) app.commandLine.removeSwitch(name)
for (const arg of args) {
  const [name, ...value] = arg.slice(2).split('=')
  app.commandLine.appendSwitch(name, value.join('='))
}

function available() {
  try { return safeStorage.isEncryptionAvailable() } catch { return false }
}
function diagnostic(reason, secrets = []) {
  let safe = String(reason)
  for (const secret of secrets) if (secret) safe = safe.split(secret).join('[redacted]')
  safe = safe.replace(/[A-Za-z0-9+/=_-]{16,}/g, '[redacted]')
  process.stderr.write(`[walk credential-storage] mode=${mode} platform=${process.platform} available=${available()} reason=${safe}\n`)
}
function initialize() {
  if (mode !== 'synthetic') return
  try {
    if (process.platform === 'linux') safeStorage.setUsePlainTextEncryption(true)
    if (!safeStorage.isEncryptionAvailable()) throw new Error('safeStorage unavailable')
  } catch (error) {
    diagnostic(error?.message || 'safeStorage initialization failed')
    throw error
  }
}
if (app.isReady()) initialize()
else app.prependOnceListener('ready', initialize)

const encryptString = safeStorage.encryptString?.bind(safeStorage)
if (encryptString) safeStorage.encryptString = (value) => {
  try { return encryptString(value) }
  catch (error) { diagnostic(error?.message || 'safeStorage encryption failed', [value]); throw error }
}

// Observe the real save handler without changing its result or swallowing its error.
const handle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, handler) => handle(channel, channel !== 'nomi:model-catalog:vendor-api-key:upsert' ? handler : async (...params) => {
  const secrets = [params[2]?.apiKey]
  try {
    const result = await handler(...params)
    if (result?.ok === false) diagnostic(result.error?.message || result.error || 'credential save rejected', secrets)
    return result
  } catch (error) {
    diagnostic(error?.message || 'credential save failed', secrets)
    throw error
  }
})
