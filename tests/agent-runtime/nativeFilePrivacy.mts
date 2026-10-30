// Read-only NTFS evidence for isolated test files. This does not modify any ACL.
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import path from 'node:path'

export function assertWindowsPrivateAcl(file: string): void {
  const windowsRoot = process.env.SystemRoot || process.env.WINDIR
  assert.ok(windowsRoot, 'Windows system root is required for native ACL inspection')
  const script = String.raw`
$acl = [System.IO.File]::GetAccessControl($env:NOMI_TEST_ACL_TARGET)
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) | ForEach-Object { @{ sid = $_.IdentityReference.Value; type = [int]$_.AccessControlType; rights = [int]$_.FileSystemRights } })
@{ currentSid = $sid; ownerSid = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value; rules = $rules } | ConvertTo-Json -Depth 4 -Compress
`
  const result = spawnSync(path.join(windowsRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: {...process.env, NOMI_TEST_ACL_TARGET:file}, encoding:'utf8', windowsHide:true,
  })
  assert.equal(result.status, 0, result.stderr || result.error?.message)
  const acl = JSON.parse(result.stdout.trim()) as {currentSid:string;ownerSid:string;rules:Array<{sid:string;type:number;rights:number}>}
  const privileged = new Set([acl.currentSid, 'S-1-5-18', 'S-1-5-32-544'])
  assert.ok(privileged.has(acl.ownerSid), 'fixture file owner must be the user or an OS administrator')
  assert.deepEqual(acl.rules.filter(rule => rule.type === 0 && (rule.rights & 1) !== 0 && !privileged.has(rule.sid)), [], 'non-privileged principal has read access')
}
