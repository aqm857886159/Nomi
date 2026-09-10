/**
 * [INPUT]: 依赖 ./directorTypes 的 DirectorAssetKind
 * [OUTPUT]: 对外提供 assetKindOfFileName(name, mimeType?) → DirectorAssetKind | null、ASSET_UPLOAD_ACCEPT
 * [POS]: director/model 的资产类型判定单一真相（资产库上传与画布连线引用共用）：按后缀分模型（glb/gltf/fbx）/ 泼溅（ply/spz/splat/ksplat/sog）/
 *        场景 JSON，图片按 MIME 判全景；判不出 = 不支持。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { DirectorAssetKind } from './directorTypes'

export const ASSET_UPLOAD_ACCEPT = '.glb,.gltf,.fbx,.ply,.spz,.splat,.ksplat,.sog,.json,image/*'

export function assetKindOfFileName(name: string, mimeType: string = ''): DirectorAssetKind | null {
  const clean = name.split(/[?#]/)[0].toLowerCase()
  if (/\.(glb|gltf|fbx)$/.test(clean)) return 'model'
  if (/\.(ply|spz|splat|ksplat|sog)$/.test(clean)) return 'splat'
  if (clean.endsWith('.json')) return 'scene'
  if (mimeType.startsWith('image/') || /\.(png|jpe?g|webp|avif|hdr|exr)$/.test(clean)) return 'panorama'
  return null
}
