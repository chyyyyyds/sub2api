import type { ChatConversation, ChatMessage } from './creation-chat'

/** @description 每个登录用户使用独立数据库，所有读取和写入再校验所属用户。 */
function open(userId: number): Promise<IDBDatabase> {
  if (!Number.isSafeInteger(userId) || userId <= 0) return Promise.reject(new Error('invalid-owner'))
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(`sub2api-creation-chat-v1-user-${userId}`, 1)
    let settled = false
    const timer = setTimeout(() => { settled = true; reject(new Error('storage')) }, 5000)
    request.onupgradeneeded = () => request.result.createObjectStore('conversations', { keyPath: 'id' })
    request.onsuccess = () => { clearTimeout(timer); if (settled) { request.result.close(); return } settled = true; request.result.onversionchange = () => request.result.close(); resolve(request.result) }
    request.onerror = request.onblocked = () => { settled = true; clearTimeout(timer); reject(new Error('storage')) }
  })
}

/** @description 明确允许的持久化字段，避免将凭证对象或未知字段误写入 IndexedDB。 */
const errors = new Set(['stopped', 'disconnected', 'network', 'timeout', 'timeoutHeaders', 'timeoutIdle', 'timeoutProgress', 'timeoutTotal', 'empty', 'protocol', 'incomplete', 'unsupported', 'unauthorized', 'forbidden', 'rateLimit', 'balance', 'context', 'model', 'server', 'request', 'configuration'])
export function chatSnapshot(chat: ChatConversation): ChatConversation {
  const message = (m: ChatMessage): ChatMessage => ({ id: m.id, role: m.role, content: m.content, status: m.status,
    createdAt: m.createdAt, model: m.model, keyId: m.keyId, protocol: m.protocol && ['chat', 'responses', 'messages'].includes(m.protocol) ? m.protocol : undefined, error: m.error ? errors.has(m.error) ? m.error : 'request' : undefined })
  return { id: chat.id, userId: chat.userId, title: chat.title, createdAt: chat.createdAt, updatedAt: chat.updatedAt,
    messages: chat.messages.map(message), preference: chat.preference ? { model: chat.preference.model, key: chat.preference.key } : undefined }
}

/** @description 读取本人会话，按最近使用排序；页面崩溃遗留的生成状态统一恢复为中断。 */
export async function loadChats(userId: number): Promise<ChatConversation[]> {
  const db = await open(userId)
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('conversations')
      transaction.onabort = () => reject(new Error('storage'))
      const request = transaction.objectStore('conversations').getAll()
      request.onsuccess = () => { try { resolve((request.result as ChatConversation[]).filter(c => c.userId === userId).map(c => {
        const copy = chatSnapshot(c)
        copy.messages.forEach(m => { if (m.status === 'streaming') { m.status = 'interrupted'; m.error = 'disconnected' } })
        return copy
      }).sort((a, b) => b.updatedAt - a.updatedAt)) } catch { reject(new Error('storage')) } }
      request.onerror = () => reject(new Error('storage'))
    })
  } finally { db.close() }
}

/** @description 保存本人会话或删除本人会话；事务完成后才报告成功。 */
export async function writeChat(userId: number, chat: ChatConversation | string): Promise<void> {
  if (typeof chat !== 'string' && chat.userId !== userId) throw new Error('invalid-owner')
  const snapshot = typeof chat === 'string' ? chat : chatSnapshot(chat)
  const db = await open(userId)
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('conversations', 'readwrite')
      const store = transaction.objectStore('conversations')
      if (typeof snapshot === 'string') store.delete(snapshot)
      else store.put(snapshot)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(new Error('storage'))
      transaction.onabort = () => reject(new Error('storage'))
    })
  } finally { db.close() }
}
