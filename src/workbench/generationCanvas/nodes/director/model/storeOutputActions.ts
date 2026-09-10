/**
 * [INPUT]: 依赖 ./directorStore 的 CommitProject / StoreGet / StoreSet 类型、./directorIds 的 createOutputId、./directorTypes（DirectorOutputImage / DirectorOutputVideo）
 * [OUTPUT]: 对外提供 DirectorOutputActions、createOutputActions：产物增删（截图 / 视频）、录制进度瞬态
 * [POS]: director/model 的产物动作集（清单 §4.7）：产物只存资产句柄进工程 outputs；录制进度 videoRecording 是瞬态（不入工程、不进撤销栈）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { createOutputId } from './directorIds'
import type { CommitProject, StoreGet, StoreSet } from './directorStore'
import type { DirectorOutputImage, DirectorOutputVideo } from './directorTypes'

export type VideoRecordingProgress = { current: number; total: number }

export type DirectorOutputActions = {
  addOutputImage: (input: Omit<DirectorOutputImage, 'id' | 'createdAt'>) => DirectorOutputImage
  addOutputVideo: (input: Omit<DirectorOutputVideo, 'id' | 'createdAt'>) => DirectorOutputVideo
  removeOutput: (id: string) => void
  setVideoRecording: (progress: VideoRecordingProgress | null) => void
}

export function createOutputActions(set: StoreSet, get: StoreGet, commitProject: CommitProject): DirectorOutputActions {
  const save = () => get().saveState()
  return {
    addOutputImage: (input) => {
      const output: DirectorOutputImage = { ...input, id: createOutputId(), createdAt: Date.now() }
      save()
      commitProject((project) => {
        project.outputs.screenshots.unshift(output)
      })
      return output
    },
    addOutputVideo: (input) => {
      const output: DirectorOutputVideo = { ...input, id: createOutputId(), createdAt: Date.now() }
      save()
      commitProject((project) => {
        project.outputs.videos.unshift(output)
      })
      return output
    },
    removeOutput: (id) => {
      save()
      commitProject((project) => {
        project.outputs.screenshots = project.outputs.screenshots.filter((item) => item.id !== id)
        project.outputs.videos = project.outputs.videos.filter((item) => item.id !== id)
      })
    },
    setVideoRecording: (progress) => set({ videoRecording: progress }),
  }
}
