import { describe, expect, test } from "bun:test";
import { hostImageCapability, hostImageParams } from "./host-image-capabilities";
import { imageSizePresets } from "./media-size";
const base = { model: "gpt-image-2", size: "auto", quality: "auto", background: "", count: "1" };
describe("宿主图片参数能力", () => {
    test("自动参数不向模型强加质量、尺寸、格式和背景", () => {
        expect(hostImageParams(base)).toEqual({ model: "gpt-image-2", n: 1 });
    });
    test("新版允许已核对自定义尺寸，质量不改变分辨率", () => {
        expect(hostImageParams({ ...base, size: "2048x1152", quality: "low" }, 1)).toEqual({ model: "gpt-image-2", n: 1, size: "2048x1152", quality: "low" });
    });
    for (const size of ["1:1", "15x1024", "100x100", "4096x4096", "3840x3840", "3840x512", "NaNx1024"]) {
        test(`拒绝无效尺寸 ${size}`, () => expect(() => hostImageParams({ ...base, size })).toThrow("尺寸"));
    }
    test("旧模型拒绝 2K / 4K，支持三种标准比例与透明 PNG", () => {
        expect(() => hostImageParams({ ...base, model: "gpt-image-1.5", size: "2048x2048" })).toThrow("尺寸");
        expect(hostImageParams({ ...base, model: "gpt-image-1.5", size: "1536x1024", background: "transparent" }, 1).background).toBe("transparent");
    });
    test("新版不宣称支持透明背景", () => expect(() => hostImageParams({ ...base, background: "transparent" })).toThrow("透明背景"));
    test("参考图超过模型限制时阻止提交", () => expect(() => hostImageParams(base, 17)).toThrow("16 张参考图"));
    for (const model of ["custom-image-alias", "flux-1", "dall-e-3", "gemini-3-image", "gpt-image-future"]) {
        test(`未知协议 ${model} 不发请求`, () => {
            expect(hostImageCapability(model).verified).toBe(false);
            expect(() => hostImageParams({ ...base, model })).toThrow("尚未验证");
        });
    }
    for (const count of ["", "0", "11", "1.5", "NaN"]) test(`拒绝数量 ${count}`, () => expect(() => hostImageParams({ ...base, count })).toThrow("数量"));
    test("不支持的质量不会强行发送", () => expect(() => hostImageParams({ ...base, quality: "hd" })).toThrow("质量"));
});

describe("V6 工作台真实参数联动", () => {
    test("展示别名只选择 Flare 能力，请求仍保留用户模型名", () => {
        const capability = hostImageCapability("gpt-image-2.5");
        expect(capability.capabilityModel).toBe("gpt-image-2.5-flare");
        expect(capability.qualities).toEqual(["auto", "low", "medium", "high", "xhigh", "max"]);
        for (const quality of capability.qualities) {
            const params = hostImageParams({ ...base, model: "gpt-image-2.5", quality });
            expect(params.model).toBe("gpt-image-2.5");
            expect(params.quality).toBe(quality === "auto" ? undefined : quality);
        }
        expect(() => hostImageParams({ ...base, quality: "xhigh" })).toThrow("质量");
        expect(() => hostImageParams({ ...base, quality: "max" })).toThrow("质量");
    });
    for (const model of ["gpt-image-2", "gpt-image-2.5"]) {
        for (const [tier, sizes] of Object.entries(imageSizePresets)) {
            for (const [ratio, size] of Object.entries(sizes)) {
                test(`${model} ${tier} ${ratio} 发送合法像素尺寸`, () => {
                    expect(hostImageParams({ ...base, model, size }).size).toBe(size);
                });
            }
        }
        for (const imageOutputFormat of ["png", "jpeg", "webp"]) {
            test(`${model} ${imageOutputFormat} 仅压缩格式发送压缩率`, () => {
                const params = hostImageParams({ ...base, model, imageOutputFormat, imageOutputCompression: "72" });
                expect(params.output_format).toBe(imageOutputFormat);
                expect(params.output_compression).toBe(imageOutputFormat === "png" ? undefined : 72);
                expect(params.n).toBe(1);
                expect(params.model).toBe(model);
            });
        }
        for (const size of ["1025x1024", "3840x3840", "3840x512", "4096x1024", "256x256", "2k", "16:9"]) {
            test(`${model} 拒绝非法尺寸 ${size}`, () => expect(() => hostImageParams({ ...base, model, size })).toThrow("尺寸"));
        }
        test(`${model} 不开放尚未验证的透明背景`, () => {
            for (const imageOutputFormat of ["png", "jpeg", "webp"]) {
                expect(() => hostImageParams({ ...base, model, imageOutputFormat, background: "transparent" })).toThrow("透明背景");
            }
        });
    }
    test("JPEG 禁用透明背景，PNG/WebP 在明确支持的模型中保留透明", () => {
        const config = { ...base, model: "gpt-image-1.5", background: "transparent" };
        expect(() => hostImageParams({ ...config, imageOutputFormat: "jpeg" })).toThrow("透明背景");
        expect(hostImageParams({ ...config, imageOutputFormat: "webp", imageOutputCompression: "0" }).background).toBe("transparent");
        expect(hostImageParams({ ...config, imageOutputFormat: "png" }).output_compression).toBe(undefined);
    });
    for (const imageOutputCompression of ["-1", "101", "1.5", "", "NaN"]) {
        test(`阻止非法压缩率 ${imageOutputCompression}`, () => expect(() => hostImageParams({ ...base, imageOutputFormat: "webp", imageOutputCompression })).toThrow("压缩率"));
    }
    test("不支持的格式在请求前拒绝", () => expect(() => hostImageParams({ ...base, imageOutputFormat: "gif" })).toThrow("格式"));
});
