import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import type { CSSProperties, ReactNode } from 'react'

vi.mock('react-pannellum', async () => {
  const React = await import('react')
  return {
    default: ({ children, style }: { children?: ReactNode; style?: CSSProperties }) => (
      React.createElement('div', { 'data-testid': 'react-pannellum', style }, children)
    ),
    usePannellum: () => ({
      getPitch: () => 0,
      getYaw: () => 0,
      getHfov: () => 90,
      getConfig: () => ({}),
      getContainer: () => undefined,
      getViewer: () => null,
      stopMovement: () => undefined,
    }),
  }
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  sessionStorage.clear()
})

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

class ResizeObserverMock {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

Object.defineProperty(window, 'ResizeObserver', {
  writable: true,
  value: ResizeObserverMock,
})

Object.defineProperty(globalThis, 'ResizeObserver', {
  writable: true,
  value: ResizeObserverMock,
})
