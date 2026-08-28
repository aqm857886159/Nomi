import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

/** Install the same token-backed client proof that Nomi writes into a real MCP client config. */
export function installMcpClientProof(capabilityDir, client = 'codex') {
  fs.mkdirSync(capabilityDir, { recursive: true })
  const tokenPath = path.join(capabilityDir, 'token')
  const token = fs.existsSync(tokenPath)
    ? fs.readFileSync(tokenPath, 'utf8').trim()
    : crypto.randomBytes(24).toString('hex')
  if (!token) throw new Error('MCP journey capability token is empty')
  if (!fs.existsSync(tokenPath)) fs.writeFileSync(tokenPath, token, { encoding: 'utf8', mode: 0o600 })
  return {
    NOMI_MCP_CLIENT: client,
    NOMI_MCP_CLIENT_PROOF: crypto
      .createHmac('sha256', token)
      .update(`nomi-mcp-client:v1:${client}`)
      .digest('base64url'),
  }
}
