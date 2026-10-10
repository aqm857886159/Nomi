// Playwright Electron check for the 40px merged top bar's drag region (10-08 shell redesign).
// Windows uses native window controls (titleBarOverlay); the whole top bar is the drag region and every
// button inside it is no-drag. Success means BrowserWindow bounds changed after dragging the top bar.
import { launchNomiApp } from "./_launchApp.mjs";
import { stationTimeout } from "./_station-budget.mjs";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { newProjectEntry } from './_shell.mjs'

// 平台守卫：titleBarOverlay 只在 Windows 生效（mac 是 hiddenInset 红绿灯，Linux 保留原生框）。
// 非 Windows 机器干净跳过（exit 0），不误报红。
if (process.platform !== "win32") {
  console.log("[window-drag] 跳过：非 Windows 平台用原生窗口 chrome，无自绘标题栏可测。");
  process.exit(0);
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const userData = path.join(repoRoot, ".tmp", "window-drag-e2e", String(Date.now()));
fs.mkdirSync(userData, { recursive: true });

let passed = 0;
function assert(condition, label) {
  if (!condition) throw new Error(`WINDOW DRAG FAIL: ${label}`);
  passed += 1;
  console.log(`  ✓ ${label}`);
}

async function getMainWindowBounds(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((candidate) => (
      !candidate.isDestroyed() && candidate.isVisible()
    ));
    if (!win) throw new Error("No visible BrowserWindow");
    return win.getBounds();
  });
}

async function getMainWindowGeometry(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((candidate) => (
      !candidate.isDestroyed() && candidate.isVisible()
    ));
    if (!win) throw new Error("No visible BrowserWindow");
    return {
      bounds: win.getBounds(),
      contentBounds: win.getContentBounds(),
    };
  });
}

async function resetMainWindowBounds(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((candidate) => (
      !candidate.isDestroyed() && candidate.isVisible()
    ));
    if (!win) throw new Error("No visible BrowserWindow");
    if (win.isMaximized()) win.unmaximize();
    win.show();
    win.setBounds({ x: 180, y: 140, width: 1180, height: 760 });
    win.setAlwaysOnTop(true, "screen-saver");
    win.moveTop();
    win.focus();
    return win.getBounds();
  });
}

async function isMainWindowMaximized(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((candidate) => (
      !candidate.isDestroyed() && candidate.isVisible()
    ));
    if (!win) throw new Error("No visible BrowserWindow");
    return win.isMaximized();
  });
}

function distance(before, after) {
  return Math.abs(after.x - before.x) + Math.abs(after.y - before.y);
}

function sizeDelta(before, after) {
  return Math.max(Math.abs(after.width - before.width), Math.abs(after.height - before.height));
}

async function windowPointToScreenPoint(app, point) {
  return app.evaluate(({ BrowserWindow, screen }, rendererPoint) => {
    const win = BrowserWindow.getAllWindows().find((candidate) => (
      !candidate.isDestroyed() && candidate.isVisible()
    ));
    if (!win) throw new Error("No visible BrowserWindow");
    const bounds = win.getBounds();
    return screen.dipToScreenPoint({
      x: Math.round(bounds.x + rendererPoint.x),
      y: Math.round(bounds.y + rendererPoint.y),
    });
  }, point);
}

async function getMainWindowHandle(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((candidate) => (
      !candidate.isDestroyed() && candidate.isVisible()
    ));
    if (!win) throw new Error("No visible BrowserWindow");
    const handle = win.getNativeWindowHandle();
    let value = 0n;
    for (let index = 0; index < handle.length; index += 1) {
      value |= BigInt(handle[index]) << BigInt(index * 8);
    }
    return value.toString();
  });
}

function runWindowsNativeMouseDrag(start, delta, hwnd) {
  const script = String.raw`
& {
$startX = [int]$env:NOMI_DRAG_START_X
$startY = [int]$env:NOMI_DRAG_START_Y
$deltaX = [int]$env:NOMI_DRAG_DELTA_X
$deltaY = [int]$env:NOMI_DRAG_DELTA_Y
$targetHwnd = [IntPtr]::new([Int64]$env:NOMI_DRAG_HWND)

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class NomiNativeMouse {
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT {
    public Int32 X;
    public Int32 Y;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct INPUT {
    public UInt32 type;
    public MOUSEINPUT mi;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct MOUSEINPUT {
    public Int32 dx;
    public Int32 dy;
    public UInt32 mouseData;
    public UInt32 dwFlags;
    public UInt32 time;
    public IntPtr dwExtraInfo;
  }

  public const UInt32 INPUT_MOUSE = 0;
  public const UInt32 MOUSEEVENTF_MOVE = 0x0001;
  public const UInt32 MOUSEEVENTF_LEFTDOWN = 0x0002;
  public const UInt32 MOUSEEVENTF_LEFTUP = 0x0004;
  public const UInt32 MOUSEEVENTF_ABSOLUTE = 0x8000;
  public const UInt32 MOUSEEVENTF_VIRTUALDESK = 0x4000;
  public static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
  public const UInt32 SWP_NOSIZE = 0x0001;
  public const UInt32 SWP_NOMOVE = 0x0002;
  public const UInt32 SWP_SHOWWINDOW = 0x0040;

  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int x, int y);

  [DllImport("user32.dll")]
  public static extern bool SetProcessDPIAware();

  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, Int32 nCmdShow);

  [DllImport("user32.dll")]
  public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, Int32 X, Int32 Y, Int32 cx, Int32 cy, UInt32 uFlags);

  [DllImport("user32.dll")]
  public static extern bool GetCursorPos(out POINT lpPoint);

  [DllImport("user32.dll")]
  public static extern IntPtr WindowFromPoint(POINT point);

  [DllImport("user32.dll")]
  public static extern IntPtr GetAncestor(IntPtr hwnd, UInt32 gaFlags);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern Int32 GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, Int32 count);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern Int32 GetClassName(IntPtr hWnd, System.Text.StringBuilder text, Int32 count);

  [DllImport("user32.dll")]
  public static extern Int32 GetSystemMetrics(Int32 nIndex);

  [DllImport("user32.dll", SetLastError = true)]
  public static extern UInt32 SendInput(UInt32 nInputs, INPUT[] pInputs, Int32 cbSize);

  public static void SendMouse(UInt32 flags, Int32 dx, Int32 dy) {
    INPUT[] inputs = new INPUT[1];
    inputs[0].type = INPUT_MOUSE;
    inputs[0].mi.dx = dx;
    inputs[0].mi.dy = dy;
    inputs[0].mi.mouseData = 0;
    inputs[0].mi.dwFlags = flags;
    inputs[0].mi.time = 0;
    inputs[0].mi.dwExtraInfo = IntPtr.Zero;
    if (SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT))) == 0) {
      throw new InvalidOperationException("SendInput failed: " + Marshal.GetLastWin32Error());
    }
  }

  public static void MoveAbsolute(Int32 x, Int32 y) {
    Int32 left = GetSystemMetrics(76);
    Int32 top = GetSystemMetrics(77);
    Int32 width = Math.Max(1, GetSystemMetrics(78) - 1);
    Int32 height = Math.Max(1, GetSystemMetrics(79) - 1);
    Int32 normalizedX = (Int32)Math.Round((x - left) * 65535.0 / width);
    Int32 normalizedY = (Int32)Math.Round((y - top) * 65535.0 / height);
    SendMouse(MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK, normalizedX, normalizedY);
  }

  public static string DescribePoint() {
    POINT point;
    if (!GetCursorPos(out point)) return "cursor=<unavailable>";
    IntPtr child = WindowFromPoint(point);
    IntPtr root = child == IntPtr.Zero ? IntPtr.Zero : GetAncestor(child, 2);
    return "cursor=" + point.X + "," + point.Y + " child=" + DescribeWindow(child) + " root=" + DescribeWindow(root);
  }

  public static string DescribeWindow(IntPtr hwnd) {
    if (hwnd == IntPtr.Zero) return "<none>";
    System.Text.StringBuilder title = new System.Text.StringBuilder(256);
    System.Text.StringBuilder klass = new System.Text.StringBuilder(256);
    GetWindowText(hwnd, title, title.Capacity);
    GetClassName(hwnd, klass, klass.Capacity);
    return "0x" + hwnd.ToInt64().ToString("X") + " class='" + klass.ToString() + "' title='" + title.ToString() + "'";
  }
}
"@

[NomiNativeMouse]::SetProcessDPIAware() | Out-Null
if ($targetHwnd -ne [IntPtr]::Zero) {
  [NomiNativeMouse]::ShowWindow($targetHwnd, 9) | Out-Null
  [NomiNativeMouse]::SetWindowPos(
    $targetHwnd,
    [NomiNativeMouse]::HWND_TOPMOST,
    0,
    0,
    0,
    0,
    [NomiNativeMouse]::SWP_NOMOVE -bor [NomiNativeMouse]::SWP_NOSIZE -bor [NomiNativeMouse]::SWP_SHOWWINDOW
  ) | Out-Null
  [NomiNativeMouse]::SetForegroundWindow($targetHwnd) | Out-Null
  Start-Sleep -Milliseconds 180
}

if (-not [NomiNativeMouse]::SetCursorPos($startX, $startY)) {
  throw "SetCursorPos failed"
}
Start-Sleep -Milliseconds 120
Write-Output ("  windows hit-test before drag: " + [NomiNativeMouse]::DescribePoint())
[NomiNativeMouse]::SendMouse([NomiNativeMouse]::MOUSEEVENTF_LEFTDOWN, 0, 0)
Start-Sleep -Milliseconds 80

$steps = 24
for ($i = 1; $i -le $steps; $i++) {
  $targetX = [int][Math]::Round($deltaX * $i / $steps)
  $targetY = [int][Math]::Round($deltaY * $i / $steps)
  [NomiNativeMouse]::MoveAbsolute($startX + $targetX, $startY + $targetY)
  Start-Sleep -Milliseconds 16
}

Write-Output ("  windows hit-test before mouseup: " + [NomiNativeMouse]::DescribePoint())
Start-Sleep -Milliseconds 80
[NomiNativeMouse]::SendMouse([NomiNativeMouse]::MOUSEEVENTF_LEFTUP, 0, 0)
Start-Sleep -Milliseconds 80
Write-Output ("  windows hit-test after drag: " + [NomiNativeMouse]::DescribePoint())
}
`;
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      script,
    ],
    {
      encoding: "utf8",
      timeout: 10000,
      env: {
        ...process.env,
        NOMI_DRAG_START_X: String(start.x),
        NOMI_DRAG_START_Y: String(start.y),
        NOMI_DRAG_DELTA_X: String(delta.x),
        NOMI_DRAG_DELTA_Y: String(delta.y),
        NOMI_DRAG_HWND: String(hwnd || "0"),
      },
    },
  );
  if (result.status !== 0) {
    throw new Error(`Native mouse drag failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout || "";
}

async function dragWindowTitlebar(app, page, dragPoint) {
  const delta = { x: 180, y: 70 };
  if (process.platform === "win32") {
    const screenPoint = await windowPointToScreenPoint(app, dragPoint);
    const hwnd = await getMainWindowHandle(app);
    console.log(`  native OS drag: (${screenPoint.x}, ${screenPoint.y}) -> (${screenPoint.x + delta.x}, ${screenPoint.y + delta.y})`);
    const output = runWindowsNativeMouseDrag(screenPoint, delta, hwnd);
    if (output.trim()) console.log(output.trimEnd());
    return output;
  }

  console.log(`  playwright native drag: (${dragPoint.x}, ${dragPoint.y}) -> (${dragPoint.x + delta.x}, ${dragPoint.y + delta.y})`);
  await page.mouse.move(dragPoint.x, dragPoint.y);
  await page.mouse.down();
  await page.waitForTimeout(100);
  await page.mouse.move(dragPoint.x + delta.x, dragPoint.y + delta.y);
  await page.waitForTimeout(150);
  await page.mouse.up();
  return "";
}

let app;
let win;
try {
  ({ app, win } = await launchNomiApp({
    name: "window-drag",
    userDataDir: userData,
    args: ["--disable-gpu"],
    env: { NOMI_E2E_WINDOW_DRAG: "1" },
    settleMs: 0,
  }));

  const primaryCard = newProjectEntry(win);
  await primaryCard.waitFor({ timeout: 15000 });

  const libraryLayout = await win.evaluate(() => {
    const topbar = document.querySelector("[data-shell-topbar]");
    const main = document.querySelector(".nomi-library-page__main");
    const mainRect = main?.getBoundingClientRect() ?? null;
    const topbarRect = topbar?.getBoundingClientRect() ?? null;
    return {
      viewportWidth: window.innerWidth,
      documentClientWidth: document.documentElement.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
      topbar: topbarRect ? { top: topbarRect.top, height: topbarRect.height, right: topbarRect.right } : null,
      topbarAppRegion: topbar ? getComputedStyle(topbar).getPropertyValue("-webkit-app-region") : null,
      selfDrawnControls: Boolean(document.querySelector("[aria-label='窗口控制']")),
      main: mainRect ? {
        clientWidth: main instanceof HTMLElement ? main.clientWidth : null,
        offsetWidth: main instanceof HTMLElement ? main.offsetWidth : null,
        scrollbarWidth: main ? getComputedStyle(main).scrollbarWidth : null,
      } : null,
    };
  });

  assert(libraryLayout.documentClientWidth === libraryLayout.viewportWidth, `library document width fills viewport (${libraryLayout.documentClientWidth}/${libraryLayout.viewportWidth})`);
  assert(libraryLayout.bodyScrollWidth === libraryLayout.viewportWidth, `library body has no horizontal overflow (${libraryLayout.bodyScrollWidth}/${libraryLayout.viewportWidth})`);
  assert(Boolean(libraryLayout.topbar), "project library shares the 40px top bar");
  assert(Math.abs(libraryLayout.topbar.top) <= 1 && Math.abs(libraryLayout.topbar.height - 40) <= 1, `library top bar is 40px at the window top (top=${libraryLayout.topbar.top}, height=${libraryLayout.topbar.height})`);
  assert(libraryLayout.topbarAppRegion === "drag", `library top bar is the native drag region (${libraryLayout.topbarAppRegion})`);
  assert(!libraryLayout.selfDrawnControls, "no self-drawn window controls (native titleBarOverlay)");
  assert(Boolean(libraryLayout.main), "project library scroll area is mounted");
  assert(libraryLayout.main.clientWidth === libraryLayout.main.offsetWidth, `project library scroll area has no reserved scrollbar gutter (${libraryLayout.main.clientWidth}/${libraryLayout.main.offsetWidth})`);
  assert(libraryLayout.main.scrollbarWidth === "none", `project library scrollbar is hidden (${libraryLayout.main.scrollbarWidth})`);

  await primaryCard.click();
  // 项目库与项目里是同一条顶栏（都有 data-shell-topbar），所以不能拿它当「项目已打开」的信号——
  // 只有项目里才有项目名菜单；否则下面会量到切换途中还没画出来的空顶栏（height=0）。
  await win.locator("[data-shell-project-menu]").waitFor({ timeout: stationTimeout({ operations: 2 }) });
  await win.bringToFront();

  await resetMainWindowBounds(app);
  await win.waitForTimeout(300);

  const layout = await win.evaluate(() => {
    const header = document.querySelector("[data-shell-topbar]");
    if (!header) return null;
    const headerRect = header.getBoundingClientRect();
    const buttons = [...header.querySelectorAll("button")];
    return {
      viewportWidth: window.innerWidth,
      documentClientWidth: document.documentElement.clientWidth,
      header: { top: headerRect.top, height: headerRect.height, right: headerRect.right },
      headerAppRegion: getComputedStyle(header).getPropertyValue("-webkit-app-region"),
      buttonsNoDrag: buttons.every((button) => getComputedStyle(button).getPropertyValue("-webkit-app-region") === "no-drag"),
      selfDrawnControls: Boolean(document.querySelector("[aria-label='窗口控制']")),
    };
  });

  assert(Boolean(layout), "workbench 40px top bar is mounted");
  assert(Math.abs(layout.header.top) <= 1, `top bar starts at window top (top=${layout.header.top})`);
  assert(Math.abs(layout.header.height - 40) <= 1, `top bar is 40px (height=${layout.header.height})`);
  assert(layout.headerAppRegion === "drag", `top bar is the native drag region (${layout.headerAppRegion})`);
  assert(layout.buttonsNoDrag, "every top bar button is excluded from native drag");
  assert(!layout.selfDrawnControls, "no self-drawn window controls (native titleBarOverlay)");
  assert(layout.documentClientWidth === layout.viewportWidth, `document client width fills viewport (${layout.documentClientWidth}/${layout.viewportWidth})`);
  assert(Math.abs(layout.header.right - layout.viewportWidth) <= 1, `top bar reaches right edge (${layout.header.right}/${layout.viewportWidth})`);

  const dragPoint = await win.evaluate(() => {
    const header = document.querySelector("[data-shell-topbar]");
    if (!header) return null;

    function box(selector) {
      const element = document.querySelector(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
    }

    function isInteractivePoint(x, y) {
      const hit = document.elementFromPoint(x, y);
      return !hit || Boolean(hit.closest(".app-no-drag"));
    }

    const rect = header.getBoundingClientRect();
    const y = Math.round(rect.top + rect.height / 2);
    const candidates = [];

    // 中间分段器两侧的空白最稳：先试分段器左右，再按比例扫。
    const stepper = box("[data-shell-topbar] .nomi-stepper");
    if (stepper) candidates.push(Math.round(stepper.left - 40), Math.round(stepper.right + 60));
    for (let ratio = 0.1; ratio <= 0.75; ratio += 0.05) {
      candidates.push(Math.round(rect.left + rect.width * ratio));
    }

    for (const x of candidates) {
      if (x <= rect.left + 8 || x >= rect.right - 8) continue;
      if (!isInteractivePoint(x, y)) {
        const hit = document.elementFromPoint(x, y);
        const hitRect = hit?.getBoundingClientRect() ?? null;
        return {
          x,
          y,
          tag: hit?.tagName ?? null,
          className: hit instanceof HTMLElement ? hit.className : null,
          appRegion: hit ? getComputedStyle(hit).getPropertyValue("-webkit-app-region") : null,
          rect: hitRect ? {
            left: hitRect.left,
            top: hitRect.top,
            right: hitRect.right,
            bottom: hitRect.bottom,
            width: hitRect.width,
            height: hitRect.height,
          } : null,
        };
      }
    }
    return null;
  });

  assert(Boolean(dragPoint), "40px top bar has a non-interactive drag point");
  assert(dragPoint.appRegion === "drag", `drag point itself uses native drag region (${dragPoint.tag}.${dragPoint.className} -> ${dragPoint.appRegion})`);

  const before = await resetMainWindowBounds(app);
  const beforeGeometry = await getMainWindowGeometry(app);
  await win.waitForTimeout(200);
  await win.bringToFront();
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((candidate) => (
      !candidate.isDestroyed() && candidate.isVisible()
    ));
    if (!win) throw new Error("No visible BrowserWindow");
    win.focus();
  });
  await dragWindowTitlebar(app, win, dragPoint);
  await win.waitForTimeout(700);

  const after = await getMainWindowBounds(app);
  const afterGeometry = await getMainWindowGeometry(app);
  const moved = distance(before, after);
  assert(
    moved >= 20,
    `window moved after native titlebar drag (before=${before.x},${before.y}; after=${after.x},${after.y}; delta=${moved})`,
  );
  assert(
    sizeDelta(beforeGeometry.bounds, afterGeometry.bounds) <= 1 &&
      sizeDelta(beforeGeometry.contentBounds, afterGeometry.contentBounds) <= 1,
    `native titlebar drag keeps window size stable (bounds before=${beforeGeometry.bounds.width}x${beforeGeometry.bounds.height}; after=${afterGeometry.bounds.width}x${afterGeometry.bounds.height}; content before=${beforeGeometry.contentBounds.width}x${beforeGeometry.contentBounds.height}; after=${afterGeometry.contentBounds.width}x${afterGeometry.contentBounds.height})`,
  );
  assert(!(await isMainWindowMaximized(app)), "native titlebar drag does not maximize the window");

  console.log(`\nWINDOW DRAG PASS: ${passed} assertions`);
} catch (error) {
  console.error(`\n${error?.message || error}`);
  process.exitCode = 1;
} finally {
  if (app) await app.close().catch(() => undefined);
  fs.rmSync(userData, { recursive: true, force: true });
}
