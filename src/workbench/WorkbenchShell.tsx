import React from "react";
import "./workbench.css";
import "./workbench-ai.css";
import { IconBox, IconBrowser } from "@tabler/icons-react";
import { NomiBrand, NomiLoadingMark } from "../design";
import NomiAppBar from "../ui/app-shell/NomiAppBar";
import { AboutNomiPopover } from "../ui/app-shell/AboutNomiPopover";
import {
    isWorkspaceMode,
    useWorkbenchStore,
    type WorkspaceMode,
} from "./workbenchStore";
import { cn } from "../utils/cn";
import ProjectExplorerSidebar from "./explorer/ProjectExplorerSidebar";
import { lazyWithChunkBoundary } from "../ui/chunkBoundary";
import { WindowControls } from "../ui/app-shell/WindowControls";
import { handleWindowTitlebarDoubleClick } from "../ui/app-shell/windowTitlebarDoubleClick";
import { OnboardingChecklist } from "./onboarding/OnboardingChecklist";
import {
    dispatchGlobalAssetPopoverOpen,
    getGlobalAssetPopoverAnchorRect,
} from "../ui/browser/overlay/globalAssetPopoverEvents";
import { useGlobalBrowserAssetCount } from "../ui/browser/assets/useGlobalBrowserAssets";

// 工作区懒加载走容错域（审计 A5）：单个工作区 chunk 失败不拖死其余工作区。
const CreationWorkspace = lazyWithChunkBoundary(
    "创作区",
    () => import("./creation/CreationWorkspace"),
);
const GenerationWorkspace = lazyWithChunkBoundary(
    "生成区",
    () => import("./generation/GenerationWorkspace"),
);
const PreviewWorkspace = lazyWithChunkBoundary("预览区", () => import("./preview/PreviewWorkspace"));

type WorkbenchShellProps = {
    generation: React.ReactNode;
    generationAi?: React.ReactNode;
    generationAiLayout?: "sidebar" | "overlay";
    projectId?: string | null;
    projectName?: string;
    onBackToLibrary?: () => void;
    onOpenModelCatalog?: () => void;
    onRenameProject?: (name: string) => void;
};

const STEP_PARAM_BY_MODE: Record<WorkspaceMode, string> = {
    creation: "create",
    generation: "generate",
    preview: "preview",
};

const MODE_BY_STEP_PARAM: Record<string, WorkspaceMode> = {
    create: "creation",
    creation: "creation",
    generate: "generation",
    generation: "generation",
    preview: "preview",
};

type WorkspaceSlotProps = {
    active: boolean;
    children: React.ReactNode;
    label: string;
};

function WorkspaceLoading({ label }: { label: string }): JSX.Element {
    return (
        <div
            className={cn(
                "workbench-shell__loading",
                "w-full h-full bg-workbench-bg grid place-items-center",
            )}
            aria-label={`${label}加载中`}
        >
            {/* pending 规范 #1:懒加载占位不再是空白色块,给可见品牌 spinner */}
            <NomiLoadingMark size={28} label={`${label}加载中`} />
        </div>
    );
}

function WorkspaceSlot({
    active,
    children,
    label,
}: WorkspaceSlotProps): JSX.Element {
    return (
        <div
            className={cn(
                "workbench-shell__workspace",
                "w-full h-full min-w-0 min-h-0",
            )}
            hidden={!active}>
            <React.Suspense
                fallback={active ? <WorkspaceLoading label={label} /> : null}>
                {children}
            </React.Suspense>
        </div>
    );
}

function readWorkspaceModeFromUrl(): WorkspaceMode {
    if (typeof window === "undefined") return "generation";
    try {
        const step = String(
            new URL(window.location.href).searchParams.get("step") || "",
        ).trim();
        return MODE_BY_STEP_PARAM[step] || "generation";
    } catch {
        return "generation";
    }
}


function writeWorkspaceModeToUrl(mode: WorkspaceMode): void {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const step = STEP_PARAM_BY_MODE[mode];
    if (url.searchParams.get("step") === step) return;
    url.searchParams.set("step", step);
    window.history.replaceState(null, "", url.toString());
}

function openBrowser(): void {
    window.dispatchEvent(new CustomEvent("nomi-open-browser"));
}

export default function WorkbenchShell({
    generation,
    generationAi,
    generationAiLayout = "sidebar",
    projectId,
    projectName,
    onBackToLibrary,
    onOpenModelCatalog,
    onRenameProject,
}: WorkbenchShellProps): JSX.Element {
    const workspaceMode = useWorkbenchStore((state) => state.workspaceMode);
    const setWorkspaceMode = useWorkbenchStore(
        (state) => state.setWorkspaceMode,
    );
    const categories = useWorkbenchStore((state) => state.categories);
    const [mountedWorkspaceModes, setMountedWorkspaceModes] = React.useState<
        WorkspaceMode[]
    >(() => [workspaceMode]);
    const [aboutOpen, setAboutOpen] = React.useState(false);
    const brandRef = React.useRef<HTMLButtonElement | null>(null);
    const assetCount = useGlobalBrowserAssetCount();

    // 仅 win32 自绘标题栏：mac/Linux 保持原生窗口 chrome，不渲染 windowbar（P4 通用·按平台分流）。
    const isWindows = window.nomiDesktop?.platform === "win32";

    React.useEffect(() => {
        // store 是 workspaceMode 的唯一真相源：打开项目时各入口已显式设好模式
        // （openProject 常规→generation、newProject 新建→creation）。挂载时直接沿用 store，并把 URL
        // 同步成它——不回读 URL 的 ?step（hash 路由下它在 search 段、跨导航会残留，曾导致
        // 打开项目落错 tab）。?step 仅作为浏览器前进/后退（popstate）的载体。
        const initialMode = useWorkbenchStore.getState().workspaceMode;
        writeWorkspaceModeToUrl(initialMode);

        const onPopState = () => {
            setWorkspaceMode(readWorkspaceModeFromUrl());
        };
        window.addEventListener("popstate", onPopState);
        return () => window.removeEventListener("popstate", onPopState);
    }, [setWorkspaceMode]);

    React.useEffect(() => {
        setMountedWorkspaceModes((current) =>
            current.includes(workspaceMode)
                ? current
                : [...current, workspaceMode],
        );
    }, [workspaceMode]);

    const handleWorkspaceModeChange = React.useCallback(
        (mode: WorkspaceMode) => {
            if (!isWorkspaceMode(mode)) return;
            setWorkspaceMode(mode);
            writeWorkspaceModeToUrl(mode);
        },
        [setWorkspaceMode],
    );

    return (
        <div
            className={cn(
                "workbench-shell",
                "flex flex-col w-full h-full min-h-0",
                "bg-workbench-bg text-workbench-ink",
                'font-nomi-sans [font-feature-settings:"cv02","cv03","cv04","tnum"]',
            )}
            data-workspace-mode={workspaceMode}>
            {isWindows ? (
                <div
                    className={cn(
                        "workbench-windowbar",
                        "app-drag",
                        "relative flex h-8 w-full shrink-0 items-center",
                        "bg-workbench-surface text-workbench-ink",
                    )}
                    aria-label="窗口标题栏"
                    onDoubleClick={handleWindowTitlebarDoubleClick}
                >
                    <button
                        ref={brandRef}
                        type="button"
                        className={cn(
                            "workbench-windowbar__brand",
                            "app-no-drag relative z-[2] inline-flex h-full items-center pl-4 pr-3",
                            "border-0 bg-transparent cursor-pointer rounded-none text-workbench-ink",
                            "transition-[opacity] duration-[var(--nomi-transition-fast)] hover:opacity-80",
                        )}
                        aria-label="关于 Nomi · 检查更新"
                        aria-haspopup="dialog"
                        aria-expanded={aboutOpen}
                        onClick={() => setAboutOpen((open) => !open)}
                    >
                        <NomiBrand markSize={18} wordSize={14} />
                    </button>
                    {aboutOpen ? (
                        <AboutNomiPopover anchorEl={brandRef.current} onClose={() => setAboutOpen(false)} />
                    ) : null}
                    <div
                        className="app-drag relative z-[1] h-full min-w-0 flex-1"
                        data-window-drag-region="true"
                        aria-hidden="true"
                    />
                    <div className="app-no-drag relative z-[2] inline-flex h-full items-center pt-0.5 pb-0.5">
                        <OnboardingChecklist />
                    </div>
                    <div
                        className={cn(
                            "app-no-drag relative z-[2] inline-flex h-full items-center gap-1 pt-0.5 pb-0.5",
                            "text-workbench-muted",
                        )}
                        role="toolbar"
                        aria-label="项目快捷操作"
                    >
                        <button
                            type="button"
                            className={cn(
                                "inline-flex h-7 items-center gap-1.5 rounded-pill border-0 bg-transparent px-2",
                                "cursor-pointer font-inherit text-caption text-workbench-muted",
                                "transition-colors hover:text-workbench-ink",
                            )}
                            aria-label="打开浏览器"
                            title="浏览器"
                            onClick={openBrowser}
                        >
                            <IconBrowser size={14} stroke={1.8} aria-hidden="true" />
                            <span>浏览器</span>
                        </button>
                        <button
                            type="button"
                            className={cn(
                                "inline-flex h-7 items-center gap-1.5 rounded-pill border-0 bg-transparent px-2",
                                "cursor-pointer font-inherit text-caption text-workbench-muted",
                                "transition-colors hover:text-workbench-ink",
                            )}
                            aria-label="打开素材盒"
                            title="素材盒"
                            onClick={(event) => {
                                dispatchGlobalAssetPopoverOpen(
                                    true,
                                    getGlobalAssetPopoverAnchorRect(event.currentTarget),
                                );
                            }}
                        >
                            <IconBox size={14} stroke={1.7} aria-hidden="true" />
                            <span>素材盒</span>
                            {assetCount > 0 ? (
                                <span
                                    className="inline-flex h-[16px] min-w-[16px] items-center justify-center rounded-pill bg-nomi-accent-soft px-1.5 text-micro font-semibold leading-none text-nomi-accent"
                                    aria-label={`${assetCount} 个素材`}
                                >
                                    {assetCount > 99 ? '99+' : assetCount}
                                </span>
                            ) : null}
                        </button>
                    </div>
                    <WindowControls className="relative z-[2]" />
                </div>
            ) : null}
            <NomiAppBar
                workspaceMode={workspaceMode}
                onWorkspaceModeChange={handleWorkspaceModeChange}
                projectName={projectName}
                onBackToLibrary={onBackToLibrary}
                onOpenModelCatalog={onOpenModelCatalog}
                onRenameProject={onRenameProject}
            />

            {/* 左侧面板重做: 分类导航 + 文件树统一收进 ProjectExplorerSidebar 的双 Tab。
          创作模式是纯文稿写作，不挂项目资源树（仅生成/预览显示）。 */}
            <main
                className={cn(
                    "workbench-shell__body",
                    "relative min-w-0 min-h-0 overflow-hidden flex flex-1",
                )}>
                {/* 文件树只在生成区显示：创作是纯文稿、预览/剪辑是回看时间轴，都不需要左侧资源树。 */}
                {workspaceMode === "generation" ? (
                    <ProjectExplorerSidebar projectId={projectId ?? null} categories={categories} />
                ) : null}
                <div className='flex-1 min-w-0 min-h-0 relative'>
                    {mountedWorkspaceModes.includes("creation") ? (
                        <WorkspaceSlot
                            active={workspaceMode === "creation"}
                            label='创作区'>
                            <CreationWorkspace />
                        </WorkspaceSlot>
                    ) : null}
                    {mountedWorkspaceModes.includes("generation") ? (
                        <WorkspaceSlot
                            active={workspaceMode === "generation"}
                            label='生成区'>
                            <GenerationWorkspace
                                canvas={generation}
                                aiSidebar={generationAi}
                                aiLayout={generationAiLayout}
                            />
                        </WorkspaceSlot>
                    ) : null}
                    {mountedWorkspaceModes.includes("preview") ? (
                        <WorkspaceSlot
                            active={workspaceMode === "preview"}
                            label='预览区'>
                            <PreviewWorkspace />
                        </WorkspaceSlot>
                    ) : null}
                </div>
            </main>
        </div>
    );
}
