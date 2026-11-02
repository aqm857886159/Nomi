import i18n from '../../../i18n'
import React from 'react'
import { MantineProvider } from '@mantine/core'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { SpendConfirmDialog } from './SpendConfirmDialog'
import { confirmGenerationResend, useSpendConfirmStore } from './spendConfirm'
vi.mock('../../../design', async original => ({ ...await original<typeof import('../../../design')>(), BodyPortal: ({ children }: { children: React.ReactNode }) => children }))
it('G1: the real spend shell preserves the two risk lines and explicit decision buttons', async () => {
 const decision=confirmGenerationResend({kind:'image',state:'unknown'})
 const server=useSpendConfirmStore.getInitialState(),saved=server.pending
 server.pending=useSpendConfirmStore.getState().pending
 try {
  const html=renderToStaticMarkup(<MantineProvider><SpendConfirmDialog /></MantineProvider>)
  expect(html).toContain('whitespace-pre-line');expect(html).toContain(i18n.t('generationCommon.spend.resend.unknown'))
  expect(html).toContain('data-spend-confirm-action="cancel"');expect(html).toContain('data-spend-confirm-action="confirm"')
 } finally { server.pending=saved;useSpendConfirmStore.getState().resolvePending(false);await decision }
})
