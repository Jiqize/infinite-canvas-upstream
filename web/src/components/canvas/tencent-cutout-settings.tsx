import { Alert, Button, Form, Input, Modal } from "antd";
import { useState } from "react";
import { useTencentCutoutStore, type TencentCutoutConfig } from "@/stores/use-tencent-cutout-store";

export function TencentCutoutSettings() {
    const { open, config, setConfig, setOpen } = useTencentCutoutStore();
    const [error, setError] = useState("");
    const [form] = Form.useForm<TencentCutoutConfig>();
    const importFile = async (file?: File) => {
        if (!file) return;
        try {
            const value = JSON.parse(await file.text());
            if (!["secretId", "secretKey", "bucket", "region"].every((key) => typeof value[key] === "string" && value[key].trim())) throw new Error();
            const bucket = value.appId && !value.bucket.endsWith(`-${value.appId}`) ? `${value.bucket}-${value.appId}` : value.bucket;
            form.setFieldsValue({ secretId: value.secretId, secretKey: value.secretKey, bucket, region: value.region, token: typeof value.token === "string" ? value.token : "" });
            setError("");
        } catch { setError("配置文件无效，需要 SecretId、SecretKey、Bucket 和地域。"); }
    };
    return <Modal title="腾讯云去背景" open={open} onCancel={() => setOpen(false)} afterOpenChange={(visible) => { if (visible) { form.resetFields(); form.setFieldsValue(config || {}); setError(""); } else form.resetFields(); }} onOk={() => form.submit()} okText="本次会话使用" cancelText="取消" destroyOnHidden>
        <Alert type="info" showIcon title="配置只保存在本次页面内存中，刷新后需重新导入。" description="使用已开通数据万象的 COS 桶；浏览器直连需要桶允许当前站点的 CORS（PUT、GET、DELETE 及签名请求头）。去背景会产生腾讯云费用。" />
        <Form form={form} layout="vertical" onFinish={(values) => { setConfig(Object.fromEntries(Object.entries(values).map(([key, value]) => [key, typeof value === "string" ? value.trim() : value])) as TencentCutoutConfig); setOpen(false); }} className="mt-4">
            <Form.Item label="SecretId" name="secretId" rules={[{ required: true, whitespace: true }]}><Input autoComplete="off" /></Form.Item>
            <Form.Item label="SecretKey" name="secretKey" rules={[{ required: true, whitespace: true }]}><Input.Password autoComplete="off" /></Form.Item>
            <Form.Item label="Bucket（含 APPID 后缀）" name="bucket" rules={[{ required: true, pattern: /^[a-z0-9-]+-\d+$/, message: "填写完整桶名，例如 clothing-1234567890" }]}><Input /></Form.Item>
            <Form.Item label="地域" name="region" rules={[{ required: true, pattern: /^[a-z]+-[a-z]+(?:-\d+)?$/, message: "填写腾讯云地域，例如 ap-guangzhou" }]}><Input placeholder="ap-guangzhou" /></Form.Item>
            <Form.Item label="临时凭据 Token（可选）" name="token"><Input.Password autoComplete="off" /></Form.Item>
        </Form>
        <label className="cursor-pointer text-sm">导入 MindFrame 腾讯配置 JSON<input className="block mt-2" type="file" accept=".json,application/json" onChange={(e) => { void importFile(e.target.files?.[0]); e.target.value = ""; }} /></label>
        {error && <p role="alert">{error}</p>}
        <Button type="text" onClick={() => { setConfig(null); form.resetFields(); }}>清除本次凭据</Button>
    </Modal>;
}
