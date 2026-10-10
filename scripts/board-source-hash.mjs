// 板源哈希：门岗默认模式用它判断「板改了没有」，不需要起浏览器。
// 哈希覆盖一张板的全部板源文件（亮 / 暗预览 + 画板源码 + 共用的画布布局），任一字节变了哈希就变。
// 只依赖 node:crypto / node:fs，不 import playwright（门岗默认路径靠这一点保持无浏览器）。
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

/** 一张板参与哈希的文件（相对板目录）。 */
export function boardSourceFileNames(board) {
  return [`preview/${board}.html`, `preview/${board}-dark.html`, `source/${board}.dc.html`, 'source/canvas.json']
}

/**
 * 纯函数：files 是 { 相对路径: 内容 | null }（null = 文件不存在）。
 * 按路径排序后逐个写入「路径 + 长度 + 内容」，保证同样的字节得到同样的哈希，且拼接边界不会混淆。
 */
export function hashBoardSourceFiles(files) {
  const hash = createHash('sha256')
  for (const name of Object.keys(files).sort()) {
    const content = files[name]
    if (content === null) {
      hash.update(`${name}\0missing\0`)
    } else {
      const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8')
      hash.update(`${name}\0${buf.length}\0`)
      hash.update(buf)
    }
  }
  return hash.digest('hex')
}

/** 读取一张板的源文件并算哈希。boardsDir 是 docs/design/boards/<日期> 目录。 */
export function hashBoardSource(boardsDir, board) {
  const files = {}
  for (const name of boardSourceFileNames(board)) {
    const file = path.join(boardsDir, name)
    files[name] = fs.existsSync(file) ? fs.readFileSync(file) : null
  }
  return hashBoardSourceFiles(files)
}
