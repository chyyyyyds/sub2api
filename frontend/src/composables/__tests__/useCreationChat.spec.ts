import 'fake-indexeddb/auto'
import { mount } from '@vue/test-utils'
import { defineComponent, reactive, ref, shallowRef } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useCreationChat } from '../useCreationChat'
import { ChatFailure } from '@/lib/creation-chat'
import type { CreationCredential } from '../useCreationSelection'
import { loadChats } from '@/lib/creation-chat-db'
import * as chatDB from '@/lib/creation-chat-db'

vi.mock('@/stores/auth', () => ({ useAuthStore: () => auth }))
vi.mock('@/lib/creation-chat', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/creation-chat')>(), streamChat: vi.fn() }))
import { streamChat } from '@/lib/creation-chat'
const auth = reactive({ user: { id: 11000 }, isAuthenticated: true })
const config = (): CreationCredential => ({ userId: auth.user.id, keyId: 1, keyName: '模拟', apiKey: 'MEMORY-ONLY-SECRET', model: 'gpt-6', models: ['gpt-6'] })
function setup() {
  const credential = shallowRef<CreationCredential | null>(config()), locked = ref(false)
  let chat!: ReturnType<typeof useCreationChat>
  const wrapper = mount(defineComponent({ setup() { chat = useCreationChat(credential, locked); return () => null } }))
  return { chat, credential, locked, wrapper }
}
async function ready(chat: ReturnType<typeof useCreationChat>) { await vi.waitFor(() => expect(chat.loading.value).toBe(false)) }
beforeEach(() => {
  auth.user.id++
  auth.isAuthenticated = true
  vi.mocked(streamChat).mockReset().mockImplementation(async (_config, _context, _signal, text) => { text('完整回答') })
})
describe('聊天生命周期和并发归属', () => {
  it('同一用户资料刷新不重置会话、草稿或中断正在接收的回答', async () => {
    let complete!: () => void
    let signal!: AbortSignal
    vi.mocked(streamChat).mockImplementation(async (_config, _context, currentSignal, text) => {
      signal = currentSignal
      text('正在回答')
      await new Promise<void>(resolve => { complete = resolve })
    })
    const { chat, wrapper } = setup()
    await ready(chat)
    chat.draft.value = '保留当前会话'
    const pending = chat.send()
    await vi.waitFor(() => expect(chat.busy.value).toBe(true))
    const id = chat.activeId.value
    chat.draft.value = '尚未发送的草稿'
    auth.user = { ...auth.user }
    await Promise.resolve()
    expect(signal.aborted).toBe(false)
    expect(chat.busy.value).toBe(true)
    expect(chat.activeId.value).toBe(id)
    expect(chat.draft.value).toBe('尚未发送的草稿')
    complete()
    await pending
    expect(chat.active.value?.messages.at(-1)?.content).toBe('正在回答')
    wrapper.unmount()
  })
  it('多轮上下文、连续发送防重和请求快照', async () => {
    const { chat, credential, wrapper } = setup()
    await ready(chat)
    chat.draft.value = '第一问'
    await Promise.all([chat.send(), chat.send()])
    expect(streamChat).toHaveBeenCalledTimes(1)
    credential.value = { ...config(), model: 'claude-sonnet', keyId: 2 }
    chat.draft.value = '第二问'
    await chat.send()
    expect(vi.mocked(streamChat).mock.calls[1]?.[1]).toEqual([{ role: 'user', content: '第一问' }, { role: 'assistant', content: '完整回答' }, { role: 'user', content: '第二问' }])
    expect(chat.active.value?.messages[1]).toMatchObject({ model: 'gpt-6', keyId: 1 })
    expect(chat.active.value?.messages[3]).toMatchObject({ model: 'claude-sonnet', keyId: 2 })
    expect(JSON.stringify(await loadChats(auth.user.id))).not.toContain('MEMORY-ONLY-SECRET')
    wrapper.unmount()
  })
  it('停止保留内容并标中断，下一轮排除不完整轮次', async () => {
    let chunk!: (text: string) => void, done!: () => void
    vi.mocked(streamChat).mockImplementationOnce(async (_c, _h, _s, text) => { chunk = text; text('半截'); await new Promise<void>(resolve => { done = resolve }) })
    const { chat, wrapper } = setup(); await ready(chat)
    chat.draft.value = '停止问题'
    const running = chat.send()
    await vi.waitFor(() => expect(chunk).toBeDefined())
    chat.stop()
    chunk('迟到片段')
    done(); await running
    expect(chat.active.value?.messages[1]).toMatchObject({ content: '半截', status: 'interrupted', error: 'stopped' })
    chat.draft.value = '新问题'; await chat.send()
    expect(vi.mocked(streamChat).mock.calls[1]?.[1]).toEqual([{ role: 'user', content: '新问题' }])
    wrapper.unmount()
  })
  it('生成中换配置只影响后续请求，当前回答归属不改变', async () => {
    let done!: () => void
    vi.mocked(streamChat).mockImplementationOnce(async (c, _h, _s, text) => { await new Promise<void>(resolve => { done = resolve }); text(c.model) })
    const { chat, credential, wrapper } = setup(); await ready(chat)
    chat.draft.value = '问题'; const running = chat.send()
    await vi.waitFor(() => expect(done).toBeDefined())
    credential.value = { ...config(), model: 'claude-sonnet', keyId: 7 }
    done(); await running
    expect(chat.active.value?.messages[1]).toMatchObject({ content: 'gpt-6', model: 'gpt-6', keyId: 1 })
    wrapper.unmount()
  })
  it('切换会话后旧片段与旧结束事件不能污染新会话', async () => {
    let chunk!: (text: string) => void, done!: () => void
    vi.mocked(streamChat).mockImplementationOnce(async (_c, _h, _s, text) => { chunk = text; text('旧回答'); await new Promise<void>(resolve => { done = resolve }) })
    const { chat, wrapper } = setup(); await ready(chat)
    chat.create(); const first = chat.activeId.value
    chat.create(); const second = chat.activeId.value
    chat.select(first); chat.draft.value = '旧问题'; const running = chat.send()
    await vi.waitFor(() => expect(chunk).toBeDefined())
    chat.select(second); chunk('迟到'); done(); await running
    expect(chat.activeId.value).toBe(second)
    expect(chat.active.value?.messages).toEqual([])
    expect(chat.conversations.value.find(c => c.id === first)?.messages[1]).toMatchObject({ content: '旧回答', status: 'interrupted' })
    wrapper.unmount()
  })
  it('重新生成替换最后回答并且只发送一次最后问题', async () => {
    const { chat, wrapper } = setup(); await ready(chat)
    chat.draft.value = '第一问'; await chat.send()
    chat.draft.value = '第二问'; await chat.send()
    await chat.send(true)
    expect(chat.active.value?.messages).toHaveLength(4)
    expect(vi.mocked(streamChat).mock.calls[2]?.[1]).toEqual([{ role: 'user', content: '第一问' }, { role: 'assistant', content: '完整回答' }, { role: 'user', content: '第二问' }])
    wrapper.unmount()
  })
  it('网络错误与流式错误保留文本，错误分类可重试', async () => {
    vi.mocked(streamChat).mockImplementationOnce(async (_c, _h, _s, text) => { text('已收到'); throw new ChatFailure('disconnected') })
    const { chat, wrapper } = setup(); await ready(chat)
    chat.draft.value = '问题'; await chat.send()
    expect(chat.active.value?.messages[1]).toMatchObject({ content: '已收到', status: 'interrupted', error: 'disconnected' })
    await chat.send(true)
    expect(chat.active.value?.messages).toHaveLength(2)
    expect(chat.active.value?.messages[1]?.status).toBe('complete')
    wrapper.unmount()
  })
  it('自动标题、手动重命名、刷新恢复和删除', async () => {
    let state = setup(); await ready(state.chat)
    state.chat.draft.value = '我的第一段对话'; await state.chat.send(false, { model: 'gpt-6', key: 'auto' })
    expect(state.chat.active.value?.title).toBe('我的第一段对话')
    const id = state.chat.activeId.value
    state.chat.rename(id, '自定义标题'); await vi.waitFor(async () => expect((await loadChats(auth.user.id))[0]?.title).toBe('自定义标题'))
    state.wrapper.unmount(); state = setup(); await ready(state.chat)
    expect(state.chat.activeId.value).toBe(id)
    expect(state.chat.active.value?.preference).toEqual({ key: 'auto', model: 'gpt-6' })
    expect(state.chat.active.value?.messages).toHaveLength(2)
    await state.chat.remove(id)
    expect(await loadChats(auth.user.id)).toEqual([])
    state.wrapper.unmount()
  })
  it('同一页面换用户立即清空视图，并隔离历史', async () => {
    const { chat, wrapper } = setup(); await ready(chat)
    const previous = auth.user.id
    chat.draft.value = 'A 用户的秘密'; await chat.send()
    auth.user.id++
    expect(chat.conversations.value).toEqual([])
    await ready(chat)
    expect(chat.conversations.value).toEqual([])
    expect((await loadChats(previous))[0]?.messages[0]?.content).toBe('A 用户的秘密')
    wrapper.unmount()
  })
  it('跨标签身份变化清空视图并取消生成', async () => {
    const { chat, locked, wrapper } = setup(); await ready(chat)
    chat.draft.value = 'A 的消息'; await chat.send()
    locked.value = true
    expect(chat.conversations.value).toEqual([])
    expect(chat.draft.value).toBe('')
    wrapper.unmount()
  })
  it('存储写入失败明确提示，仍允许当前内存对话', async () => {
    const { chat, wrapper } = setup(); await ready(chat)
    const failure = vi.spyOn(chatDB, 'writeChat').mockRejectedValue(new Error('QuotaExceededError'))
    chat.draft.value = '存储已满'; await chat.send()
    expect(chat.storageError.value).toBe(true)
    expect(chat.active.value?.messages[1]).toMatchObject({ content: '完整回答', status: 'complete' })
    failure.mockRestore(); wrapper.unmount()
  })
  it('初始读库失败不展示其他用户数据', async () => {
    const failure = vi.spyOn(chatDB, 'loadChats').mockRejectedValueOnce(new Error('storage'))
    const { chat, wrapper } = setup(); await ready(chat)
    expect(chat.storageError.value).toBe(true)
    expect(chat.conversations.value).toEqual([])
    failure.mockRestore(); wrapper.unmount()
  })
  it('首条上下文过长保留草稿，并阻止发出请求', async () => {
    const { chat, wrapper } = setup(); await ready(chat)
    const content = '中'.repeat(48001)
    chat.draft.value = content; await chat.send()
    expect(chat.actionError.value).toBe('context')
    expect(chat.draft.value).toBe(content)
    expect(streamChat).not.toHaveBeenCalled()
    expect(chat.active.value?.messages).toEqual([])
    wrapper.unmount()
  })
  it('发送冻结协议，生成中换模型与 Key 不改变协议；推理原文不持久化', async () => {
    let release!: () => void
    vi.mocked(streamChat).mockImplementationOnce(async (_c, _h, _s, text, options) => {
      options?.activity?.('reasoning')
      await new Promise<void>(resolve => { release = resolve })
      text('推理后的正文')
    })
    const { chat, credential, wrapper } = setup(); await ready(chat)
    credential.value = { ...config(), model: 'claude-sonnet' }
    chat.draft.value = '请思考'; const run = chat.send()
    await vi.waitFor(() => expect(release).toBeDefined())
    expect(chat.active.value?.messages[1]).toMatchObject({ phase: 'reasoning', protocol: 'messages' })
    credential.value = { ...config(), model: 'gpt-5-codex', keyId: 9 }
    expect(vi.mocked(streamChat).mock.calls[0]?.[4]?.protocol).toBe('messages')
    release(); await run
    expect((await loadChats(auth.user.id))[0]?.messages[1]).toMatchObject({ protocol: 'messages', content: '推理后的正文', keyId: 1 })
    wrapper.unmount()
  })
  it('检查点与停止落库保留部分回答；停止后重新生成不重复当前问题', async () => {
    let release!: () => void
    vi.mocked(streamChat).mockImplementationOnce(async (_c, _h, _s, text) => {
      text('保存中的半截回答'); await new Promise<void>(resolve => { release = resolve })
    })
    const { chat, wrapper } = setup(); await ready(chat)
    chat.draft.value = '问题'; const run = chat.send()
    await vi.waitFor(() => expect(release).toBeDefined())
    await vi.waitFor(async () => expect((await loadChats(auth.user.id))[0]?.messages[1]?.content).toBe('保存中的半截回答'), { timeout: 2000 })
    chat.stop(); release(); await run
    await vi.waitFor(async () => expect((await loadChats(auth.user.id))[0]?.messages[1]?.error).toBe('stopped'))
    await chat.send(true)
    expect(vi.mocked(streamChat).mock.calls[1]?.[1]).toEqual([{ role: 'user', content: '问题' }])
    expect(chat.active.value?.messages).toHaveLength(2)
    wrapper.unmount()
  })
  it('存储永久等待不阻塞网络和主动停止', async () => {
    const { chat, wrapper } = setup(); await ready(chat)
    const write = vi.spyOn(chatDB, 'writeChat').mockReturnValue(new Promise(() => {}))
    vi.mocked(streamChat).mockImplementationOnce(async (_c, _h, _s, text) => { text('已发送'); await new Promise(() => {}) })
    chat.draft.value = '卡住的存储'; void chat.send()
    await vi.waitFor(() => expect(streamChat).toHaveBeenCalledTimes(1))
    chat.stop(); expect(chat.busy.value).toBe(false)
    expect(chat.active.value?.messages[1]).toMatchObject({ content: '已发送', error: 'stopped' })
    write.mockRestore(); wrapper.unmount()
  })
  it('真正的 storage 事件换号取消请求，迟到活动不能显示旧数据', async () => {
    let text!: (text: string) => void, release!: () => void
    vi.mocked(streamChat).mockImplementationOnce(async (_c, _h, _s, onText) => { text = onText; await new Promise<void>(resolve => { release = resolve }) })
    const { chat, wrapper } = setup(); await ready(chat)
    localStorage.setItem('auth_token', 'mock')
    localStorage.setItem('auth_user', JSON.stringify({ id: auth.user.id + 1 }))
    chat.draft.value = '旧用户内容'; const run = chat.send()
    await vi.waitFor(() => expect(release).toBeDefined())
    window.dispatchEvent(new StorageEvent('storage', { key: 'auth_user' }))
    text('不应展示'); release(); await run
    expect(chat.conversations.value).toEqual([]); expect(chat.busy.value).toBe(false)
    wrapper.unmount(); localStorage.clear()
  })
})
