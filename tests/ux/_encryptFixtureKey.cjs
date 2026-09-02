const { app, safeStorage } = require('electron')

app.setPath('userData', process.env.NOMI_ELECTRON_USER_DATA_DIR)
app.whenReady().then(() => {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('safeStorage unavailable')
  process.stdout.write(`${safeStorage.encryptString(String(process.argv[2] || '')).toString('base64')}\n`)
  app.exit(0)
}).catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`)
  app.exit(1)
})
