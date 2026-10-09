export function formatInstallerSize(bytes: number | null): string | null {
  if (!bytes || bytes <= 0) return null
  return `${Math.round(bytes / (1024 * 1024))} MB`
}
