import { describe, expect, it } from 'vitest'
import { compareMotionBaseline, scanMotionTokens } from './lib/motionTokenScan.mjs'

const file = 'src/workbench/dialog.tsx'
const scan = source => scanMotionTokens(file, source)

describe('motion tokens at production call sites', () => {
  it.each(['duration-150', 'duration-[140ms]', 'ease-in-out', 'ease-[steps(2)]', 'transition-all'])('catches variants of %s', utility => {
    expect(scan(`const label = cn(active && "hover:!${utility}")`).map(hit => hit.token)).toEqual([utility])
  })

  it('checks CSS curves, component keyframes, Motion props and preference queries', () => {
    expect(scanMotionTokens('src/dialog.css', '.box { transition: opacity 1s cubic-bezier(.2,.7,.3,1) }')).toHaveLength(1)
    expect(scan('const view = <style>{`@keyframes open {from {opacity: 0}}`}</style>')).toHaveLength(1)
    expect(scan('const view = <motion.div transition={{ duration: 0.4, ease: [0, 1, 0, 1] }} />')).toHaveLength(2)
    expect(scan("window.matchMedia('(prefers-reduced-motion: reduce)')")).toHaveLength(1)
  })

  it('accepts tokens, instant APIs, unrelated action IDs, CSS keyframes and comments', () => {
    expect(scan('// duration-150\nconst item = { id: "apply-transition-all", cls: "transition-colors duration-nomi-fast-exit ease-nomi-in" }')).toEqual([])
    expect(scan('const view = <motion.div transition={{ duration: 0 }} />')).toEqual([])
    expect(scanMotionTokens('src/dialog.css', '/* cubic-bezier( */ @keyframes open { from { opacity: 0 } }')).toEqual([])
  })

  it('protects each occurrence and requires shrinking stale entries', () => {
    const old = scan('const a = "duration-150"')
    const baseline = { [file]: old.map(hit => hit.signature) }
    expect(compareMotionBaseline(file, old, baseline)).toEqual([])
    expect(compareMotionBaseline(file, [...old, ...old], baseline)).toHaveLength(1)
    expect(compareMotionBaseline(file, scan('const b = "duration-150"'), baseline)).toHaveLength(2)
    expect(compareMotionBaseline(file, [], baseline)).toHaveLength(1)
    expect(compareMotionBaseline('src/new.tsx', old, baseline)).toHaveLength(1)
  })
})
