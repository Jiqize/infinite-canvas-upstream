import { expect, test } from "bun:test";
import { readDroppedFiles } from "./drop";
const file = (name: string) => new File(["image"], name, { type: "image/png" });
const entry = (name: string): any => ({ name, isFile: true, file: (done: (value: File) => void) => done(file(name)) });
function directory(name: string, batches: any[][]): any {
    return { name, isDirectory: true, createReader: () => { let index = 0; return { readEntries: (done: (value: any[]) => void) => done(batches[index++] || []) }; } };
}
const transfer = (...entries: any[]): DataTransfer => ({ items: entries.map((value) => ({ kind: "file", webkitGetAsEntry: () => value, getAsFile: () => null })), files: [] }) as unknown as DataTransfer;
test("递归读取目录全部批次和子目录，保留路径", async () => {
    const result = await readDroppedFiles(transfer(directory("衣服", [[entry("1.png")], [directory("背面", [[entry("2.png")]])]])));
    expect(result.files.map((item) => item.path)).toEqual(["衣服/1.png", "衣服/背面/2.png"]);
    expect(result.errors).toEqual([]);
});
test("无法读取某个文件时保留其他成功文件", async () => {
    const result = await readDroppedFiles(transfer({ name: "坏图.png", isFile: true, file: (_ok: unknown, fail: (e: Error) => void) => fail(new Error("不可读")) }, entry("好图.png")));
    expect(result.errors).toEqual(["坏图.png"]);
    expect(result.files[0].path).toBe("好图.png");
});
test("普通多文件拖入支持没有目录 API 的浏览器", async () => {
    const result = await readDroppedFiles({ items: [], files: [file("1.png"), file("2.png")] } as unknown as DataTransfer);
    expect(result.files.map((item) => item.path)).toEqual(["1.png", "2.png"]);
});
