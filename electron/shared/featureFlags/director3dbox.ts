/**
 * The Director 3D-BOX flag is resolved once at process bootstrap.
 * Packaged processes read the baked file; development processes may opt in with
 * NOMI_DIRECTOR_3DBOX. No runtime environment variable can turn a packaged
 * build on.
 */
import fs from 'node:fs'
import path from 'node:path'
import { installDirector3DBoxFace } from './director3dboxFace'

export const DIRECTOR_3DBOX_FLAG = 'director3dbox' as const
export const DIRECTOR_3DBOX_EXPIRY = '2026-11-15' as const

export type Director3DBoxFlag = Readonly<{
  name: typeof DIRECTOR_3DBOX_FLAG
  enabled: boolean
  source: 'baked' | 'env' | 'default'
  fingerprint: string
  expiresOn: typeof DIRECTOR_3DBOX_EXPIRY
}>

type BakedFlags = { version?: number; director3dbox?: unknown; flags?: { director3dbox?: unknown } }

function asBool(value: unknown): boolean {
  return value === true || value === 'true' || value === '1'
}

function isDevelopment(env: NodeJS.ProcessEnv): boolean {
  return env.NOMI_DESKTOP_DEV === '1' || Boolean(env.VITE_DEV_SERVER_URL)
}

function bakedFileCandidates(): string[] {
  return [
    path.resolve(__dirname, '../../feature-flags.json'),
    path.resolve(process.cwd(), 'dist-electron/feature-flags.json'),
  ]
}

function readBaked(): boolean | null {
  for (const file of bakedFileCandidates()) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as BakedFlags
      const value = parsed.director3dbox ?? parsed.flags?.director3dbox
      if (typeof value === 'boolean' || typeof value === 'string') return asBool(value)
    } catch {
      // Source/tsx tests and dev source runs do not have a baked file.
    }
  }
  return null
}

function fingerprint(enabled: boolean): string {
  return `${DIRECTOR_3DBOX_FLAG}:${enabled ? 'on' : 'off'}:${DIRECTOR_3DBOX_EXPIRY}`
}

export function resolveDirector3DBoxFlag(env: NodeJS.ProcessEnv = process.env, bakedOverride?: boolean | null): Director3DBoxFlag {
  const baked = bakedOverride === undefined ? readBaked() : bakedOverride
  const dev = isDevelopment(env)
  const enabled = dev ? asBool(env.NOMI_DIRECTOR_3DBOX) : (baked ?? false)
  const source = dev ? 'env' : (baked === null ? 'default' : 'baked')
  return Object.freeze({
    name: DIRECTOR_3DBOX_FLAG,
    enabled,
    source,
    fingerprint: fingerprint(enabled),
    expiresOn: DIRECTOR_3DBOX_EXPIRY,
  })
}

export const director3dBoxFlag = resolveDirector3DBoxFlag()
// 共享层（工具注册表等导入期装配的常量）只读 globalThis 上这一份；见 director3dboxFace.ts。
installDirector3DBoxFace(director3dBoxFlag.enabled)

export function director3dBoxEnabled(): boolean {
  return director3dBoxFlag.enabled
}

export function director3dBoxProof(): Director3DBoxFlag {
  return director3dBoxFlag
}
