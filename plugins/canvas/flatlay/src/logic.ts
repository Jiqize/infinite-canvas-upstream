import type { CanvasNodeContext, PluginStoredImage } from "@infinite-canvas/plugin-sdk";

export const PRESET = "根据用户模特展示图里的「{目标单品}」，生成用于创建高质量“平铺单品图（Flat Lay）”。生成一张新的照片，这张照片要在纯白背景上，展示该单品的正面3D平铺效果。构图规范：正面视图必须居中。背景统一：永远是纯白色、无缝、无阴影的背景。元素排除：必须移除原图中的模特、搭配的其他衣物、鞋子和配饰，只保留目标单品。要求尽量还原原图单品的版型、材质和关键细节，但不要生成多余搭配。如果原图里还有其他搭配，也只能围绕「{目标单品}」代表的一件主单品生成。禁止把另一件衣服、整套穿搭或多件组合一起生成。";
export type View = "front" | "back";
export const viewLabel = (view?: View) => view === "back" ? "背面" : "正面";
export const BACK_PRESET = PRESET.replaceAll("正面", "背面") + "只展示单品背面，不要把正面胸前图案、文字或开襟直接复制或镜像到背面。优先还原参考图中可见的背面细节；不可见部分采用与该单品一致的简洁结构，不编造额外装饰。";
export type FolderImage = PluginStoredImage & { id: string; title: string; path: string };
export type Input = { id: string; nodeId: string; title: string; url: string; storageKey?: string; phrase: string };
export type Settings = { view?: View; template: string; model: string; textModel: string; size: string; transparent: boolean; cutoutMode: "goods" | "general" };
export type Job = { id: string; runId: string; input: Input; settings: Settings; prompt?: string; phase: "analyze" | "generate" | "save" | "cutout"; status: "queued" | "running" | "error" | "interrupted" | "success"; error?: string; warning?: string; white?: PluginStoredImage; cutout?: PluginStoredImage; whiteNodeId: string; cutoutNodeId: string; x: number; y: number };
export function collectInputs(ctx: CanvasNodeContext): Input[] {
    const nodes = ctx.getUpstream().flatMap((node) => node.type === "group" ? ctx.getNodes().filter((n) => n.metadata?.groupId === node.id) : [node]);
    const inputs = nodes.flatMap((node): Input[] => {
        if (node.type === "image" && node.metadata?.content) return [{ id: node.id, nodeId: node.id, title: node.title, url: node.metadata.content, storageKey: node.metadata.storageKey, phrase: "" }];
        if (node.type === "flatlay:folder") return ((node.metadata?.folderImages || []) as FolderImage[]).map((image) => ({ id: `${node.id}#${image.id}`, nodeId: node.id, title: image.path, url: image.url, storageKey: image.storageKey, phrase: "" }));
        const resource = ctx.getResource?.(node.id);
        return resource?.kind === "image" ? (resource.urls || (resource.url ? [resource.url] : [])).map((url, i) => ({ id: `${node.id}#${i}`, nodeId: node.id, title: `${node.title} ${i + 1}`, url, phrase: "" })) : [];
    });
    return [...new Map(inputs.map((item) => [item.id, item])).values()];
}
export function fillPrompt(template: string, phrase: string, view: View = "front") {
    if (!phrase.trim()) throw new Error("目标单品不能为空");
    if (!template.includes("{目标单品}")) throw new Error("预设中需要保留 {目标单品}，以便逐图替换");
    return template.replaceAll("{目标单品}", phrase.trim()) + `\n本次输出视图：${viewLabel(view)}。只生成这一视图的一件单品，禁止正背拼图、双视图或多件组合。`;
}
export function recoverJobs(jobs: Job[]): Job[] {
    return jobs.map((job) => job.status === "running" ? { ...job, status: "interrupted", error: "上次处理已中断；生成中的请求结果可能未知，请确认后手动重试。" } : job);
}

type Runner = {
    media: NonNullable<CanvasNodeContext["media"]>;
    ai: CanvasNodeContext["ai"];
    signal: AbortSignal;
    update: (job: Job) => void;
    output: (job: Job, kind: "white" | "cutout", image: PluginStoredImage) => void;
};
export async function processJob(initial: Job, runner: Runner): Promise<Job> {
    let job: Job = { ...initial, status: "running", error: undefined };
    const check = () => { if (runner.signal.aborted) throw new DOMException("已停止", "AbortError"); };
    const patch = (value: Partial<Job>) => { job = { ...job, ...value }; runner.update(job); };
    try {
        check();
        runner.update(job);
        if (!job.white) {
            if (job.phase === "save") throw new Error("上次生成结果未能保存，请重新生成该项；不会自动再次调用模型。");
            // 固定原图为本地存储引用，之后替换源节点也不改变本次运行。
            if (!job.input.storageKey) {
                const source = await runner.media.saveImage(job.input.url, runner.signal);
                patch({ input: { ...job.input, url: source.url, storageKey: source.storageKey } });
            }
            const source = await runner.media.resolveImage(job.input);
            check();
            if (!job.input.phrase.trim()) {
                patch({ phase: "analyze" });
                const answer = await runner.ai.generateText("识别模特图中最主要的一件服装，只返回该件服装的名称，不超过十个字，不含颜色，不要列出其他搭配。", { images: [source], model: job.settings.textModel, signal: runner.signal });
                check();
                if (!answer.text.trim()) throw new Error("没有识别出目标单品，请手动填写后重新生成");
                patch({ input: { ...job.input, phrase: answer.text.trim() } });
            }
            const prompt = fillPrompt(job.settings.template, job.input.phrase, job.settings.view);
            patch({ phase: "generate", prompt });
            const result = await runner.ai.generateImage(prompt, { references: [source], count: 1, background: "opaque", model: job.settings.model, size: job.settings.size || undefined, signal: runner.signal });
            check();
            if (!result.images[0]) throw new Error("模型没有返回图片");
            patch({ phase: "save" });
            const white = await runner.media.saveImage(result.images[0], runner.signal);
            // 已经存好的产物先记录，再响应停止，避免重试重复生图。
            patch({ white, phase: "cutout" });
            check();
            runner.output(job, "white", white);
            try { await runner.media.recordGeneration(white, { prompt, model: job.settings.model, size: job.settings.size }); }
            catch { patch({ warning: "白底图已保存，但生成画廊记录未保存成功。" }); }
        } else {
            // 刷新后或用户删除产物节点时，重新挂回已保存的产物，不重复请求模型。
            const url = await runner.media.resolveImage(job.white);
            check();
            runner.output(job, "white", { ...job.white, url });
        }
        check();
        if (job.settings.transparent && !job.cutout) {
            patch({ phase: "cutout" });
            const source = await runner.media.resolveImage(job.white!);
            check();
            const result = await runner.media.removeBackground(source, job.settings.cutoutMode, runner.signal);
            if (result.warning) patch({ warning: result.warning });
            check();
            const cutout = await runner.media.saveImage(result.image, runner.signal);
            patch({ cutout });
            check();
        }
        if (job.cutout) {
            const url = await runner.media.resolveImage(job.cutout);
            check();
            runner.output(job, "cutout", { ...job.cutout, url });
        }
        patch({ status: "success" });
    } catch (error) {
        patch({ status: runner.signal.aborted ? "interrupted" : "error", error: error instanceof Error ? error.message : "处理失败" });
    }
    return job;
}
