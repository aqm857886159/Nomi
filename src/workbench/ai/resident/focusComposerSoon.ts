export function focusComposerSoon(): void {
  let frames = 0
  const tick = () => {
    const input = document.querySelector<HTMLElement>('#project-agent-resident [data-v4-control="input"], #project-agent-resident textarea')
    if (input?.getClientRects().length) input.focus({ preventScroll: true })
    else if (frames++ < 20) window.requestAnimationFrame(tick)
  }
  window.requestAnimationFrame(tick)
}
