import crypto from 'node:crypto'

import { readProject, saveProject } from '../projects/repository'

type DocumentRecord = { id: string; contentJson?: unknown; updatedAt?: number }

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function textOf(value: unknown): string {
  const node = record(value)
  if (node.type === 'text' && typeof node.text === 'string') return node.text
  return Array.isArray(node.content) ? node.content.map(textOf).filter(Boolean).join('\n') : ''
}

function contentFor(text: string): unknown {
  return {
    type: 'doc',
    content: text.split('\n').map((line) => ({
      type: 'paragraph',
      ...(line ? { content: [{ type: 'text', text: line }] } : {}),
    })),
  }
}

function projectDocument(projectId: string, documentId?: string): { project: Record<string, unknown>; document: DocumentRecord; text: string } {
  const project = readProject(projectId)
  if (!project) throw Object.assign(new Error(`Project not found: ${projectId}`), { code: 'project_not_found' })
  const payload = record(project.payload)
  const documents = Array.isArray(payload.workbenchDocuments) ? payload.workbenchDocuments as DocumentRecord[] : []
  const selectedId = documentId || (typeof payload.activeDocumentId === 'string' ? payload.activeDocumentId : documents[0]?.id)
  const document = documents.find((candidate) => candidate && candidate.id === selectedId) || documents[0]
  if (!document) throw Object.assign(new Error('Creation document not found'), { code: 'document_not_found' })
  return { project: project as unknown as Record<string, unknown>, document, text: textOf(document.contentJson) }
}

export function readProjectDocument(projectId: string, documentId: string | undefined, scope: 'full' | 'selection') {
  const { document, text } = projectDocument(projectId, documentId)
  // MCP has no editor cursor. A selection request therefore reads the current document
  // rather than inventing a range; renderer Host calls still own real selection anchors.
  void document
  void scope
  return { text }
}

export function writeProjectDocument(
  projectId: string,
  documentId: string | undefined,
  operation: 'insert' | 'replace' | 'append',
  content: string,
) {
  const { project, document, text } = projectDocument(projectId, documentId)
  const nextText = operation === 'replace' ? content : operation === 'append' ? `${text}${text ? '\n' : ''}${content}` : `${content}${text ? '\n' : ''}${text}`
  const payload = record(project.payload)
  const documents = (Array.isArray(payload.workbenchDocuments) ? payload.workbenchDocuments : []).map((candidate) => {
    const item = record(candidate)
    return item.id === document.id ? { ...item, contentJson: contentFor(nextText), updatedAt: Date.now() } : candidate
  })
  const saved = saveProject(projectId, { ...project, payload: { ...payload, workbenchDocuments: documents, activeDocumentId: document.id } })
  return {
    applied: true as const,
    revision: Number(saved.revision ?? 0),
    contentHash: crypto.createHash('sha256').update(nextText, 'utf8').digest('hex'),
  }
}
