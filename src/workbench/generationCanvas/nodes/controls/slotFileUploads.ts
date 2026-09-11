/**
 * 「本地文件 → 工作台素材 → 槽里的 url」这一条路，三个入口共用（R9 从 NodeParameterControls 搬出）。
 *
 * 为什么是一个关注点而不是三个：数组参考槽、源视频单槽、单图/视频/音频槽，走的是同一条
 * importWorkbenchLocalAssetFile → assetUrl 导入路径，同一套「上传中」旗标与同一个错误出口；
 * 差别只在「导入完把 url 交给谁」和 mediaKind 决定的那几条文案。把它们摆在一起，新增一种槽时
 * 只会看到一处要改（此前音频槽就是漏在其中一处，提示文不对题）。
 *
 * 写入仍然归调用方：这里不碰 meta / 边，只把拿到的 url 交回给 onArrayAdd / onSingleFrameUrl。
 * 刻意不是 hook：宿主组件在 `!isGenerationNode` 处提前 return null，钩子调用不能落在它后面。
 */
import type { TFunction } from 'i18next'
import { importWorkbenchLocalAssetFile } from '../../../api/assetUploadApi'
import type { ImageUrlSlot } from '../../model/parameterReferenceSlots'
import type { ArchetypeArraySlot } from './archetypeMeta'
import { assetUrl } from './parameterControlModel'

export type SlotFileUploads = {
  handleArrayUpload: (slot: ArchetypeArraySlot, file: File | null | undefined) => Promise<void>;
  handleSourceVideoUpload: (metaKey: string, file: File | null | undefined) => Promise<void>;
  handleSlotUpload: (slot: ImageUrlSlot, file: File | null | undefined) => Promise<void>;
};

export function createSlotFileUploads(deps: {
  nodeId: string;
  t: TFunction;
  /** 数组槽导入完成：交给调用方走 appendArchetypeArrayValue 那条唯一写入路径。 */
  onArrayAdd: (slot: ArchetypeArraySlot, url: string) => void;
  /** 源视频单槽导入完成：写 meta[metaKey]（传输层映射成 video_url）。 */
  onSourceVideoUrl: (metaKey: string, url: string) => void;
  /** 单槽导入完成：交给调用方断边 + 写 meta（上传替换该槽来源）。 */
  onSingleFrameUrl: (slot: ImageUrlSlot, url: string) => void;
  setUploadingArrayKey: (key: string) => void;
  setUploadingSlotKey: (key: string) => void;
  setUploadError: (message: string) => void;
}): SlotFileUploads {
  const { t, nodeId, onArrayAdd, onSourceVideoUrl, onSingleFrameUrl, setUploadingArrayKey, setUploadingSlotKey, setUploadError } = deps

  const handleArrayUpload = async (slot: ArchetypeArraySlot, file: File | null | undefined): Promise<void> => {
    if (!file) return
    setUploadingArrayKey(slot.metaKey)
    setUploadError('')
    try {
      const uploaded = await importWorkbenchLocalAssetFile(file, file.name || slot.label, {
        ownerNodeId: nodeId,
        taskKind: 'image_edit',
      })
      const url = assetUrl(uploaded)
      if (!url) throw new Error(t('generationCommon.parameters.missingAssetUrl'))
      onArrayAdd(slot, url)
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : String(error))
    } finally {
      setUploadingArrayKey('')
    }
  }

  // D3 源视频单槽（video-edit）：上传一个视频 → 写 meta.sourceVideoUrl（传输映射成 video_url）。
  const handleSourceVideoUpload = async (metaKey: string, file: File | null | undefined): Promise<void> => {
    if (!file) return
    setUploadingArrayKey(metaKey)
    setUploadError('')
    try {
      const uploaded = await importWorkbenchLocalAssetFile(
        file,
        file.name || t('generationCommon.parameters.sourceVideo'),
        { ownerNodeId: nodeId, taskKind: 'image_edit' },
      )
      const url = assetUrl(uploaded)
      if (!url) throw new Error(t('generationCommon.parameters.missingVideoUrl'))
      onSourceVideoUrl(metaKey, url)
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : String(error))
    } finally {
      setUploadingArrayKey('')
    }
  }

  const handleSlotUpload = async (slot: ImageUrlSlot, file: File | null | undefined): Promise<void> => {
    if (!file) return
    if (!file.type.startsWith(`${slot.mediaKind ?? 'image'}/`)) {
      // 三选一（同类根因的又一个入口，2026-09-11 补：ComfyUI 声明的音频参数槽走这条上传器，
      // 此前只区分 video/image，音频槽拖错文件会显示「只能选择图片文件」这种文不对题的提示）。
      setUploadError(t(
        slot.mediaKind === 'video' ? 'generationCommon.parameters.videoOnly'
          : slot.mediaKind === 'audio' ? 'generationCommon.parameters.audioOnly'
            : 'generationCommon.parameters.imageOnly',
      ))
      return
    }
    setUploadingSlotKey(slot.key)
    setUploadError('')
    try {
      const uploaded = await importWorkbenchLocalAssetFile(file, file.name || slot.label, {
        ownerNodeId: nodeId,
        ...(slot.mediaKind === 'video' || slot.mediaKind === 'audio' ? {} : { taskKind: 'image_edit' }),
      })
      const url = assetUrl(uploaded)
      if (!url) throw new Error(t(
        slot.mediaKind === 'video' ? 'generationCommon.parameters.missingVideoUrl'
          : slot.mediaKind === 'audio' ? 'generationCommon.parameters.missingAudioUrl'
            : 'generationCommon.parameters.missingImageUrl',
      ))
      onSingleFrameUrl(slot, url)
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : String(error))
    } finally {
      setUploadingSlotKey('')
    }
  }

  return { handleArrayUpload, handleSourceVideoUpload, handleSlotUpload }
}
