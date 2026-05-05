const requiredEnvVars = [
  'VITE_API_BASE',
  'VITE_GITHUB_CLIENT_ID',
  'VITE_GITHUB_REDIRECT_URI',
]

const missing = requiredEnvVars.filter((key) => !String(process.env[key] || '').trim())

if (missing.length > 0) {
  console.error(`Missing env vars: ${missing.join(', ')}`)
  process.exit(1)
}

console.log('All required env vars present.')
