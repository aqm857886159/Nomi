/**
 * [INPUT]: 依赖 ./panoramaImport 的 ImageDimensions 类型
 * [OUTPUT]: 对外提供 readImageDimensions(src)、readFileAsDataUrl(file)、PANORAMA_ACCEPT
 * [POS]: director/panels 的图片文件小工具：全景导入与资产库上传共用。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { ImageDimensions } from './panoramaImport'

export const PANORAMA_ACCEPT = 'image/*'

export function readImageDimensions(src: string): Promise<ImageDimensions> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => reject(new Error('image dimensions unreadable'))
    image.src = src
  })
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => (typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('file read failed')))
    reader.onerror = () => reject(reader.error ?? new Error('file read failed'))
    reader.readAsDataURL(file)
  })
}
