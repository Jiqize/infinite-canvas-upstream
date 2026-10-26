import { afterEach, beforeEach, expect, mock, test } from "bun:test";
const { useTencentCutoutStore } = await import("@/stores/use-tencent-cutout-store");
const { removeTencentBackground, validateTransparency } = await import("./tencent-cutout");
const originalFetch = globalThis.fetch, originalBitmap = globalThis.createImageBitmap, originalDocument = globalThis.document;
let calls: string[], pixels: Uint8ClampedArray;
beforeEach(() => {
    calls = []; pixels = new Uint8ClampedArray([0, 0, 0, 0, 255, 255, 255, 255]);
    useTencentCutoutStore.getState().setConfig({ secretId: "test-only-id", secretKey: "test-only-secret", bucket: "test-123456", region: "ap-guangzhou" });
    globalThis.createImageBitmap = mock(async () => ({ width: 2, height: 1, close() {} })) as never;
    globalThis.document = { createElement: () => ({ getContext: () => ({ drawImage() {}, getImageData: () => ({ data: pixels }) }) }) } as never;
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
        if (String(url).startsWith("data:")) return new Response(new Blob(["input"], { type: "image/png" }));
        calls.push(`${init?.method}:${new URL(String(url)).searchParams.get("ci-process") || ""}`);
        expect((init?.headers as Record<string, string>).Authorization).toContain("q-sign-algorithm=sha1");
        expect(String(url)).not.toContain("test-only-secret");
        return new Response(new Blob(["image"], { type: "image/png" }));
    }) as never;
});
afterEach(() => {
    globalThis.fetch = originalFetch; globalThis.createImageBitmap = originalBitmap; globalThis.document = originalDocument;
    useTencentCutoutStore.getState().setConfig(null);
});
test("腾讯协议 PUT / GoodsMatting / DELETE，密钥不进入 URL", async () => {
    expect((await removeTencentBackground("data:image/png;base64,AA==", "goods")).image).toBeInstanceOf(Blob);
    expect(calls).toEqual(["PUT:", "GET:GoodsMatting", "DELETE:"]);
});
test("通用抠图显式选择 AIPicMatting", async () => {
    await removeTencentBackground("data:image/png;base64,AA==", "general"); expect(calls).toEqual(["PUT:", "GET:AIPicMatting", "DELETE:"]);
});
test("去底失败不自动重试，仍清理对象", async () => {
    const base = globalThis.fetch;
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
        if (init?.method === "GET") { calls.push("GET:failed"); return new Response("failed", { status: 403 }); }
        return base(url, init);
    }) as never;
    await expect(removeTencentBackground("data:image/png;base64,AA==", "goods")).rejects.toThrow("403");
    expect(calls).toEqual(["PUT:", "GET:failed", "DELETE:"]);
});
test("清理失败保留结果并报告临时对象键", async () => {
    const base = globalThis.fetch;
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => init?.method === "DELETE" ? new Response("failed", { status: 500 }) : base(url, init)) as never;
    const result = await removeTencentBackground("data:image/png;base64,AA==", "goods"); expect(result.image).toBeTruthy(); expect(result.warning).toContain("infinite-canvas/flatlay-temp/");
});
test("上传时停止，上传结束后清理，不继续去底", async () => {
    const controller = new AbortController(); const base = globalThis.fetch;
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
        const result = await base(url, init); if (init?.method === "PUT") controller.abort(); return result;
    }) as never;
    await expect(removeTencentBackground("data:image/png;base64,AA==", "goods", controller.signal)).rejects.toThrow("已停止"); expect(calls).toEqual(["PUT:", "DELETE:"]);
});
test("拒绝全不透明和空主体", async () => {
    pixels = new Uint8ClampedArray([255, 255, 255, 255]); await expect(validateTransparency(new Blob())).rejects.toThrow("有效透明背景");
    pixels = new Uint8ClampedArray([0, 0, 0, 0]); await expect(validateTransparency(new Blob())).rejects.toThrow("主体为空");
});
test("未配置不请求", async () => {
    useTencentCutoutStore.getState().setConfig(null); await expect(removeTencentBackground("data:image/png;base64,AA==", "goods")).rejects.toThrow("配置"); expect(calls).toEqual([]);
});
