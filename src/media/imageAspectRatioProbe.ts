/** Read the decoded image ratio without mounting a view or holding an insertion indefinitely. */
export function readImageAspectRatio(url: string): Promise<number | undefined> {
  if (typeof Image === 'undefined' || !url.trim()) return Promise.resolve(undefined)
  return new Promise(resolve => {
    const image = new Image()
    const finish = (ratio?: number) => {
      clearTimeout(timer)
      image.onload = null
      image.onerror = null
      image.removeAttribute('src')
      resolve(ratio)
    }
    const timer = setTimeout(() => finish(), 8000)
    image.onload = () => finish(image.naturalWidth && image.naturalHeight
      ? image.naturalWidth / image.naturalHeight
      : undefined)
    image.onerror = () => finish()
    image.src = url
  })
}
