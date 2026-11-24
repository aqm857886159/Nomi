// Native window actions for the isolated foreground-return walkthrough.
const { BrowserWindow } = module.require('electron')
process.on('message', (action) => {
  const win = BrowserWindow.getAllWindows()[0]
  if (action === 'hide') win.hide()
  if (action === 'restore') win.showInactive()
})
