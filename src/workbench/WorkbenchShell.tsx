import React from "react";
import { createPortal } from 'react-dom';
import { useTranslation } from "react-i18next";
import "./workbench.css";
import { IconBrowser } from "@tabler/icons-react";
import { NomiBrand, NomiLoadingMark } from "../design";
import NomiAppBar from "../ui/app-shell/NomiAppBar";
import {
    isWorkspaceMode,
    useWorkbenchStore,
    type WorkspaceMode,
} from "./workbenchStore";
import { cn } from "../utils/cn";
import ProjectExplorerSidebar from "./explorer/ProjectExplorerSidebar";
import DocumentListSidebar from "./creation/DocumentListSidebar";
import { workspaceModeCarriesCreationResourceTree } from "./creation/creationResourceTreeModes";
import { lazyWithChunkBoundary } from "../ui/chunkBoundary";
import { WindowControls } from "../ui/app-shell/WindowControls";
import { handleWindowTitlebarDoubleClick } from "../ui/app-shell/windowTitlebarDoubleClick";
import { OnboardingChecklist } from "./onboarding/OnboardingChecklist";
import ProjectAgentResidentShell from './ai/ProjectAgentResidentShell';
import { useUpdater } from '../ui/app-shell/useUpdater';
import { UpdaterDialog } from '../ui/app-shell/UpdaterDialog';
import { useGenerationCanvasStore } from './generationCanvas/store/generationCanvasStore';
import { useProductionRunStore } from './production/productionRunStore';

// 工作区懒加载走容错域（审计 A5）：单个工作区 chunk 失败不拖死其余工作区。
const CreationWorkspace = lazyWithChunkBoundary(
    "创作区",
    () => import("./creation/CreationWorkspace"),
);
// 分镜独立工作区（v5 C3）：storyboard 模式不再共用 CreationWorkspace，
// 单独懒挂载全宽 StoryboardWorkspace（表本身全宽；创作资源树由本 shell 统一挂，见下）。
const StoryboardWorkspace = lazyWithChunkBoundary(
    "i18n:workspace.storyboard",
    () => import("./creation/storyboard/StoryboardWorkspace"),
);
const GenerationWorkspace = lazyWithChunkBoundary(
    "生成区",
    () => import("./generation/GenerationWorkspace"),
);
const PreviewWorkspace = lazyWithChunkBoundary("预览区", () => import("./preview/PreviewWorkspace"));

type WorkbenchShellProps = {
    generation: React.ReactNode;
    projectId?: string | null;
    projectName?: string;
    onBackToLibrary?: () => void;
    onOpenModelCatalog?: () => void;
    onOpenSettings?: () => void;
    onRenameProject?: (name: string) => void;
};

const STEP_PARAM_BY_MODE: Record<WorkspaceMode, string> = {
    creation: "create",
    storyboard: "storyboard",
    generation: "generate",
    preview: "preview",
};

const MODE_BY_STEP_PARAM: Record<string, WorkspaceMode> = {
    create: "creation",
    creation: "creation",
    storyboard: "storyboard",
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
    const { t } = useTranslation();
    const loadingLabel = t("workspace.loading", { label });
    return (
        <div
            className={cn(
                "workbench-shell__loading",
                "w-full h-full bg-workbench-bg grid place-items-center",
            )}
            aria-label={loadingLabel}
        >
            {/* pending 规范 #1:懒加载占位不再是空白色块,给可见品牌 spinner */}
            <NomiLoadingMark size={28} label={loadingLabel} />
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
    projectId,
    projectName,
    onBackToLibrary,
    onOpenModelCatalog,
    onOpenSettings,
    onRenameProject,
}: WorkbenchShellProps): JSX.Element {
    const { t } = useTranslation();
    const workspaceMode = useWorkbenchStore((state) => state.workspaceMode);
    const setWorkspaceMode = useWorkbenchStore(
        (state) => state.setWorkspaceMode,
    );
    const categories = useWorkbenchStore((state) => state.categories);
    const agentDockCollapsed = useWorkbenchStore((state) => state.projectAgentDockCollapsed);
    // 常驻 Agent 无条件渲染（2026-09-05 开闸）：发布闸 agentHostPreference 已随开闸删除——
    // 它曾让「用户日常用的产品」和「测试跑的产品」变成两条路（并行版，P1）。
    // 未完成的能力用 header 上的 Beta 徽标明说（D4 诚实交付），不再靠藏整套 UI 遮掩。
    const [agentDockTargets, setAgentDockTargets] = React.useState<Record<'creation' | 'storyboard' | 'generation' | 'preview', HTMLDivElement | null>>({ creation: null, storyboard: null, generation: null, preview: null });
    const setAgentDockTarget = React.useCallback((surface: 'creation' | 'storyboard' | 'generation' | 'preview') => (node: HTMLDivElement | null) => {
        setAgentDockTargets((current) => current[surface] === node ? current : { ...current, [surface]: node });
    }, []);
    const agentDockRefs = React.useMemo(() => ({
        creation: setAgentDockTarget('creation'),
        storyboard: setAgentDockTarget('storyboard'),
        generation: setAgentDockTarget('generation'),
        preview: setAgentDockTarget('preview'),
    }), [setAgentDockTarget]);
    // Storyboard owns its own full-width workspace and its own dock target.
    // Falling through to creation here portals the resident Agent into the
    // hidden creation slot whenever storyboard is active.
    const agentSurface = workspaceMode === 'generation'
        ? 'generation'
        : workspaceMode === 'preview'
            ? 'preview'
            : workspaceMode === 'storyboard'
                ? 'storyboard'
                : 'creation';
    const agentDock = agentDockTargets[agentSurface];
    const updater = useUpdater();
    const hasRunningCanvasTask = useGenerationCanvasStore((state) => state.nodes.some((node) => node.status === 'running'));
    const productionRun = useProductionRunStore((state) => state.projectId === projectId ? state.run : null);
    const hasRunningTask = hasRunningCanvasTask || productionRun?.status === 'running' || productionRun?.status === 'pausing' || productionRun?.status === 'exporting';
    const [mountedWorkspaceModes, setMountedWorkspaceModes] = React.useState<
        WorkspaceMode[]
    >(() => [workspaceMode]);

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

    // Some workspace actions (for example a storyboard summary card) update
    // the shared mode store directly instead of going through the app-bar
    // callback. Keep the URL projection in sync for those visible entries too;
    // otherwise a restart/back-forward can restore `step=create` while the
    // user is already in the storyboard workspace.
    React.useEffect(() => {
        writeWorkspaceModeToUrl(workspaceMode);
    }, [workspaceMode]);

    React.useEffect(() => {
        setMountedWorkspaceModes((current) =>
            current.includes(workspaceMode)
                ? current
                : [...current, workspaceMode],
        );
    }, [workspaceMode]);

    // 「定位到它」这个入口随旧面板一起删了：v4 的八个积木里没有定位控件——
    // icon 标的是**动的那个对象**，不是一个可以点的跳转。留着一个没人派发的监听，
    // 正是 `customEventWiring` 那条不变量要抓的死码（有监听没派发 = 这个入口永远打不开）。
    // 要恢复这条能力，得先在设计里给它一个控件，再同时补派发方与监听方。

    React.useEffect(() => {
        const onOpenSkillLibrary = () => {
            if (workspaceMode !== "generation") {
                setWorkspaceMode("generation");
                writeWorkspaceModeToUrl("generation");
            }
            window.setTimeout(() => window.dispatchEvent(new Event("nomi-open-skill-library")), 0);
        };
        window.addEventListener("nomi-focus-skill-library", onOpenSkillLibrary);
        return () => window.removeEventListener("nomi-focus-skill-library", onOpenSkillLibrary);
    }, [setWorkspaceMode, workspaceMode]);

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
                    aria-label={t("appBar.windowTitleBar")}
                    onDoubleClick={handleWindowTitlebarDoubleClick}
                >
                    {/* 品牌回归纯品牌（§1.5 归位）：过去这颗钮一钮四用（品牌 + 上手手册 + 明暗 + 检查更新），
                        四件事已各自归位到设置「关于」/「通用」。mac 那面（NomiAppBar）同步处理，两平台一致。 */}
                    <span
                        className={cn(
                            "workbench-windowbar__brand",
                            "app-no-drag relative z-[2] inline-flex h-full items-center pl-4 pr-3",
                            "text-workbench-ink",
                        )}
                    >
                        <NomiBrand markSize={18} wordSize={14} />
                    </span>
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
                        aria-label={t("appBar.projectQuickActions")}
                    >
                        <button
                            type="button"
                            className={cn(
                                "inline-flex h-7 items-center gap-1.5 rounded-pill border-0 bg-transparent px-2",
                                "cursor-pointer font-inherit text-caption text-workbench-muted",
                                "transition-colors hover:text-workbench-ink",
                            )}
                            aria-label={t("appBar.openBrowser")}
                            title={t("appBar.browser")}
                            onClick={openBrowser}
                        >
                            <IconBrowser size={14} stroke={1.8} aria-hidden="true" />
                            <span>{t("appBar.browser")}</span>
                        </button>
                    </div>
                    <WindowControls className="relative z-[2]" />
                </div>
            ) : null}
            <NomiAppBar
                workspaceMode={workspaceMode}
                onWorkspaceModeChange={handleWorkspaceModeChange}
                projectName={projectName}
                projectId={projectId}
                onBackToLibrary={onBackToLibrary}
                onOpenModelCatalog={onOpenModelCatalog}
                onOpenSettings={onOpenSettings}
                onRenameProject={onRenameProject}
            />
            <UpdaterDialog updater={updater} hasRunningTask={hasRunningTask} />

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
                {/* 创作资源树（原稿 + 各自的分镜方案）：写剧本和编分镜表是同一批资源的两个视图，
                    所以树归 shell 所有、跨这两个模式常驻——挂在任一工作区里都会让另一个工作区
                    没有树（2026-09-06 回归：点开一个方案就再也点不到别的剧本/分镜）。 */}
                {workspaceModeCarriesCreationResourceTree(workspaceMode) ? <DocumentListSidebar /> : null}
                <div className='flex-1 min-w-0 min-h-0 relative'>
                    {mountedWorkspaceModes.includes("creation") ? (
                        <WorkspaceSlot
                            active={workspaceMode === "creation"}
                            label={t("workspace.creation")}>
                            <CreationWorkspace aiCollapsed={agentDockCollapsed} agentDockRef={agentDockRefs.creation} />
                        </WorkspaceSlot>
                    ) : null}
                    {mountedWorkspaceModes.includes("storyboard") ? (
                        <WorkspaceSlot
                            active={workspaceMode === "storyboard"}
                            label={t("workspace.storyboard")}>
                                <StoryboardWorkspace projectId={projectId} aiCollapsed={agentDockCollapsed} agentDockRef={agentDockRefs.storyboard} />
                        </WorkspaceSlot>
                    ) : null}
                    {mountedWorkspaceModes.includes("generation") ? (
                        <WorkspaceSlot
                            active={workspaceMode === "generation"}
                            label={t("workspace.generation")}>
                            <GenerationWorkspace
                                canvas={generation}
                                aiCollapsed={agentDockCollapsed}
                                agentDockRef={agentDockRefs.generation}
                            />
                        </WorkspaceSlot>
                    ) : null}
                    {mountedWorkspaceModes.includes("preview") ? (
                        <WorkspaceSlot
                            active={workspaceMode === "preview"}
                            label={t("workspace.preview")}>
                            <PreviewWorkspace
                                aiCollapsed={agentDockCollapsed}
                                agentDockRef={agentDockRefs.preview}
                            />
                        </WorkspaceSlot>
                    ) : null}
                </div>
                {agentDock ? createPortal(<ProjectAgentResidentShell surface={agentSurface} />, agentDock) : null}
            </main>
        </div>
    );
}
