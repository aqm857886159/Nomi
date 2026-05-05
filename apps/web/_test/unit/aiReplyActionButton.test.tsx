import React from 'react'
import { MantineProvider } from '@mantine/core'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AiReplyActionButton } from '../../src/workbench/ai/AiReplyActionButton'
import { useWorkbenchStore } from '../../src/workbench/workbenchStore'

function renderButton(content: string): void {
  render(
    <MantineProvider forceColorScheme="light">
      <AiReplyActionButton className="test-action" content={content} />
    </MantineProvider>,
  )
}

describe('AiReplyActionButton', () => {
  beforeEach(() => {
    useWorkbenchStore.getState().setCreationDocumentTools(null)
  })

  it('pastes assistant text into the active creation document when document tools exist', () => {
    const insertAtCursor = vi.fn()
    useWorkbenchStore.getState().setCreationDocumentTools({
      insertAtCursor,
      replaceSelection: vi.fn(),
      appendToEnd: vi.fn(),
    })

    renderButton('  可粘贴回复  ')
    fireEvent.click(screen.getByLabelText('粘贴到文档'))

    expect(insertAtCursor).toHaveBeenCalledWith('可粘贴回复')
    expect(screen.getByLabelText('已粘贴到文档')).toBeInTheDocument()
  })

  it('copies assistant text when no creation document is active', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    renderButton('复制这段回复')
    fireEvent.click(screen.getByLabelText('复制回复'))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('复制这段回复'))
    expect(screen.getByLabelText('已复制')).toBeInTheDocument()
  })

  it('does not render for empty content', () => {
    renderButton('   ')

    expect(screen.queryByLabelText('复制回复')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('粘贴到文档')).not.toBeInTheDocument()
  })
})
