export function waitForMarkdownModuleRequest(requested, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    // Resource admission has a deadline: a missing import must produce a failed
    // receipt instead of hanging before the cell's cleanup/error path.
    const deadline = setTimeout(() => reject(new Error('Markdown module request deadline exceeded')), timeoutMs)
    requested.then(value => { clearTimeout(deadline); resolve(value) }, error => { clearTimeout(deadline); reject(error) })
  })
}
