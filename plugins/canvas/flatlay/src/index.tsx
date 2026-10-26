import { definePlugin, useEffect, useRef, useState } from "@infinite-canvas/plugin-sdk";
import type { CanvasNodeContentProps, CanvasNodeContext, PluginStoredImage } from "@infinite-canvas/plugin-sdk";
import { BACK_PRESET, collectInputs, fillPrompt, PRESET, processJob, recoverJobs, viewLabel } from "./logic";
import type { Input, Job, Settings } from "./logic";
import css from "./style.css";
import { folderDefinition } from "./folder";
import { Thumbnail } from "./thumbnail";

// 节点因视口裁剪卸载后，在途任务仍需结束；重挂载时不能并发重复提交。
const activeByHost = new WeakMap<object, Map<string, AbortController>>();
function activeFor(ctx: CanvasNodeContext) {
    const host = ctx.media || ctx.ai;
    let active = activeByHost.get(host);
    if (!active) { active = new Map(); activeByHost.set(host, active); }
    return active;
}
const id = () => crypto.randomUUID();
const PHASE = { analyze: "识别目标", generate: "生成白底", save: "保存白底", cutout: "生成透明底" };
const STATUS = { queued: "待处理", running: "处理中", error: "失败", interrupted: "已中断", success: "已完成" };

function FlatlayContent({ ctx }: CanvasNodeContentProps) {
    const current = useRef(ctx); current.current = ctx;
    const meta = ctx.node.metadata || {};
    const inputs = (meta.flatlayInputs || []) as Input[];
    const jobs = (meta.flatlayJobs || []) as Job[];
    const jobsRef = useRef(jobs); jobsRef.current = jobs;
    const active = activeFor(ctx);
    const controller = useRef<AbortController | null>(active.get(ctx.node.id) || null);
    const mounted = useRef(true);
    const [running, setRunning] = useState(active.has(ctx.node.id));
    const [hint, setHint] = useState("");
    const [target, setTarget] = useState("");
    const [expanded, setExpanded] = useState(false);
    const [tab, setTab] = useState<"images" | "settings" | "history">("images");
    const view = meta.flatlayView === "back" ? "back" : "front";
    const templateKey = view === "back" ? "flatlayBackTemplate" : "flatlayTemplate";
    const settings: Settings = {
        view,
        template: String(meta[templateKey] ?? (view === "back" ? BACK_PRESET : PRESET)),
        model: String(meta.flatlayModel ?? ctx.ai.defaultModel("image")),
        textModel: String(meta.flatlayTextModel ?? ctx.ai.defaultModel("text")),
        size: String(meta.flatlaySize ?? ""),
        transparent: Boolean(meta.flatlayTransparent),
        cutoutMode: meta.flatlayCutoutMode === "general" ? "general" : "goods",
    };
    const writeJobs = (next: Job[]) => {
        jobsRef.current = next;
        if (current.current.getNode(ctx.node.id)) current.current.updateMetadata({ flatlayJobs: next });
    };
    useEffect(() => {
        mounted.current = true;
        if (!active.has(ctx.node.id)) ctx.updateMetadata({ pluginKeepMounted: false });
        const restored = active.has(ctx.node.id) ? jobsRef.current : recoverJobs(jobsRef.current);
        if (restored.some((job, i) => job !== jobsRef.current[i])) writeJobs(restored);
        const off = ctx.on("flatlay:run-ended", (payload) => {
            if (payload === ctx.node.id) { controller.current = null; setRunning(false); }
        });
        return () => { mounted.current = false; controller.current?.abort(); off(); };
    }, []);
    const patchJob = (next: Job) => writeJobs(jobsRef.current.map((job) => job.id === next.id ? next : job));
    const setInputs = (next: Input[]) => current.current.updateMetadata({ flatlayInputs: next });
    const readInputs = () => {
        const found = collectInputs(current.current).map((input) => ({ ...input, phrase: inputs.find((old) => old.id === input.id)?.phrase || target.trim() }));
        setInputs(found);
        setHint(found.length ? `已读取 ${found.length} 张，每张独立处理。` : "请先连接图片节点或图片组。");
    };
    const output = (job: Job, kind: "white" | "cutout", image: PluginStoredImage) => {
        const c = current.current;
        if (!mounted.current || !c.getNode(c.node.id)) return;
        const nodeId = kind === "white" ? job.whiteNodeId : job.cutoutNodeId;
        if (c.getNode(nodeId)) return;
        const from = kind === "white" ? c.node.id : job.whiteNodeId;
        c.applyOps([
            { type: "add_node", id: nodeId, nodeType: "image", title: `${job.input.title || "服装"} · ${job.input.phrase} · ${viewLabel(job.settings.view)} · ${kind === "white" ? "白底" : "透明底"}`, position: { x: job.x + (kind === "cutout" ? 280 : 0), y: job.y }, width: 240, height: 240 * image.height / image.width,
              metadata: { content: image.url, storageKey: image.storageKey, status: "success", naturalWidth: image.width, naturalHeight: image.height, bytes: image.bytes, mimeType: image.mimeType, prompt: job.prompt, model: kind === "white" ? job.settings.model : `tencent-ci:${job.settings.cutoutMode}`, flatlayOwner: c.node.id, flatlayRunId: job.runId, flatlaySource: { storageKey: job.input.storageKey }, flatlayView: job.settings.view || "front", flatlayKind: kind } },
            { type: "connect_nodes", fromNodeId: from, toNodeId: nodeId },
            ...(kind === "white" && c.getNode(job.input.nodeId) ? [{ type: "connect_nodes" as const, fromNodeId: job.input.nodeId, toNodeId: nodeId }] : []),
        ]);
    };
    const run = async (selected: Job[]) => {
        if (active.has(ctx.node.id) || !selected.length) return;
        const c = current.current;
        const media = c.media;
        if (!media) { setHint("需要更新宿主以支持批量平铺图片处理。"); return; }
        if (selected.some((job) => job.settings.transparent && !job.cutout) && !media.cutoutReady()) { media.configureCutout(); setHint("配置腾讯云后，再点击开始或重试。"); return; }
        const abort = new AbortController(); controller.current = abort; active.set(ctx.node.id, abort);
        c.updateMetadata({ pluginKeepMounted: true });
        setRunning(true); setHint("");
        try {
            for (const initial of selected) {
                if (abort.signal.aborted || !mounted.current || !current.current.getNode(c.node.id)) break;
                let job = jobsRef.current.find((item) => item.id === initial.id) || initial;
                if (!job.white) {
                    const bottoms = current.current.getNodes().filter((node) => node.metadata?.flatlayOwner === c.node.id).map((node) => node.position.y + node.height + 40);
                    job = { ...job, y: Math.max(c.node.position.y, ...bottoms) };
                }
                await processJob(job, { media, ai: c.ai, signal: abort.signal, update: patchJob, output });
            }
        } finally {
            if (controller.current === abort) controller.current = null;
            if (active.get(ctx.node.id) === abort) active.delete(ctx.node.id);
            if (current.current.getNode(ctx.node.id)) current.current.updateMetadata({ pluginKeepMounted: false });
            current.current.emit("flatlay:run-ended", ctx.node.id);
            if (mounted.current) setRunning(false);
        }
    };
    const start = (sourceInputs = inputs) => {
        if (active.has(ctx.node.id)) return;
        if (!sourceInputs.length) { setHint("先从上游读取图片。"); return; }
        try { fillPrompt(settings.template, "目标服装", settings.view); } catch (error) { setHint((error as Error).message); return; }
        if (!settings.model || !ctx.ai.listModels("image").some((model) => model.value === settings.model)) { setHint("请选择当前可用的生图模型。"); return; }
        if (sourceInputs.some((input) => !input.phrase.trim()) && !ctx.ai.listModels("text").some((model) => model.value === settings.textModel)) { setHint("请选择可看图的识别模型，或手动填写所有目标。"); return; }
        if (settings.transparent && !ctx.media?.cutoutReady()) { ctx.media?.configureCutout(); return; }
        const runId = id();
        const next = sourceInputs.map((input): Job => ({ id: id(), runId, input: { ...input }, settings: { ...settings }, phase: "analyze", status: "queued", whiteNodeId: id(), cutoutNodeId: id(), x: ctx.node.position.x + ctx.node.width + 80, y: ctx.node.position.y }));
        writeJobs([...jobsRef.current, ...next]);
        void run(next);
    };
    const retry = (selected: Job[]) => {
        if (selected.some((job) => !job.white && (job.phase === "generate" || job.phase === "save")) && !window.confirm("部分任务的上次生图结果未知或未保存。继续会重新调用模型，可能产生费用。确定重试这些任务？")) return;
        const ready = selected.map((job) => ({ ...job, phase: job.white ? "cutout" as const : "analyze" as const }));
        ready.forEach(patchJob);
        void run(ready);
    };
    const failed = jobs.filter((job) => job.status === "error" || job.status === "interrupted");
    const queued = jobs.filter((job) => job.status === "queued");
    const t = ctx.theme;
    const completed = jobs.filter((job) => job.status === "success").length;
    const resultIds = jobs.flatMap((job) => [job.whiteNodeId, job.cutoutNodeId]).filter((nodeId) => Boolean(ctx.getNode(nodeId)));
    const imageModel = ctx.ai.listModels("image").find((model) => model.value === settings.model)?.label || settings.model || "未选择模型";
    const selectModel = (key: string, value: string, capability: "text" | "image") => <select aria-label={capability === "text" ? "识别模型" : "生图模型"} disabled={running} value={value} onChange={(e) => ctx.updateMetadata({ [key]: e.target.value })}>
        {!ctx.ai.listModels(capability).some((item) => item.value === value) && <option value={value}>{value || "请选择模型"}</option>}
        {ctx.ai.listModels(capability).map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
    </select>;
    return <div data-flatlay-node data-canvas-no-zoom style={{ color: t.node.text, "--fl-muted": t.node.muted, "--fl-line": t.node.stroke, "--fl-panel": t.node.panel, "--fl-accent": t.node.text } as import("react").CSSProperties}
        onMouseDown={(e) => { if (e.target instanceof Element && e.target.closest("button,input,textarea,select,label")) e.stopPropagation(); }}
        onPointerDown={(e) => { if (e.target instanceof Element && e.target.closest("button,input,textarea,select,label")) e.stopPropagation(); }}>
        <header className="fl-header">
            <div><div className="fl-title">单品平铺</div><div className="fl-subtitle">从模特穿搭，到独立单品</div></div>
            <span className="fl-count">{String(inputs.length).padStart(2, "0")}<small> 张图片</small></span>
        </header>
        <nav className="fl-tabs" aria-label="平铺节点视图">
            {([["images", "图片"], ["settings", "设置"], ["history", "记录"]] as const).map(([value, label]) => <button key={value} aria-pressed={tab === value} onClick={() => setTab(value)}>{label}{value === "history" && jobs.length > 0 && <span>{jobs.length}</span>}</button>)}
            <span className="fl-tab-note">{running ? "逐张处理中" : `${viewLabel(view)} · 单件`}</span>
        </nav>
        <div className="fl-body" onWheel={(e) => e.stopPropagation()}>
            {tab === "images" && <>
                <div className="fl-view-switch" aria-label="输出视图">{(["front", "back"] as const).map((side) => <button key={side} disabled={running} aria-pressed={view === side} onClick={() => ctx.updateMetadata({ flatlayView: side })}>{viewLabel(side)}平铺</button>)}</div>
                {view === "back" && <p className="fl-help fl-view-note">优先使用背面参考图；只有正面图时，背面细节由模型推测。</p>}
                <div className="fl-section-heading"><span>参考图片</span><button disabled={running} onClick={readInputs}>↻ {inputs.length ? "更新上游" : "读取上游"}</button></div>
                {!inputs.length ? <div className="fl-empty"><span className="fl-empty-mark">↗</span><strong>先连接模特图</strong><p>将图片、图片组或文件夹节点连到左侧，<br />再点击“读取上游”。</p></div> : <>
                    {inputs.length > 1 && <div className="fl-bulk"><input aria-label="统一目标单品" placeholder="统一目标，如针织背心" disabled={running} value={target} onChange={(e) => setTarget(e.target.value)} /><button disabled={running || !target.trim()} onClick={() => setInputs(inputs.map((input) => ({ ...input, phrase: target.trim() })))}>应用全部</button></div>}
                    <div className="fl-inputs">{inputs.map((input, index) => {
                        const latest = [...jobs].reverse().find((job) => job.input.id === input.id);
                        return <div className="fl-input-row" key={input.id}>
                            <Thumbnail input={input} ctx={ctx} />
                            <div className="fl-input-detail"><div className="fl-input-name" title={input.title}><span>{String(index + 1).padStart(2, "0")}</span>{input.title}</div><input aria-label={`${input.title}目标单品`} disabled={running} value={input.phrase} placeholder="目标单品 · 留空自动识别" onChange={(e) => setInputs(inputs.map((item) => item.id === input.id ? { ...item, phrase: e.target.value } : item))} />{latest && <button className="fl-item-status" onClick={() => setTab("history")}>{viewLabel(latest.settings.view)} · {latest.status === "success" ? "✓ 已完成" : latest.status === "running" ? PHASE[latest.phase] : STATUS[latest.status]}<span>查看记录 →</span></button>}</div>
                        </div>;
                    })}</div>
                    <p className="fl-help">每张图只提取一件服装，可逐项指定目标。</p>
                </>}
            </>}
            {tab === "settings" && <div className="fl-settings">
                <div className="fl-section-heading"><span>生成设置</span><span className="fl-help">应用于新任务</span></div>
                <label className="fl-field">生图模型{selectModel("flatlayModel", settings.model, "image")}</label>
                <label className="fl-field">识别模型<span className="fl-help">目标留空时使用，需支持看图</span>{selectModel("flatlayTextModel", settings.textModel, "text")}</label>
                <label className="fl-field">输出尺寸<input disabled={running} value={settings.size} placeholder="沿用画布设置" onChange={(e) => ctx.updateMetadata({ flatlaySize: e.target.value })} /></label>
                <div className="fl-setting-divider" />
                <div className="fl-section-heading"><span>透明底处理</span><button onClick={() => ctx.media?.configureCutout()}>腾讯配置 ↗</button></div>
                <label className="fl-field">去底模式<select aria-label="去底模式" disabled={running} value={settings.cutoutMode} onChange={(e) => ctx.updateMetadata({ flatlayCutoutMode: e.target.value })}><option value="goods">商品抠图</option><option value="general">通用抠图</option></select></label>
                <div className="fl-setting-divider" />
                <button className="fl-prompt-toggle" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}><span>{viewLabel(view)}预设提示词</span><span>{expanded ? "收起 −" : "查看 / 编辑 ＋"}</span></button>
                {expanded && <><textarea aria-label="预设提示词" disabled={running} value={settings.template} onChange={(e) => ctx.updateMetadata({ [templateKey]: e.target.value })} /><p className="fl-help">保留 {"{目标单品}"}，生成时逐图替换。</p></>}
            </div>}
            {tab === "history" && <>
                <div className="fl-section-heading"><span>任务记录</span><span className="fl-help">完成 {completed} / {jobs.length}</span></div>
                {!jobs.length && <div className="fl-empty"><strong>还没有生成记录</strong><p>开始生成后，在这里查看进度与结果。</p></div>}
                {[...jobs].reverse().map((job) => <div key={job.id} className="fl-job">
                    <div className="fl-job-heading"><strong>{job.input.phrase || "待识别单品"} · {viewLabel(job.settings.view)}</strong><span>{job.status === "success" ? "✓ 已完成" : job.status === "running" ? PHASE[job.phase] : STATUS[job.status]}</span></div>
                    <div className="fl-job-source" title={job.input.title}>{job.input.title}</div>
                    {job.error && <div className="fl-job-message" role="alert">{job.error}</div>}{job.warning && <div className="fl-job-message" role="status">{job.warning}</div>}
                    <div className="fl-job-actions">{!running && (job.status === "error" || job.status === "interrupted") && <button onClick={() => retry([job])}>{job.white ? "重试去底" : "重试此项"}</button>}<button disabled={running} onClick={() => start([{ ...job.input, phrase: inputs.find((input) => input.id === job.input.id)?.phrase || job.input.phrase }])}>重新生成</button></div>
                </div>)}
            </>}
        </div>
        <footer className="fl-footer">
            <div className="fl-output"><span>{viewLabel(view)} · 白底单品图</span><label><input type="checkbox" disabled={running} checked={settings.transparent} onChange={(e) => ctx.updateMetadata({ flatlayTransparent: e.target.checked })} />附加透明 PNG</label></div>
            <button className="fl-model-summary" title={imageModel} onClick={() => setTab("settings")}>{imageModel}<span>设置 ↗</span></button>
            <div className="fl-actions"><button className="fl-start" disabled={!running && !inputs.length} onClick={() => running ? controller.current?.abort() : start()}>{running ? "停止后续处理" : `生成${inputs.length ? ` ${inputs.length} 张` : "平铺图"}`}<span>{running ? "□" : "→"}</span></button><button disabled={!resultIds.length} onClick={() => ctx.applyOps([{ type: "select_nodes", ids: resultIds }])}>选择结果</button></div>
            {(!running && (failed.length > 0 || queued.length > 0)) && <div className="fl-recovery">{failed.length > 0 && <button onClick={() => retry(failed)}>重试失败项 · {failed.length}</button>}{queued.length > 0 && <button onClick={() => void run(queued)}>继续待处理 · {queued.length}</button>}</div>}
            {(hint || running) && <div className="fl-help fl-notice" role="status">{running ? "逐张处理；停止不撤销已受理的请求。" : hint}</div>}
        </footer>
    </div>;
}

export default definePlugin({ id: "flatlay", name: "批量平铺", version: "1.0.0", description: "文件夹批量输入，生成正面或背面平铺图与腾讯透明底", css, nodes: [{ type: "flatlay:batch", title: "批量平铺", icon: "👕", defaultSize: { width: 460, height: 560 }, hidePanel: true, defaultMetadata: { flatlayTemplate: PRESET, flatlayInputs: [], flatlayJobs: [], flatlayTransparent: false }, Content: FlatlayContent }, folderDefinition] });
