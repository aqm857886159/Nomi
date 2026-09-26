// 音频文件 → 项目素材库的导入（纯落项目文件，不建画布节点）。
//
// 为什么独立成路：图片/视频导入走 importLocalMediaFilesToGenerationCanvas（建画布素材节点，
// 可拖到画布）；音频没有画布节点 archetype（canvasNodeToAssetRefs 本就排除 audio），它从「项目
// 文件」这条源进素材池——生成的 TTS 音频就是这么进音频 tab 的。所以音频上传只需落项目文件，
// 落盘后 uniqueAssetPath 保留原扩展名（.mp3/.wav/.m4a…），workspace 索引按扩展名归类成 audio。

import { importWorkbenchLocalAssetFile } from '../api/assetUploadApi'
import { extensionsForKind } from '../../../electron/assets/mediaTypes'
import { logRendererError } from '../../desktop/rendererLog'
import {
  admitMediaImport,
  type MediaImportRejection,
  type StorageCapacity,
} from '../../../electron/shared/contracts/mediaImportPolicy'
import { readStorageCapacitySnapshot } from './storageCapacitySnapshot'
import { isProjectImportCancellation, type ProjectExecutionContext } from '../project/projectCanvasReadSurface'

// 从媒体类型单一真相源派生，与 workspaceFileIndex 的音频分类同源（不再手维护第二份）。
const AUDIO_EXTENSIONS = new Set(extensionsForKind('audio'))

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
  rejected: Array<{ fileName: string; rejection: MediaImportRejection }>
}

/** 去重 + 准入（纯函数便于单测）。上限不再是本文件的常量——由磁盘余量派生（mediaImportPolicy）。 */
export function filterImportableAudioFiles(files: File[], capacity: StorageCapacity | null): AudioImportFilter {
  const seen = new Set<string>()
  let skippedDuplicateCount = 0
  const rejected: AudioImportFilter['rejected'] = []
  const out: File[] = []
  for (const file of files) {
    const signature = audioSignature(file)
    if (seen.has(signature)) {
      skippedDuplicateCount += 1
      continue
    }
    seen.add(signature)
    const admission = admitMediaImport(
      'asset-library',
      { kind: 'audio', sizeBytes: typeof file.size === 'number' ? file.size : 0 },
      capacity,
    )
    if (!admission.ok) {
      rejected.push({ fileName: file.name || '', rejection: admission })
      continue
    }
    out.push(file)
  }
  return { files: out, skippedDuplicateCount, rejected }
}

export type AudioImportResult = {
  uploadedCount: number
  skippedDuplicateCount: number
  rejected: Array<{ fileName: string; rejection: MediaImportRejection }>
  failedCount: number
}

/**
 * 把音频文件落进项目素材库（项目文件源）。返回各计数供调用方提示。
 * 落盘后调用方负责触发库刷新（useAssetPool.refresh）——项目文件源不像画布 store 自动反应。
 */
export async function importAudioFilesToLibrary(
  inputFiles: File[],
  project: ProjectExecutionContext,
): Promise<AudioImportResult> {
  const filtered = filterImportableAudioFiles(inputFiles, await readStorageCapacitySnapshot(project.binding.projectId))
  project.assertCurrent()
  let failedCount = 0
  await Promise.all(
    filtered.files.map(async (file) => {
      try {
        await importWorkbenchLocalAssetFile(file, file.name, { projectBinding: project.binding, assertCurrent: project.assertCurrent })
      } catch (error) {
        if (isProjectImportCancellation(error)) throw error
        failedCount += 1
        logRendererError('asset-audio-import-failed', error)
      }
    }),
  )
  return {
    uploadedCount: filtered.files.length - failedCount,
    skippedDuplicateCount: filtered.skippedDuplicateCount,
    rejected: filtered.rejected,
    failedCount,
  }
}
