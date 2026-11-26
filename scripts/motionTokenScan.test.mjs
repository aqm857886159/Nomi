import { describe, expect, it } from 'vitest'
import { compareMotionBaseline, scanMotionTokens } from './lib/motionTokenScan.mjs'

const file = 'src/workbench/dialog.tsx'
const scan = source => scanMotionTokens(file, source)

describe('motion tokens at production call sites', () => {
  it.each(['duration-150', 'duration-[140ms]', 'ease-in-out', 'ease-[steps(2)]', 'transition-all'])('catches variants of %s', utility => {
    expect(scan(`const label = cn(active && "hover:!${utility}")`).map(hit => hit.token)).toEqual([utility])
  })

  it('checks CSS curves, component keyframes, Motion props and preference queries', () => {
    expect(scanMotionTokens('src/dialog.css', '.box { transition: opacity 1s cubic-bezier(.2,.7,.3,1) }').map(hit => hit.token))
      .toEqual(['1s', 'cubic-bezier('])
    expect(scan('const view = <style>{`@keyframes open {from {opacity: 0}}`}</style>')).toHaveLength(1)
    expect(scan('const view = <motion.div transition={{ duration: 0.4, ease: [0, 1, 0, 1] }} />')).toHaveLength(2)
    expect(scan("window.matchMedia('(prefers-reduced-motion: reduce)')")).toHaveLength(1)
  })

  it('finds raw CSS durations and linear easing inside motion declarations', () => {
    const css = `.box {
      transition: opacity 175ms linear, transform .2s var(--nomi-ease-out);
      animation: appear var(--nomi-duration-fast) linear(0, 1);
      transition-delay: 20ms;
      background: linear-gradient(red, blue);
    }`
    expect(scanMotionTokens('src/dialog.css', css).map(hit => [hit.line, hit.token]))
      .toEqual([[2, '175ms'], [2, 'linear'], [2, '.2s'], [3, 'linear('], [4, '20ms']])
    expect(scanMotionTokens('src/dialog.css', '.box { animation-duration: 175ms }').map(hit => hit.token)).toEqual(['175ms'])
    expect(scanMotionTokens('src/theme/nomi-tokens.css', css)).toEqual([])
    expect(scanMotionTokens('tailwind.config.ts', css)).toEqual([])
    expect(scan('const view = <style>{`.box { transition: opacity 175ms linear }`}</style>').map(hit => hit.token))
      .toEqual(['175ms', 'linear'])
  })

  it('checks locally referenced Motion transitions without confusing shadowed or unrelated objects', () => {
    const source = `
      const raw = { opacity: { duration: 0.25 } };
      const alias = raw;
      const settings = { duration: 10 };
      function Safe() {
        const alias = { duration: NOMI_DURATION_MS.fast / 1000 };
        return <motion.div transition={alias} />;
      }
      const view = <motion.div exit={{ opacity: 0, transition: alias }} transition={alias} />;
    `
    expect(scan(source).map(hit => [hit.line, hit.token])).toEqual([[2, 'inline motion duration']])
  })

  it('keeps the raw text-button press scale at its shared token definition', () => {
    const value = 'const cls = "enabled:active:scale-[0.97] motion-reduce:active:scale-100";'
    expect(scan(value).map(hit => hit.token)).toEqual(['active:scale-[0.97]'])
    expect(scanMotionTokens('src/dialog.css', '.box { @apply active:scale-[0.97]; }').map(hit => hit.token))
      .toEqual(['active:scale-[0.97]'])
    expect(scanMotionTokens('src/design/motion.ts', value)).toEqual([])
    for (const owner of ['src/design/actions.tsx', 'src/workbench/generationCanvas/nodes/ComposerSendButton.tsx']) {
      expect(scanMotionTokens(owner, 'const cls = TEXT_BUTTON_PRESS;')).toEqual([])
      expect(scanMotionTokens(owner, value).map(hit => hit.token)).toEqual(['active:scale-[0.97]'])
    }
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
