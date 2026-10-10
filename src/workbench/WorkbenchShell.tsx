import React, { type JSX } from "react";
import { WorkspacePanelFrameContext } from "./WorkspacePanelFrame";
import { useTranslation } from "react-i18next";
import "./workbench.css";
import { NomiLoadingMark } from "../design";
import {
    isWorkspaceMode,
    useWorkbenchStore,
    type WorkspaceMode,
} from "./workbenchStore";
import { assistantWidthMaxFor } from "./assistantWidthBounds";
import { cn } from "../utils/cn";
import { cancelCanvasDraggingWithin } from "./generationCanvas/components/canvasDraggingFlag";
import { getGenerationNodeExecutionKind } from "./generationCanvas/model/generationNodeKinds";
import { workspaceModeCarriesCreationResourceTree } from "./creation/creationResourceTreeModes";
import { computeTimelineDuration } from "./timeline/timelineMath";
import { lazyWithChunkBoundary } from "../ui/chunkBoundary";
import ProjectAgentResidentShell from './ai/ProjectAgentResidentShell';
import { useGenerationCanvasStore } from './generationCanvas/store/generationCanvasStore';
import { ShellFrame } from '../ui/app-shell/shell/ShellFrame';
import { ShellTopBar } from '../ui/app-shell/shell/ShellTopBar';
import { ShellRail } from '../ui/app-shell/shell/ShellRail';
import { ShellAgentHost } from '../ui/app-shell/shell/ShellAgentHost';
import { useEffectiveAgentForm } from '../ui/app-shell/shell/agentFormStore';
import { useShellLayoutStore } from '../ui/app-shell/shell/shellLayoutStore';

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
    projectFeedback?: React.ReactNode;
    generation: React.ReactNode;
    projectId?: string | null;
    projectName?: string;
    onBackToLibrary?: () => void;
    onOpenSettings?: () => void;
    onRenameProject?: (name: string) => void;
    /** 顶栏项目菜单：最近项目 / 新建。 */
    onOpenProject?: (projectId: string) => void;
    onNewProject?: () => void;
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
    const slot = React.useRef<HTMLDivElement>(null);
    // 槽位被藏起来 = 这里面还没结束的手势被打断。**隐藏是宿主自己知道的事**，
    // 所以由它显式喊一声；画布那边因此不用给每次手势装一个扫祖先链的 MutationObserver
    // （那条路每帧一轮 getComputedStyle，正压在拖图热路径上，见 canvasDraggingFlag 顶部注释）。
    React.useEffect(() => {
        if (active) return;
        cancelCanvasDraggingWithin(slot.current);
    }, [active]);
    // 卸载同理：租约记着那张 stage，走掉了就没人再来收尾。
    React.useEffect(() => () => cancelCanvasDraggingWithin(slot.current), []);
    return (
        <div
            ref={slot}
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

/** m:ss（顶栏「预览 0:26」）。 */
function formatDuration(seconds: number): string {
    const whole = Math.max(0, Math.round(seconds));
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/**
 * 顶栏阶段段后面的真实进度（10-08 外壳拍板稿「生成 5/6」「预览 0:26」）：
 * 生成 = 画布上出了结果的生成节点 / 全部生成节点（图 / 视频 / 声音）；预览 = 时间轴总时长。没有就不显示。
 */
function useStepperMeta(): Partial<Record<"creation" | "generation" | "preview", string>> {
    const generation = useGenerationCanvasStore((state) => {
        let total = 0;
        let done = 0;
        for (const node of state.nodes) {
            const kind = getGenerationNodeExecutionKind(node.kind);
            if (kind !== "image" && kind !== "video" && kind !== "audio") continue;
            total += 1;
            if (node.status === "success" && node.result?.url) done += 1;
        }
        return total > 0 ? `${done}/${total}` : "";
    });
    const timeline = useWorkbenchStore((state) => state.timeline);
    const preview = React.useMemo(() => {
        const clips = (timeline.tracks ?? []).reduce((sum, track) => sum + (track.clips?.length ?? 0), 0);
        if (clips === 0) return "";
        return formatDuration(computeTimelineDuration(timeline) / Math.max(1, timeline.fps));
    }, [timeline]);
    return React.useMemo(() => ({
        ...(generation ? { generation } : {}),
        ...(preview ? { preview } : {}),
    }), [generation, preview]);
}

export default function WorkbenchShell({
    projectFeedback,
    generation,
    projectId,
    projectName,
    onBackToLibrary,
    onOpenSettings,
    onRenameProject,
    onOpenProject,
    onNewProject,
}: WorkbenchShellProps): JSX.Element {
    const { t } = useTranslation();
    const workspaceMode = useWorkbenchStore((state) => state.workspaceMode);
    const setWorkspaceMode = useWorkbenchStore(
        (state) => state.setWorkspaceMode,
    );
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
    // 小球 / 浮窗的坐标系：生成页给画布那一格（让开底边时间轴），其余页用整块内容区。
    const [generationAgentLayer, setGenerationAgentLayer] = React.useState<HTMLDivElement | null>(null);
    // Agent 占不占右栏由这一页的形态决定（停靠才占）。
    const agentForm = useEffectiveAgentForm(agentSurface);
    const workspaceAiCollapsed = agentForm !== 'dock';
    const railCollapsed = useShellLayoutStore((state) => state.railCollapsed);
    const setRailCollapsed = useShellLayoutStore((state) => state.setRailCollapsed);
    const stepperMeta = useStepperMeta();
    const [mountedWorkspaceModes, setMountedWorkspaceModes] = React.useState<
        WorkspaceMode[]
    >(() => [workspaceMode]);

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

    /**
     * 窗口变窄时把**超限的**面板宽度钳回来（09-01 定稿 §11.2 窄窗态）。
     *
     * 只收上限、不动没超限的宽度：用户拖出来的 340 在任何窗口下都还是 340，窗口变窄不是他改主意了。
     * 超限的那份必须钳——不钳的话内容侧（探索栏 60 + 画布底线 700 = 760）会被面板吃掉，
     * 画布窄到看不了，而用户看到的现象是「窗口一小画布就废了」，根本联想不到是面板宽度。
     *
     * 放在这里而不是某个面里：面板四个面共用同一个 `assistantWidth`，钳一次就够；
     * 挂在某个面上，切到别的面再缩窗口就漏了。
     */
    React.useEffect(() => {
        const clampToViewport = (): void => {
            const store = useWorkbenchStore.getState();
            const max = assistantWidthMaxFor(window.innerWidth);
            if (store.editingPanelLayout.assistantWidth > max) store.setAssistantWidth(max);
        };
        clampToViewport();
        window.addEventListener("resize", clampToViewport);
        return () => window.removeEventListener("resize", clampToViewport);
    }, []);

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

    // 「去 Skill 库」：Skill 现在是左栏「所有项目共用」的抽屉，四个面都在——不必再切到生成页。
    React.useEffect(() => {
        const onOpenSkillLibrary = () => window.dispatchEvent(new Event("nomi-open-skill-library"));
        window.addEventListener("nomi-focus-skill-library", onOpenSkillLibrary);
        return () => window.removeEventListener("nomi-focus-skill-library", onOpenSkillLibrary);
    }, []);

    const handleWorkspaceModeChange = React.useCallback(
        (mode: WorkspaceMode) => {
            if (!isWorkspaceMode(mode)) return;
            setWorkspaceMode(mode);
            writeWorkspaceModeToUrl(mode);
        },
        [setWorkspaceMode],
    );

    // 四个工作区槽。外壳（ShellFrame）给它们一块被外壳底色包住的区域；圆角工作面各自画。
    const workspaceSlots = (
        <>
            {mountedWorkspaceModes.includes("creation") ? (
                <WorkspaceSlot active={workspaceMode === "creation"} label={t("workspace.creation")}>
                    <CreationWorkspace aiCollapsed={workspaceAiCollapsed} agentDockRef={agentDockRefs.creation} />
                </WorkspaceSlot>
            ) : null}
            {mountedWorkspaceModes.includes("storyboard") ? (
                <WorkspaceSlot active={workspaceMode === "storyboard"} label={t("workspace.storyboard")}>
                    <StoryboardWorkspace projectId={projectId} aiCollapsed={workspaceAiCollapsed} agentDockRef={agentDockRefs.storyboard} />
                </WorkspaceSlot>
            ) : null}
            {mountedWorkspaceModes.includes("generation") ? (
                <WorkspaceSlot active={workspaceMode === "generation"} label={t("workspace.generation")}>
                    <GenerationWorkspace canvas={generation} aiCollapsed={workspaceAiCollapsed} agentDockRef={agentDockRefs.generation} agentLayerRef={setGenerationAgentLayer} />
                </WorkspaceSlot>
            ) : null}
            {mountedWorkspaceModes.includes("preview") ? (
                <WorkspaceSlot active={workspaceMode === "preview"} label={t("workspace.preview")}>
                    <PreviewWorkspace aiCollapsed={workspaceAiCollapsed} agentDockRef={agentDockRefs.preview} />
                </WorkspaceSlot>
            ) : null}
        </>
    );

    // 10-08 外壳重设计：一条 40px 顶栏 + 60px 左栏（抽屉浮在内容上）+ Agent 三形态（小球 / 浮窗 / 停靠）。
    return (
        <WorkspacePanelFrameContext.Provider value={workspaceModeCarriesCreationResourceTree(workspaceMode)}>
            <div
                className={cn("workbench-shell", "w-full h-full min-h-0", "bg-nomi-chrome text-workbench-ink", 'font-nomi-sans [font-feature-settings:"cv02","cv03","cv04","tnum"]')}
                data-workspace-mode={workspaceMode}>
                <ShellFrame
                    topBar={(
                        <ShellTopBar
                            workspaceMode={workspaceMode}
                            onWorkspaceModeChange={handleWorkspaceModeChange}
                            stepperMeta={stepperMeta}
                            projectId={projectId}
                            projectName={projectName}
                            onBackToLibrary={onBackToLibrary}
                            onOpenProject={onOpenProject}
                            onNewProject={onNewProject}
                            onRenameProject={onRenameProject}
                            onOpenSettings={onOpenSettings}
                            railCollapsed={railCollapsed}
                            onExpandRail={() => setRailCollapsed(false)}
                        />
                    )}
                    rail={railCollapsed ? undefined : <ShellRail projectId={projectId ?? null} />}
                >
                    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                        {projectFeedback}
                        <main className="workbench-shell__body relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
                            <div className="relative min-h-0 min-w-0 flex-1" data-shell-content>
                                {workspaceSlots}
                                <ShellAgentHost
                                    surface={agentSurface}
                                    dockTarget={agentDock}
                                    layerTarget={agentSurface === 'generation' ? generationAgentLayer : null}
                                    agent={<ProjectAgentResidentShell surface={agentSurface} />}
                                />
                            </div>
                        </main>
                    </div>
                </ShellFrame>
            </div>
        </WorkspacePanelFrameContext.Provider>
    );
}
