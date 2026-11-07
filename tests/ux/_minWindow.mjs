// 最小窗的唯一来源：electron/mainWindowMinSize.json（主进程 BrowserWindow 的 minWidth / minHeight 也读它）。
// 走查要「缩到最小也测」时从这里拿数，不许各自写 1100 / 700（WindowNarrow 板 narrow.min-size）。
import fs from 'node:fs'
import path from 'node:path'

const file = path.resolve(import.meta.dirname, '../../electron/mainWindowMinSize.json')
const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
if (!(parsed.width > 0) || !(parsed.height > 0)) throw new Error(`读不到最小窗：${file}`)

export const MIN_WINDOW = Object.freeze({ width: parsed.width, height: parsed.height })
export const MIN_WINDOW_SOURCE = 'electron/mainWindowMinSize.json（主进程 minWidth / minHeight 同读这一份）'
