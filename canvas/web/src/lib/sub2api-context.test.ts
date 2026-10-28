import { describe, expect, test } from 'bun:test';
import { parseHostConfig } from './sub2api-context';

const config = { type: 'new-api:canvas-config', version: 1, baseUrl: 'https://local.test', apiKey: 'custom-key',
    channelName: '图片', historyScope: 'sub2api-user-42', frameId: 'f', sessionId: 's', models: ['alias'], preferredModel: 'alias', studio: 'image' };
describe('Sub2API 画布配置边界', () => {
    test('接受同源、用户空间和列表内模型，支持自定义 Key 前缀', () => {
        expect(parseHostConfig(config, 'https://local.test', 'f')).toEqual(config);
    });
    for (const [name, change] of Object.entries({ origin: { baseUrl: 'https://evil.test' }, frame: { frameId: 'old' }, scope: { historyScope: 'user-42' }, model: { preferredModel: 'outside' }, video: { studio: 'video' }, key: { apiKey: 'bad\r\nkey' } })) {
        test(`拒绝无效配置：${name}`, () => expect(parseHostConfig({ ...config, ...change }, 'https://local.test', 'f')).toBe(null));
    }
});
