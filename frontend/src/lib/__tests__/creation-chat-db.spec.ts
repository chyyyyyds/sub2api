import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { loadChats, writeChat } from '../creation-chat-db'
import type { ChatConversation } from '../creation-chat'

function chat(userId: number): ChatConversation { return { id: 'same-session-id', userId, title: '测试', createdAt: 1, updatedAt: 2, preference: { key: 1, model: 'gpt-6' }, messages: [{ id: 'a', role: 'assistant', content: '部分回答', status: 'streaming', createdAt: 1 }] } }
describe('IndexedDB 用户隔离与持久化', () => {
  it('相同会话 ID 在不同用户数据库完全隔离，刷新可恢复', async () => {
    await writeChat(10101, chat(10101))
    expect(await loadChats(10102)).toEqual([])
    await writeChat(10102, { ...chat(10102), title: '另一个用户' })
    expect((await loadChats(10101))[0]?.title).toBe('测试')
    expect((await loadChats(10102))[0]?.title).toBe('另一个用户')
  })
  it('崩溃后将生成状态恢复为中断并保留文本', async () => {
    await writeChat(10103, chat(10103))
    expect((await loadChats(10103))[0]?.messages[0]).toMatchObject({ content: '部分回答', status: 'interrupted', error: 'disconnected' })
  })
  it('序列化白名单丢弃凭证与未知字段', async () => {
    const value = { ...chat(10104), apiKey: 'NEVER-PERSIST', credential: { apiKey: 'NEVER-PERSIST' } }
    Object.assign(value.messages[0]!, { apiKey: 'NEVER-PERSIST' })
    Object.assign(value.preference!, { apiKey: 'NEVER-PERSIST' })
    await writeChat(10104, value)
    expect(JSON.stringify(await loadChats(10104))).not.toContain('NEVER-PERSIST')
  })
  it('拒绝跨用户写入和非法 ID，删除本人数据不影响其他用户', async () => {
    await expect(writeChat(10105, chat(10106))).rejects.toThrow('invalid-owner')
    await expect(loadChats(-1)).rejects.toThrow('invalid-owner')
    await writeChat(10107, chat(10107))
    await writeChat(10107, 'same-session-id')
    expect(await loadChats(10107)).toEqual([])
    expect((await loadChats(10101)).length).toBe(1)
  })
  it('拒绝把未知错误原文写入数据库，停止后刷新保留中断标识', async () => {
    const value = chat(10108)
    Object.assign(value.messages[0]!, { error: 'Authorization: Bearer PRIVATE-UPSTREAM', status: 'interrupted', protocol: 'responses' })
    await writeChat(10108, value)
    const saved = (await loadChats(10108))[0]!
    expect(JSON.stringify(saved)).not.toContain('PRIVATE-UPSTREAM')
    expect(saved.messages[0]).toMatchObject({ status: 'interrupted', error: 'request', content: '部分回答', protocol: 'responses' })
  })
})
