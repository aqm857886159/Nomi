# 安装器场景用的对话框记录器（只在 Windows 安装作业里跑，由 tests/installer/windows-installer-scenarios.mjs 启动）。
#
# 为什么要它：静默安装（/S）下，build/installer.nsh 的中止框故意不带 /SD，用户也看得见原因；
# 测试要证明「框真的弹了、写的是哪个条目」，同时不能让它挂住安装程序。
# 做法：每 200ms 枚举一次顶层窗口，类名 #32770（标准对话框 / MessageBox）的记下标题、正文、所属进程，然后发 WM_CLOSE。
# 一行一个 JSON 追加到 -OutFile；-StopFile 出现就退出。读别的进程的控件文字要发 WM_GETTEXT（GetWindowText 跨进程读不到控件）。
param(
  [Parameter(Mandatory = $true)][string]$OutFile,
  [Parameter(Mandatory = $true)][string]$ReadyFile,
  [Parameter(Mandatory = $true)][string]$StopFile
)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class NomiDialogs {
  public delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hwnd, StringBuilder name, int size);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
  [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr hwnd, int id);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint msg, IntPtr wParam, StringBuilder lParam, uint flags, uint timeout, out IntPtr result);
  [DllImport("user32.dll")] public static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);

  public static List<IntPtr> Dialogs() {
    var found = new List<IntPtr>();
    EnumWindows((hwnd, lParam) => {
      if (IsWindowVisible(hwnd)) {
        var name = new StringBuilder(64);
        GetClassName(hwnd, name, name.Capacity);
        if (name.ToString() == "#32770") found.Add(hwnd);
      }
      return true;
    }, IntPtr.Zero);
    return found;
  }

  public static string Text(IntPtr hwnd) {
    if (hwnd == IntPtr.Zero) return "";
    IntPtr length;
    SendMessageTimeout(hwnd, 0x000E, IntPtr.Zero, IntPtr.Zero, 0x0002, 1000, out length);
    var text = new StringBuilder(length.ToInt32() + 2);
    IntPtr copied;
    SendMessageTimeout(hwnd, 0x000D, (IntPtr)text.Capacity, text, 0x0002, 1000, out copied);
    return text.ToString();
  }

  public static uint ProcessOf(IntPtr hwnd) {
    uint processId;
    GetWindowThreadProcessId(hwnd, out processId);
    return processId;
  }

  public static void Close(IntPtr hwnd) {
    PostMessage(hwnd, 0x0010, IntPtr.Zero, IntPtr.Zero);
  }
}
'@

$utf8 = New-Object System.Text.UTF8Encoding($false)
$handled = @{}
[System.IO.File]::WriteAllText($ReadyFile, 'ready', $utf8)
while (-not (Test-Path -LiteralPath $StopFile)) {
  foreach ($hwnd in [NomiDialogs]::Dialogs()) {
    $key = $hwnd.ToInt64()
    if ($handled.ContainsKey($key)) { continue }
    $handled[$key] = $true
    $processId = [NomiDialogs]::ProcessOf($hwnd)
    $processName = ''
    try { $processName = (Get-Process -Id $processId -ErrorAction Stop).ProcessName } catch { $processName = '' }
    $record = [pscustomobject]@{
      processId = $processId
      process = $processName
      title = [NomiDialogs]::Text($hwnd)
      text = [NomiDialogs]::Text([NomiDialogs]::GetDlgItem($hwnd, 0xFFFF))
      at = (Get-Date).ToString('o')
    }
    [System.IO.File]::AppendAllText($OutFile, (($record | ConvertTo-Json -Compress) + "`n"), $utf8)
    [NomiDialogs]::Close($hwnd)
  }
  Start-Sleep -Milliseconds 200
}
