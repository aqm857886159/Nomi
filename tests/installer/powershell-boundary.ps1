# Shared exit/diagnostic contract for inline scripts, -File watcher and lock helper.
$ErrorActionPreference = 'Stop'
function Invoke-NomiHarnessScript {
  param([Parameter(Mandatory = $true)][scriptblock]$Body)
  $ProgressPreference = 'SilentlyContinue'
  [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
  try {
    & $Body
    exit 0
  } catch {
    [Console]::Out.WriteLine('[NOMI_HARNESS_ERROR]')
    [Console]::Out.WriteLine($_.Exception.Message)
    [Console]::Out.WriteLine($_.InvocationInfo.PositionMessage)
    [Console]::Out.Flush()
    exit 1
  }
}
