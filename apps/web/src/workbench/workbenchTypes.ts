export type WorkbenchDocument = {
  version: 1
  title: string
  contentJson: unknown
  updatedAt: number
}

export type CreationDocumentActionType =
  | 'insert_at_cursor'
  | 'replace_selection'
  | 'append_to_end'

export type CreationDocumentAction = {
  type: CreationDocumentActionType
  content: string
}

export type CreationDocumentTools = {
  readFullText: () => string
  readSelectionText: () => string
  insertAtCursor: (content: string) => void
  replaceSelection: (content: string) => void
  appendToEnd: (content: string) => void
  writeDocument: (content: string) => void
  generateStoryboardNode: (content: string) => void
  generateAssetNode: (content: string) => void
}

export type PreviewAspectRatio = '16:9' | '9:16' | '1:1' | '4:5' | '3:4' | '4:3' | '21:9'

export function createDefaultWorkbenchDocument(): WorkbenchDocument {
  return {
    version: 1,
    title: '',
    contentJson: {
      type: 'doc',
      content: [],
    },
    updatedAt: Date.now(),
  }
}
