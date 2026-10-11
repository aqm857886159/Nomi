import React from 'react'
import { renderToPipeableStream } from 'react-dom/server'
import { PassThrough } from 'node:stream'
import { LazyNomiMarkdown } from '../../src/workbench/common/LazyNomiMarkdown'

// Resolve the actual shared lazy owner before synchronous SSR or steady-state
// render-count assertions. Production admission and its fallback stay unchanged.
export function preloadNomiMarkdown(): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = new PassThrough()
    output.resume()
    output.on('end', resolve)
    output.on('error', reject)
    const stream = renderToPipeableStream(React.createElement(LazyNomiMarkdown, { children: 'Markdown fixture' }), {
      onAllReady: () => stream.pipe(output),
      onError: reject,
    })
  })
}
