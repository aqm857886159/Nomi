/** Original file bytes at Nomi's model boundary. Never persisted in conversation records. */
export type NativeFileContent = {
  type: 'file'
  data: string
  mimeType: string
  fileName: string
}

export type NativeInputModality = 'text' | 'image' | 'audio' | 'video'
