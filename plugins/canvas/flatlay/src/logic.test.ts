import { describe, expect, test } from "bun:test";
import { BACK_PRESET, collectInputs, fillPrompt, PRESET, processJob, recoverJobs } from "./logic";
import type { Job } from "./logic";

const image = { url: "data:image/png;base64,white", storageKey: "image:white", width: 100, height: 200, bytes: 42, mimeType: "image/png" };
function job(): Job { return { id: "job", runId: "run", input: { id: "source", nodeId: "source", title: "原图", url: "source", storageKey: "image:source", phrase: "" }, settings: { template: PRESET, model: "image-model", textModel: "vision", size: "", transparent: true, cutoutMode: "goods" }, phase: "analyze", status: "queued", whiteNodeId: "white", cutoutNodeId: "cutout", x: 0, y: 0 }; }
function harness() {
    const calls: string[] = []; const updates: Job[] = []; const controller = new AbortController();
    const runner = { signal: controller.signal, update: (next: Job) => updates.push(next), output: (_job: Job, kind: string) => { calls.push(`output:${kind}`); },
        media: { saveImage: async (src: string) => { calls.push(`save:${src}`); return { ...image, storageKey: `image:${src}` }; }, resolveImage: async (ref: { storageKey?: string }) => ref.storageKey || "source", removeBackground: async (_src: string, _mode: string) => { calls.push("cutout"); return { image: "cutout" }; }, recordGeneration: async () => { calls.push("record"); }, cutoutReady: () => true, configureCutout: () => {} },
        ai: { generateText: async () => { calls.push("analyze"); return { text: "针织背心" }; }, generateImage: async (_prompt: string, options?: { references?: string[] }) => { calls.push(`generate:${options?.references?.join(",")}`); return { images: ["white"] }; }, generateVideo: async () => ({ url: "", mimeType: "video/mp4" }), listModels: () => [], defaultModel: () => "" },
    };
    return { calls, updates, controller, runner };
}
describe("逐图平铺任务", () => {
    test("输入独立识别，先保存白底再去底", async () => {
        const h = harness(); const result = await processJob(job(), h.runner);
        expect(result.status).toBe("success"); expect(result.input.phrase).toBe("针织背心");
        expect(h.calls).toEqual(["analyze", "generate:image:source", "save:white", "output:white", "record", "cutout", "save:cutout", "output:cutout"]);
        expect(h.updates.find((j) => j.white)?.white?.storageKey).toBe("image:white");
    });
    test("手动目标跳过识别，白底模式不调用去底", async () => {
        const h = harness(); const j = job(); j.input.phrase = "外套"; j.settings.transparent = false;
        expect((await processJob(j, h.runner)).status).toBe("success"); expect(h.calls).not.toContain("analyze"); expect(h.calls).not.toContain("cutout");
    });
    test("去底失败保留白底，重试不会重新识别生图", async () => {
        const h = harness(); h.runner.media.removeBackground = async () => { throw new Error("去底失败"); };
        const failed = await processJob(job(), h.runner); expect(failed.status).toBe("error"); expect(failed.white).toBeDefined(); expect(failed.phase).toBe("cutout");
        const next = harness(); const done = await processJob(failed, next.runner);
        expect(done.status).toBe("success"); expect(next.calls).toEqual(["output:white", "cutout", "save:cutout", "output:cutout"]);
    });
    test("一项失败后另一项仍能执行", async () => {
        const h = harness(); h.runner.ai.generateImage = async () => { throw new Error("生成失败"); };
        expect((await processJob(job(), h.runner)).status).toBe("error");
        const next = harness(); const other = job(); other.input.storageKey = "image:second";
        expect((await processJob(other, next.runner)).status).toBe("success"); expect(next.calls).toContain("generate:image:second");
    });
    test("停止后不发送新请求", async () => {
        const h = harness(); h.controller.abort(); expect((await processJob(job(), h.runner)).status).toBe("interrupted"); expect(h.calls).toEqual([]);
    });
    test("生图完成时取消不开始去底", async () => {
        const h = harness(); h.runner.ai.generateImage = async () => { h.controller.abort(); return { images: ["late"] }; };
        expect((await processJob(job(), h.runner)).status).toBe("interrupted"); expect(h.calls).not.toContain("cutout"); expect(h.calls).not.toContain("save:late");
    });
    test("保存失败不自动再次生图", async () => {
        const h = harness(); const j = job(); j.phase = "save";
        expect((await processJob(j, h.runner)).status).toBe("error"); expect(h.calls).toEqual([]);
    });
    test("刷新只标记中断，不重置已成功产物", () => {
        const running = { ...job(), status: "running" as const, white: image }; const done = { ...job(), status: "success" as const };
        const recovered = recoverJobs([running, done]); expect(recovered[0].status).toBe("interrupted"); expect(recovered[0].white).toBe(image); expect(recovered[1]).toBe(done);
    });
    test("模板绑定每件目标，缺失变量阻止运行", () => {
        expect(fillPrompt(PRESET, "大衣")).not.toContain("{目标单品}"); expect(() => fillPrompt("无变量", "大衣")).toThrow(); expect(() => fillPrompt(PRESET, " ")).toThrow();
    });
    test("组输入按源节点去重，绝不混成一条请求", () => {
        const a = { id: "a", type: "image", title: "A", metadata: { content: "a.png", storageKey: "image:a", groupId: "g" } };
        const b = { id: "b", type: "image", title: "B", metadata: { content: "b.png", storageKey: "image:b", groupId: "g" } };
        const ctx = { getUpstream: () => [{ id: "g", type: "group" }, a], getNodes: () => [a, b] };
        expect(collectInputs(ctx as never).map((input) => input.id)).toEqual(["a", "b"]);
    });
});

test("背面模板和指令保持单件背面，不携带正面展示要求", () => {
    const prompt = fillPrompt(BACK_PRESET, "卫衣", "back");
    expect(prompt).toContain("背面3D平铺");
    expect(prompt).toContain("本次输出视图：背面");
    expect(prompt).not.toContain("正面视图必须居中");
});
test("文件夹单连线拆成独立图片并保留存储引用与路径", () => {
    const folder = { id: "folder", type: "flatlay:folder", metadata: { folderImages: [{ ...image, id: "one", path: "衣服/1.png" }, { ...image, id: "two", path: "衣服/子目录/2.png" }] } };
    const values = collectInputs({ getUpstream: () => [folder], getNodes: () => [] } as never);
    expect(values.map((input) => input.id)).toEqual(["folder#one", "folder#two"]);
    expect(values.map((input) => input.title)).toEqual(["衣服/1.png", "衣服/子目录/2.png"]);
    expect(values.every((input) => input.storageKey === image.storageKey)).toBe(true);
});

test("白底保存结束时停止仍保留检查点，重试不重复生图", async () => {
    const h = harness(); const save = h.runner.media.saveImage;
    h.runner.media.saveImage = async (source) => { const value = await save(source); h.controller.abort(); return value; };
    const stopped = await processJob(job(), h.runner);
    expect(stopped.status).toBe("interrupted"); expect(stopped.white?.storageKey).toBe("image:white");
    const resumed = harness(); await processJob(stopped, resumed.runner);
    expect(resumed.calls.some((call) => call.startsWith("generate:"))).toBe(false);
});
test("透明底保存结束时停止仍保留产物，重试不重复去底", async () => {
    const h = harness(); const j = job(); j.white = image; const save = h.runner.media.saveImage;
    h.runner.media.saveImage = async (source) => { const value = await save(source); h.controller.abort(); return value; };
    const stopped = await processJob(j, h.runner);
    expect(stopped.cutout?.storageKey).toBe("image:cutout");
    const resumed = harness(); expect((await processJob(stopped, resumed.runner)).status).toBe("success");
    expect(resumed.calls).toEqual(["output:white", "output:cutout"]);
});
