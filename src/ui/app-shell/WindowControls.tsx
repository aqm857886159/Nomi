import React from "react";
import { IconMinus, IconSquare, IconX } from "@tabler/icons-react";
import { cn } from "../../utils/cn";
import { useTranslation } from "react-i18next";

const isWindows = window.nomiDesktop?.platform === "win32";

/**
 * Windows 自绘窗口控制（最小化/最大化/关闭）。frame:false 去掉原生标题栏后由它接管。
 * 非 Windows（mac/Linux 原生 chrome）渲染为 null——红绿灯交系统，不自绘、不重复（P1）。
 */
export function WindowControls({ className }: { className?: string }): JSX.Element | null {
  const { t } = useTranslation();
  const [maximized, setMaximized] = React.useState(false);

  React.useEffect(() => {
    const off = window.nomiDesktop?.window?.onMaximized?.((v) => setMaximized(v));
    return () => off?.();
  }, []);

  if (!isWindows) return null;

  const btnBase = cn(
    "app-no-drag inline-flex items-center justify-center w-11 h-full",
    "border-none bg-transparent cursor-pointer text-[var(--nomi-ink-60)]",
    "transition-[background,color] duration-[var(--nomi-transition-fast)]",
    "hover:bg-[var(--nomi-ink-05)] hover:text-[var(--nomi-ink)]",
  );

  return (
    <div className={cn("app-no-drag inline-flex items-center h-full shrink-0", className)} aria-label={t('window.controls')}>
      <button
        type="button"
        className={btnBase}
        aria-label={t('window.minimize')}
        onClick={() => window.nomiDesktop?.window?.minimize?.()}
      >
        <IconMinus size={12} stroke={1.8} />
      </button>
      <button
        type="button"
        className={btnBase}
        aria-label={maximized ? t('window.restore') : t('window.maximize')}
        onClick={() => window.nomiDesktop?.window?.maximize?.()}
      >
        <IconSquare size={12} stroke={1.8} />
      </button>
      <button
        type="button"
        className={cn(btnBase, "hover:!bg-[var(--workbench-danger)] hover:!text-white")}
        aria-label={t('window.close')}
        onClick={() => window.nomiDesktop?.window?.close?.()}
      >
        <IconX size={12} stroke={1.8} />
      </button>
    </div>
  );
}
