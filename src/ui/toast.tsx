import React from 'react'
import { create } from 'zustand'
import { notifications } from '@mantine/notifications'
import { cn } from '../utils/cn'

type ToastType = 'info' | 'success' | 'error' | 'warning'
type Toast = { id: string; message: string; type?: ToastType; ttl?: number }

type ToastState = {
  items: Toast[]
  push: (t: Omit<Toast, 'id'>) => void
  remove: (id: string) => void
}

export const useToastStore = create<ToastState>((set, get) => ({
  items: [],
  push: (t) => {
    const id = Math.random().toString(36).slice(2, 8)
    const item: Toast = { id, ...t }
    set((s) => ({ items: [...s.items, item] }))
    const ttl = t.ttl ?? 3000
    window.setTimeout(() => get().remove(id), ttl)
  },
  remove: (id) => set((s) => ({ items: s.items.filter(i => i.id !== id) })),
}))

export function toast(message: string, type?: ToastType) {
  const color = type === 'error' ? 'red' : type === 'success' ? 'teal' : type === 'warning' ? 'yellow' : 'gray'
  try {
    notifications.show({ message, color })
  } catch {
    // fallback to local store host
    useToastStore.getState().push({ message, type })
  }
}

export function ToastHost({ className }: { className?: string } = {}): JSX.Element {
  const items = useToastStore((s) => s.items)
  return (
    <div className={cn('fixed bottom-4 right-4 flex flex-col gap-2 z-50', className)}>
      {items.map(i => (
        <div
          className={cn(
            'px-3 py-2 rounded-lg border border-black/[.15] shadow-sm',
            i.type === 'error' && 'bg-workbench-danger-soft',
            i.type === 'success' && 'bg-workbench-success-soft',
            i.type !== 'error' && i.type !== 'success' && 'bg-nomi-accent-soft',
          )}
          key={i.id}
        >{i.message}</div>
      ))}
    </div>
  )
}
