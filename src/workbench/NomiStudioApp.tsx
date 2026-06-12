import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import ProjectLibraryPage from "./library/ProjectLibraryPage";
import { ToastHost } from "../ui/toast";
import { FilePreviewPanel } from "./explorer/FilePreviewPanel";
import {
    createLocalProject,
    deleteLocalProject,
    useLocalProjects,
    type LocalProjectSummary,
} from "./library/localProjectStore";
import {
    buildStoryDocument,
    type TryNowExample,
} from "./library/tryNowExamples";
import type { WorkbenchProjectPersistenceService } from "./project/projectPersistenceService";
import { useWorkspaceEvents } from "./useWorkspaceEvents";
import { useWorkbenchStore } from "./workbenchStore";
import { swapGenerationAiProject } from "./generationCanvas/store/generationAiConversation";
import { flushConversationsNow, initConversationPersistence, loadProjectConversations } from "./ai/conversationPersistence";
import { initReviewEventBridge } from "./generationCanvas/reviewEventBridge";
import { setCanvasEventProjectIdProvider } from "./generationCanvas/events/canvasEventEmitter";
import { cn } from "../utils/cn";
import { toast } from "../ui/toast";
import { setDesktopActiveProjectId } from "../desktop/activeProject";
import { getDesktopBridge } from "../desktop/bridge";
import { listWorkbenchModelCatalogModels } from "./api/modelCatalogApi";
import { useHasTextModel } from "./library/useHasTextModel";
import { requestWorkbenchTour } from "./onboarding/workbenchTourState";
import { buildStudioUrl } from "../utils/appRoutes";
import { openWorkspaceFromLibrary } from "./library/openWorkspaceFlow";

type AppView = "library" | "studio";
type ProjectPersistenceModule = typeof import("./project/projectPersistenceService");

const WorkbenchShell = React.lazy(() => import("./WorkbenchShell"));
const OnboardingFloatingPanel = React.lazy(() =>
    import("../ui/onboarding/OnboardingFloatingPanel").then((module) => ({
        default: module.OnboardingFloatingPanel,
    })),
);
const AssetLibraryPanel = React.lazy(() =>
    import("./assets/AssetLibraryPanel").then((module) => ({
        default: module.AssetLibraryPanel,
    })),
);
const GenerationCanvas = React.lazy(
    () => import("./generationCanvas/components/GenerationCanvas"),
);
const CanvasAssistantPanel = React.lazy(
    () => import("./generationCanvas/components/CanvasAssistantPanel"),
);
const BatchPlanOverlay = React.lazy(() =>
    import("./generationCanvas/components/BatchPlanOverlay").then((module) => ({
        default: module.BatchPlanOverlay,
    })),
);

function GenerationCanvasLoading(): JSX.Element {
    return (
        <div
            className={cn("w-full h-full bg-workbench-bg")}
            aria-label='生成画布加载中'
        />
    );
}

function readProjectIdFromSearch(search: string): string | null {
    try {
        const value = new URLSearchParams(search).get("projectId");
        return value && value.trim() ? value.trim() : null;
    } catch {
        return null;
    }
}

export default function NomiStudioApp(): JSX.Element {
    const navigate = useNavigate();
    const location = useLocation();
    const [view, setView] = React.useState<AppView>("library");
    const { projects, refreshProjects } = useLocalProjects();
    const [activeProject, setActiveProject] =
        React.useState<LocalProjectSummary | null>(null);
    const [generationAiCollapsed, setGenerationAiCollapsed] =
        React.useState(true);
    const [modelCatalogOpened, setModelCatalogOpened] = React.useState(false);
    const [assetLibraryOpened, setAssetLibraryOpened] = React.useState(false);
    const { hasTextModel, refresh: refreshModelStatus } = useHasTextModel();
    // 模型接入面板关闭后重查（用户可能刚接完模型 → 状态条/弱入口要立即翻面）
    React.useEffect(() => {
        if (!modelCatalogOpened) refreshModelStatus();
    }, [modelCatalogOpened, refreshModelStatus]);
    // 「30 秒体验」缺文本模型时挂起的示例：接完模型自动续跑（spec D 屏衔接）。
    const [pendingTryExample, setPendingTryExample] =
        React.useState<TryNowExample | null>(null);
    const hydratingProjectRef = React.useRef(false);
    const activeProjectIdRef = React.useRef<string | null>(null);
    const initialHydrationAttemptedRef = React.useRef(false);
    const projectPersistenceModuleRef =
        React.useRef<ProjectPersistenceModule | null>(null);
    const projectPersistenceServiceRef =
        React.useRef<WorkbenchProjectPersistenceService | null>(null);
    const routeProjectId = React.useMemo(
        () => readProjectIdFromSearch(location.search),
        [location.search],
    );
    const activeProjectPersistenceKey = activeProject
        ? `${activeProject.id}\u0000${activeProject.name}`
        : "";

    React.useEffect(() => {
        document.documentElement.dataset.theme = "light";
        document.documentElement.setAttribute(
            "data-mantine-color-scheme",
            "light",
        );
    }, []);

    React.useEffect(() => {
        const handleOpenModelCatalog = () => setModelCatalogOpened(true);
        window.addEventListener(
            "nomi-open-model-catalog",
            handleOpenModelCatalog,
        );
        return () =>
            window.removeEventListener(
                "nomi-open-model-catalog",
                handleOpenModelCatalog,
            );
    }, []);

    React.useEffect(() => {
        const handleOpenAssetLibrary = () => setAssetLibraryOpened(true);
        window.addEventListener(
            "nomi-open-asset-library",
            handleOpenAssetLibrary,
        );
        return () =>
            window.removeEventListener(
                "nomi-open-asset-library",
                handleOpenAssetLibrary,
            );
    }, []);

    const ensureProjectPersistenceService = React.useCallback(async () => {
        let module = projectPersistenceModuleRef.current;
        if (!module) {
            module = await import("./project/projectPersistenceService");
            projectPersistenceModuleRef.current = module;
        }
        let service = projectPersistenceServiceRef.current;
        if (!service) {
            service = module.createWorkbenchProjectPersistenceService({
                setActiveProject,
                setView,
                onSaveError: (error) => {
                    console.error("project save error", error);
                    toast("项目保存失败，请检查本地磁盘权限", "error");
                },
            });
            projectPersistenceServiceRef.current = service;
        }
        return { module, service };
    }, []);

    React.useEffect(() => {
        setDesktopActiveProjectId(activeProject?.id);
    }, [activeProject?.id]);

    // S1b-3:对话消息变化 → 防抖落盘(projectId 在冲刷时刻取,防切换期错绑)。
    React.useEffect(() => initConversationPersistence(() => activeProjectIdRef.current ?? null), []);
    // S4-2b:技术自检广播 → 节点 meta(⚠ 投影数据源)。
    React.useEffect(() => initReviewEventBridge(), []);
    // S5-a:画布影子事件的 projectId(flush 时刻取值,防切换期错绑)。
    React.useEffect(() => setCanvasEventProjectIdProvider(() => activeProjectIdRef.current ?? null), []);

    const hydrateProject = React.useCallback(
        async (projectId: string, options: { replaceUrl?: boolean } = {}) => {
            const { module, service } = await ensureProjectPersistenceService();
            hydratingProjectRef.current = true;
            try {
                const hydrated = await service.hydrateProject(projectId);
                if (!hydrated) return false;
                // S1 治串台:切项目时交换两个 AI 面板的对话桶(存旧载新),气泡不再跨项目漂移。
                const prevProjectId = activeProjectIdRef.current ?? null;
                if (prevProjectId !== hydrated.id) {
                    // 先冲刷旧项目的落盘(取消挂起防抖,防把新项目内容写进旧文件)。
                    flushConversationsNow(prevProjectId);
                    useWorkbenchStore.getState().swapCreationAiProject(prevProjectId, hydrated.id);
                    swapGenerationAiProject(prevProjectId, hydrated.id);
                    void loadProjectConversations(hydrated.id);
                }
                activeProjectIdRef.current = hydrated.id;
                setActiveProject(hydrated);
                setView("studio");
                const migrationDiag =
                    module.consumeCategoryMigrationDiagnostic();
                if (
                    migrationDiag &&
                    (migrationDiag.migratedNodes > 0 ||
                        migrationDiag.categoriesSeeded)
                ) {
                    toast(
                        `项目已升级到目录树：${migrationDiag.migratedNodes} 个节点已归类`,
                        "success",
                    );
                }
                navigate(buildStudioUrl(hydrated.id), {
                    replace: options.replaceUrl ?? false,
                });
            } finally {
                hydratingProjectRef.current = false;
            }
            return true;
        },
        [ensureProjectPersistenceService, navigate],
    );

    const openProject = React.useCallback(
        (projectId: string) => {
            // 常规打开默认落「生成」画布。显式设，避免继承上一个示例残留的 creation
            // （WorkbenchShell 挂载在 URL 无 step 时会沿用 store 当前模式）。
            useWorkbenchStore.getState().setWorkspaceMode("generation");
            void hydrateProject(projectId);
        },
        [hydrateProject],
    );

    const openWorkspaceFolder = React.useCallback(async () => {
        await openWorkspaceFromLibrary({
            bridge: getDesktopBridge(),
            hydrateProject,
            refreshProjects,
            confirmInitialize: async (rootPath) =>
                window.confirm(
                    `将此文件夹初始化为 Nomi 项目？\n\n${rootPath}\n\nNomi 会创建 .nomi/，并把生成的图片、视频保存到 assets/ 和 exports/。`,
                ),
            showMessage: (message, tone) => toast(message, tone || "error"),
        });
    }, [hydrateProject, refreshProjects]);

    const revealProjectFolder = React.useCallback((projectId: string) => {
        const bridge = getDesktopBridge();
        if (!bridge?.workspace?.revealProjectFolder) {
            toast("当前运行环境不支持打开项目文件夹", "error");
            return;
        }
        void bridge.workspace
            .revealProjectFolder({ projectId })
            .catch((error: unknown) => {
                const message =
                    error instanceof Error && error.message
                        ? error.message
                        : "打开项目文件夹失败";
                toast(message, "error");
            });
    }, []);

    const newProject = React.useCallback(() => {
        // 「新建项目」：直接在默认位置建项目，不弹文件夹选择器。
        // 桌面端 createLocalProject 经 IPC 落到 ~/Documents/Nomi Projects 的自动文件夹，
        // Web 端落 localStorage。要绑定自选目录走「打开文件夹」。
        try {
            const project = createLocalProject();
            refreshProjects();
            void hydrateProject(project.id);
        } catch (error) {
            console.error("new project error", error);
            toast("新建项目失败，请检查本地磁盘权限", "error");
        }
    }, [hydrateProject, refreshProjects]);

    /**
     * Try-Now hero handler (C6). Creates a fresh project, hydrates it,
     * stuffs the example story into the creation workbench document, then
     * dispatches a storyboard request so the demo runs end-to-end with a
     * single click. We delay the storyboard event until after the project
     * has hydrated and the creation editor has mounted, otherwise the
     * canvas-assistant listener might not be attached yet.
     */
    const tryExample = React.useCallback(
        async (example: TryNowExample) => {
            // 模型预检（P0-9 / I-2）：示例靠 Agent「拆镜头」跑起来，需要文本模型。
            // 没配 → 挂起本次体验，打开带上下文条的模型接入 wizard；保存成功后
            // 经 nomi-model-catalog-changed 自动续跑（不让「30 秒体验」死在第 0 步）。
            const textModels = await listWorkbenchModelCatalogModels({
                kind: "text",
                enabled: true,
            }).catch(() => []);
            if (textModels.length === 0) {
                setPendingTryExample(example);
                setModelCatalogOpened(true);
                return;
            }
            // 示例同样不强迫选文件夹：直接在默认位置建项目（桌面端落
            // ~/Documents/Nomi Projects，Web 端落 localStorage），让「30 秒体验」
            // 真的一键就跑。要自定义目录用户可后续走「打开文件夹」。
            let project: LocalProjectSummary;
            try {
                project = createLocalProject(example.projectName);
                refreshProjects();
            } catch (error) {
                console.error("try-now project error", error);
                toast("新建示例项目失败，请检查本地磁盘权限", "error");
                return;
            }
            const hydrated = await hydrateProject(project.id);
            if (!hydrated) return;
            const doc = buildStoryDocument(example.story, example.projectName);
            const { useWorkbenchStore } = await import("./workbenchStore");
            const store = useWorkbenchStore.getState();
            store.setWorkbenchDocument(doc);
            // 统一示例行为：打开后落在「创作」、不自动拆镜（不偷偷耗 LLM 额度、用户掌控节奏）。
            // 展开创作助手让「拆镜头」CTA 一眼可见，用户读完故事一键拆镜进画布。
            store.setWorkspaceMode("creation");
            store.setCreationAssistantAutoOpen(true);
            // 首次体验自动开三步引导（已看过的用户由 WorkbenchTour 端按标记过滤）
            requestWorkbenchTour();
        },
        [hydrateProject, refreshProjects],
    );

    // 接完模型（目录变更广播）→ 状态重查；有挂起的体验且文本模型就位 → 关面板自动续跑。
    React.useEffect(() => {
        const handleCatalogChanged = () => {
            refreshModelStatus();
            if (!pendingTryExample) return;
            void listWorkbenchModelCatalogModels({
                kind: "text",
                enabled: true,
            })
                .catch(() => [])
                .then((models) => {
                    if (models.length === 0) return;
                    setPendingTryExample(null);
                    setModelCatalogOpened(false);
                    void tryExample(pendingTryExample);
                });
        };
        window.addEventListener(
            "nomi-model-catalog-changed",
            handleCatalogChanged,
        );
        return () =>
            window.removeEventListener(
                "nomi-model-catalog-changed",
                handleCatalogChanged,
            );
    }, [pendingTryExample, refreshModelStatus, tryExample]);

    // 体验流程衔接（上下文条 + 稍后再说退路）。引用随 pendingTryExample 稳定，
    // Drawer 的「直达 wizard」effect 才不会在用户手动关掉后反复重开。
    const experienceHandoff = React.useMemo(
        () =>
            pendingTryExample
                ? {
                      label: "30 秒体验 · 先连接一个 AI 服务，完成后自动继续",
                      onDefer: () => {
                          setPendingTryExample(null);
                          setModelCatalogOpened(false);
                      },
                  }
                : undefined,
        [pendingTryExample],
    );

    const closeModelCatalog = React.useCallback(() => {
        setModelCatalogOpened(false);
        // 手动关面板 = 放弃本次体验挂起（下次点 CTA 重新进入）
        setPendingTryExample(null);
    }, []);

    const deleteProject = React.useCallback(
        (project: LocalProjectSummary) => {
            const confirmed = window.confirm(
                `确定删除「${project.name}」吗？项目文件夹和本地资源会一起删除。`,
            );
            if (!confirmed) return;
            try {
                deleteLocalProject(project.id);
                if (activeProjectIdRef.current === project.id) {
                    activeProjectIdRef.current = null;
                    setActiveProject(null);
                    setView("library");
                    navigate(buildStudioUrl(), { replace: true });
                }
                toast("项目已删除", "success");
            } catch (error: unknown) {
                const message =
                    error instanceof Error && error.message
                        ? error.message
                        : "项目删除失败";
                console.error(message);
                toast(message, "error");
            }
        },
        [navigate],
    );

    React.useEffect(() => {
        if (initialHydrationAttemptedRef.current) return;
        initialHydrationAttemptedRef.current = true;
        if (!routeProjectId) return;
        let cancelled = false;
        hydratingProjectRef.current = true;
        void ensureProjectPersistenceService()
            .then(({ service }) => service.hydrateInitialProject(projects))
            .then((hydrated) => {
                if (cancelled) return;
                if (hydrated) {
                    activeProjectIdRef.current = hydrated.id;
                    setActiveProject(hydrated);
                    setView("studio");
                    navigate(buildStudioUrl(hydrated.id), { replace: true });
                } else {
                    if (routeProjectId)
                        navigate(buildStudioUrl(), { replace: true });
                }
            })
            .catch((error: unknown) => {
                const message =
                    error instanceof Error && error.message
                        ? error.message
                        : "项目恢复失败";
                console.error(message);
            })
            .finally(() => {
                if (!cancelled) hydratingProjectRef.current = false;
            });
        return () => {
            cancelled = true;
            hydratingProjectRef.current = false;
        };
    }, [
        ensureProjectPersistenceService,
        navigate,
        projects,
        routeProjectId,
    ]);

    React.useEffect(() => {
        if (
            !initialHydrationAttemptedRef.current ||
            hydratingProjectRef.current
        )
            return;
        if (!routeProjectId || routeProjectId === activeProjectIdRef.current)
            return;
        void hydrateProject(routeProjectId, { replaceUrl: true }).then((ok) => {
            if (!ok) navigate(buildStudioUrl(), { replace: true });
        });
    }, [hydrateProject, navigate, routeProjectId]);

    React.useEffect(() => {
        if (!activeProject?.id) return;
        let disposed = false;
        let unbind: (() => void) | undefined;
        void ensureProjectPersistenceService().then(({ service }) => {
            if (disposed) return;
            unbind = service.bindProjectPersistence({
                project: activeProject,
                isHydrating: () => hydratingProjectRef.current,
                canPersist: () =>
                    activeProjectIdRef.current === activeProject.id,
                onSaved: (saved) => {
                    setActiveProject(saved);
                },
                onSaveError: (error) => {
                    console.error("project save error", error);
                    toast("项目保存失败，请检查本地磁盘权限", "error");
                },
            });
        });
        return () => {
            disposed = true;
            unbind?.();
        };
    }, [
        activeProject,
        activeProjectPersistenceKey,
        ensureProjectPersistenceService,
    ]);

    useWorkspaceEvents(view === "studio" ? activeProject?.id : null, (type) => {
        if (
            type === "canvas.updated" ||
            type === "timeline.updated" ||
            type === "creation.updated"
        ) {
            void hydrateProject(activeProject!.id);
        }
    });

    const backToLibrary = React.useCallback(() => {
        setView("library");
        navigate(buildStudioUrl(), { replace: false });
    }, [navigate]);

    const handleRenameProject = React.useCallback(
        (newName: string) => {
            if (!activeProject) return;
            const trimmed = newName.trim() || "未命名 Nomi 项目";
            if (trimmed === activeProject.name) return;
            const renamed: LocalProjectSummary = {
                ...activeProject,
                name: trimmed,
            };
            // Update React state so AppBar reflects the new name immediately
            setActiveProject(renamed);
            // Persist the new name with the current in-memory canvas/timeline/document
            // state (NOT a re-read from disk — that would be stale). This updates the
            // project file on disk AND publishes the new summary so the project library
            // card refreshes via SWR.
            void ensureProjectPersistenceService()
                .then(async ({ service }) => {
                    const { readCurrentWorkbenchProjectPayload } =
                        await import("./project/workbenchProjectSession");
                    return service.persistProject(
                        renamed,
                        readCurrentWorkbenchProjectPayload(),
                    );
                })
                .catch((error: unknown) => {
                    console.error("project rename save error", error);
                    toast("项目重命名保存失败", "error");
                });
        },
        [activeProject, ensureProjectPersistenceService],
    );

    if (view === "library") {
        return (
            <>
                <ProjectLibraryPage
                    projects={projects}
                    onOpenProject={openProject}
                    onDeleteProject={deleteProject}
                    onNewProject={() => void newProject()}
                    onOpenFolder={() => void openWorkspaceFolder()}
                    onRevealProjectFolder={revealProjectFolder}
                    onTryExample={(example) => void tryExample(example)}
                    onOpenModelCatalog={() => setModelCatalogOpened(true)}
                    hasTextModel={hasTextModel}
                />
                {/* 模型接入面板也要在首页可用：全新安装零模型时，「30 秒体验」会派发
                    nomi-open-model-catalog 引导接入；之前此面板只挂在 studio 视图 →
                    首页派发事件无人响应，用户卡死（冷启动 J3 P0）。 */}
                <React.Suspense fallback={null}>
                    <OnboardingFloatingPanel
                        opened={modelCatalogOpened}
                        onClose={closeModelCatalog}
                        experience={experienceHandoff}
                    />
                </React.Suspense>
                <ToastHost />
            </>
        );
    }

    return (
        <div
            className={cn("nomi-studio-app w-full h-screen min-h-0 bg-nomi-bg")}
            aria-label='Nomi Studio'>
            <WorkbenchShell
                generation={
                    <React.Suspense fallback={<GenerationCanvasLoading />}>
                        {/* relative 包一层:S2b 计划 overlay 与画布同坐标系,且不喂巨壳 */}
                        <div className={cn("relative w-full h-full")}>
                            <GenerationCanvas />
                            <BatchPlanOverlay />
                        </div>
                    </React.Suspense>
                }
                generationAiLayout={
                    generationAiCollapsed ? "overlay" : "sidebar"
                }
                generationAi={
                    <React.Suspense fallback={null}>
                        <CanvasAssistantPanel
                            defaultCollapsed
                            onCollapsedChange={setGenerationAiCollapsed}
                        />
                    </React.Suspense>
                }
                projectId={activeProject?.id ?? null}
                projectName={activeProject?.name}
                onBackToLibrary={backToLibrary}
                onOpenModelCatalog={() => setModelCatalogOpened(true)}
                onRenameProject={handleRenameProject}
            />

            <OnboardingFloatingPanel
                opened={modelCatalogOpened}
                onClose={closeModelCatalog}
            />

            <React.Suspense fallback={null}>
                <AssetLibraryPanel
                    opened={assetLibraryOpened}
                    onClose={() => setAssetLibraryOpened(false)}
                    projectId={activeProject?.id ?? null}
                />
            </React.Suspense>

            <FilePreviewPanel />

            <ToastHost />
        </div>
    );
}
