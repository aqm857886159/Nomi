import { describe, expect, it } from 'vitest'
import { removeBackgroundNotificationId, resolveRemoveBackgroundPublicPath } from './removeBackground'

describe('resolveRemoveBackgroundPublicPath', () => {
  it('uses Vite static assets in development', () => {
    expect(resolveRemoveBackgroundPublicPath('http://127.0.0.1:5273/')).toBe('http://127.0.0.1:5273/remove-background/')
  })

  it('uses the fetch-capable local protocol in packaged builds', () => {
    expect(
      resolveRemoveBackgroundPublicPath('file:///Applications/Nomi.app/Contents/Resources/app.asar/dist/index.html'),
    ).toBe('nomi-local://resource/remove-background/')
  })
})

describe('removeBackgroundNotificationId', () => {
  it('deduplicates retries for the same node without merging different nodes', () => {
    expect(removeBackgroundNotificationId('node-25')).toBe('remove-background:node-25')
    expect(removeBackgroundNotificationId('node-25')).toBe(removeBackgroundNotificationId('node-25'))
    expect(removeBackgroundNotificationId('node-25')).not.toBe(removeBackgroundNotificationId('node-26'))
  })
})
