import COS from "cos-js-sdk-v5";
import { useTencentCutoutStore } from "@/stores/use-tencent-cutout-store";

export async function removeTencentBackground(source: string, mode: "goods" | "general", signal?: AbortSignal) {
    const config = useTencentCutoutStore.getState().config;
    if (!config) throw new Error("请先配置腾讯云去背景");
    const { secretId, secretKey, bucket, region, token } = config;
    const key = `infinite-canvas/flatlay-temp/${crypto.randomUUID()}.png`;
    const host = `${bucket}.cos.${region}.myqcloud.com`;
    // 仅签名由官方 SDK 完成，请求使用 fetch，不引入 SDK 的自动重试。
    const request = async (method: "PUT" | "GET" | "DELETE", query: Record<string, string> = {}, body?: Blob, abort?: AbortSignal) => {
        const headers: Record<string, string> = { ...(token ? { "x-cos-security-token": token } : {}), ...(body ? { "content-type": body.type } : {}) };
        const authorization = COS.getAuthorization({ SecretId: secretId, SecretKey: secretKey, Method: method, Key: key, Bucket: bucket, Region: region, Query: query, Headers: { ...headers, host } });
        const response = await fetch(`https://${host}/${key}?${new URLSearchParams(query)}`, { method, headers: { ...headers, Authorization: authorization }, body, signal: abort });
        if (!response.ok) throw new Error(`腾讯云去背景请求失败（HTTP ${response.status}），请检查凭据、桶权限及数据万象开通状态。`);
        return response;
    };
    const check = () => { if (signal?.aborted) throw new DOMException("已停止", "AbortError"); };
    check();
    const blob = await (await fetch(source, { signal })).blob();
    check();
    let image: Blob | undefined, warning = "", failure: unknown;
    try {
        // 上传等待返回再响应停止，保证清理不早于仍在途的上传。
        await request("PUT", {}, blob);
        check();
        const response = await request("GET", { "ci-process": mode === "goods" ? "GoodsMatting" : "AIPicMatting" }, undefined, signal);
        const output = await response.blob();
        await validateTransparency(output);
        check();
        image = output;
    } catch (error) { failure = error; }
    finally {
        try { await request("DELETE"); }
        catch { warning = `腾讯临时图片未确认清理，请在 COS 检查本次对象：${key}`; }
    }
    if (failure) {
        if (warning) throw new Error(`${failure instanceof Error ? failure.message : "去背景失败"}；${warning}`);
        throw failure;
    }
    if (!image) throw new Error("腾讯云没有返回图片");
    return { image, ...(warning ? { warning } : {}) };
}

export async function validateTransparency(blob: Blob) {
    const bitmap = await createImageBitmap(blob);
    try {
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width; canvas.height = bitmap.height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("无法检查透明图");
        context.drawImage(bitmap, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let transparent = false, visible = false;
        for (let i = 3; i < pixels.length && !(transparent && visible); i += 4) { transparent ||= pixels[i] < 255; visible ||= pixels[i] > 0; }
        if (!transparent || !visible) throw new Error("腾讯返回的图片没有有效透明背景或主体为空，白底图已保留。");
    } finally { bitmap.close(); }
}
