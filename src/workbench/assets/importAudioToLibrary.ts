// 音频文件 → 项目素材库的导入（纯落项目文件，不建画布节点）。
//
// 为什么独立成路：图片/视频导入走 importLocalMediaFilesToGenerationCanvas（建画布素材节点，
// 可拖到画布）；音频没有画布节点 archetype（canvasNodeToAssetRef 本就排除 audio），它从「项目
// 文件」这条源进素材池——生成的 TTS 音频就是这么进音频 tab 的。所以音频上传只需落项目文件，
// 落盘后 uniqueAssetPath 保留原扩展名（.mp3/.wav/.m4a…），workspace 索引按扩展名归类成 audio。

import { importWorkbenchLocalAssetFile } from '../api/assetUploadApi'

// 音频通常远小于视频；给个宽松上限，挡住误选的超大文件。
export const ASSET_LIBRARY_AUDIO_IMPORT_MAX_BYTES = 200 * 1024 * 1024

const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'flac', 'opus', 'weba'])

/** 文件是否音频：MIME 优先，缺 MIME 时回落扩展名（部分系统拖来的音频 file.type 为空）。 */
export function isAudioFile(file: File): boolean {
  const type = (file.type || '').toLowerCase()
  if (type.startsWith('audio/')) return true
  if (type) return false
  const ext = (file.name.split('.').pop() || '').toLowerCase()
  return AUDIO_EXTENSIONS.has(ext)
}

function audioSignature(file: File): string {
  return [file.name || '', file.type || '', typeof file.size === 'number' ? file.size : 0].join('|')
}

export type AudioImportFilter = {
  files: File[]
  skippedDuplicateCount: number
  skippedTooLargeCount: number
}

/** 去重 + 大小过滤（纯函数便于单测）。只接受音频文件，非音频在调用方已分流不会进来。 */
export function filterImportableAudioFiles(files: File[]): AudioImportFilter {
  const seen = new Set<string>()
  let skippedDuplicateCount = 0
  let skippedTooLargeCount = 0
  const out: File[] = []
  for (const file of files) {
    const signature = audioSignature(file)
    if (seen.has(signature)) {
      skippedDuplicateCount += 1
      continue
    }
    seen.add(signature)
    if ((typeof file.size === 'number' ? file.size : 0) > ASSET_LIBRARY_AUDIO_IMPORT_MAX_BYTES) {
      skippedTooLargeCount += 1
      continue
    }
    out.push(file)
  }
  return { files: out, skippedDuplicateCount, skippedTooLargeCount }
}

export type AudioImportResult = {
  uploadedCount: number
  skippedDuplicateCount: number
  skippedTooLargeCount: number
  failedCount: number
}

/**
 * 把音频文件落进项目素材库（项目文件源）。返回各计数供调用方提示。
 * 落盘后调用方负责触发库刷新（useAssetPool.refresh）——项目文件源不像画布 store 自动反应。
 */
export async function importAudioFilesToLibrary(
  inputFiles: File[],
  options: { projectId: string | null },
): Promise<AudioImportResult> {
  const filtered = filterImportableAudioFiles(inputFiles)
  let failedCount = 0
  await Promise.all(
    filtered.files.map(async (file) => {
      try {
        await importWorkbenchLocalAssetFile(file, file.name, { projectId: options.projectId })
      } catch (error) {
        failedCount += 1
        console.error('asset library audio upload failed', error)
      }
    }),
  )
  return {
    uploadedCount: filtered.files.length - failedCount,
    skippedDuplicateCount: filtered.skippedDuplicateCount,
    skippedTooLargeCount: filtered.skippedTooLargeCount,
    failedCount,
  }
}
