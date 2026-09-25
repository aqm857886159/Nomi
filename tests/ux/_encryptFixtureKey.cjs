const { app, safeStorage } = require('electron')

app.setName(String(process.env.NOMI_APP_NAME || 'Nomi'))
app.setPath('userData', process.env.NOMI_ELECTRON_USER_DATA_DIR)
app.whenReady().then(() => {
  if (process.env.NOMI_E2E_SYNTHETIC_CREDENTIAL_STORAGE === '1' && process.platform === 'linux') {
    safeStorage.setUsePlainTextEncryption(true)
  }
  if (!safeStorage.isEncryptionAvailable()) throw new Error('safeStorage unavailable')
  process.stdout.write(`${safeStorage.encryptString(String(process.argv[2] || '')).toString('base64')}\n`)
  // 正常退出（quit），不是 exit(0)：Windows 上 safeStorage 的密钥只在 `Local State` 里，而它要在正常关机时才落盘。
  // exit(0) 跳过了这一步——密钥没写下来，被测 App 用同一个 user-data 目录永远解不开，apimart/higgsfield
  // 夹具的模型在 Windows 上一律 credential_locked（2026-09-26 实测：目录里连 Local State 都没有）。
  app.quit()
}).catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`)
  app.exit(1)
})
