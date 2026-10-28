import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { useAuthStore } from '@/stores/auth'
import type { CreationCredential } from './useCreationSelection'
import { ChatFailure, chatContext, streamChat, type ChatConversation, type ChatMessage, type ChatPreference } from '@/lib/creation-chat'
import { chatCapability } from '@/lib/creation-chat-config'
import { chatTimeouts } from '@/lib/creation-chat-timeout'
import { chatSnapshot, loadChats, writeChat } from '@/lib/creation-chat-db'

/** @description 本地聊天控制器；请求、读库和写库均绑定发送时的用户及会话。 */
export function useCreationChat(credential: Ref<CreationCredential | null>, locked: Ref<boolean>) {
  const auth = useAuthStore()
  const conversations = ref<ChatConversation[]>([])
  const activeId = ref('')
  const draft = ref('')
  const loading = ref(true)
  const storageError = ref(false)
  const actionError = ref('')
  const busy = ref(false)
  const active = computed(() => conversations.value.find(c => c.id === activeId.value))
  const sorted = computed(() => [...conversations.value].sort((a, b) => b.updatedAt - a.updatedAt))
  let generation = 0
  let disposed = false
  let request: { controller: AbortController; chat: ChatConversation; answer: ChatMessage; owner: number } | undefined
  let writes: Promise<unknown> = Promise.resolve()
  let checkpoint: ReturnType<typeof setTimeout> | undefined

  function persist(chat: ChatConversation) {
    // 排队前复制白名单字段，禁止异步写库读取后续 UI 的配置或其他用户的数据。
    const snapshot = chatSnapshot(chat)
    writes = writes.then(() => writeChat(snapshot.userId, snapshot)).catch(() => {
      if (!disposed && auth.user?.id === snapshot.userId && !locked.value) storageError.value = true
    })
    return writes
  }
  function flushCheckpoint() { clearTimeout(checkpoint); checkpoint = undefined }
  function stop() {
    const current = request
    if (!current) return
    request = undefined
    busy.value = false
    flushCheckpoint()
    current.answer.phase = 'stopping'
    current.controller.abort()
    current.answer.phase = undefined
    current.answer.status = 'interrupted'
    current.answer.error = 'stopped'
    void persist(current.chat)
  }
  function select(id: string) {
    if (id === activeId.value) return
    stop()
    activeId.value = id
    if (active.value) { active.value.updatedAt = Date.now(); void persist(active.value) }
    draft.value = ''
    actionError.value = ''
  }
  function create() {
    if (loading.value || locked.value || !auth.isAuthenticated || !auth.user?.id) return
    stop()
    const chat: ChatConversation = { id: crypto.randomUUID(), userId: auth.user.id, title: '', createdAt: Date.now(), updatedAt: Date.now(), messages: [] }
    conversations.value.unshift(chat)
    activeId.value = chat.id
    draft.value = ''
    actionError.value = ''
    void persist(chat)
  }
  async function remove(id: string) {
    const chat = conversations.value.find(c => c.id === id)
    if (!chat) return
    if (request?.chat.id === id) stop()
    conversations.value = conversations.value.filter(c => c.id !== id)
    if (activeId.value === id) { activeId.value = sorted.value[0]?.id || ''; draft.value = '' }
    // 删除与尚未完成的保存串行，防止旧写入复活已删除会话。
    writes = writes.then(() => writeChat(chat.userId, id)).catch(() => { if (auth.user?.id === chat.userId) storageError.value = true })
    await writes
  }
  async function rename(id: string, title: string) {
    const chat = conversations.value.find(c => c.id === id)
    if (!chat || !title.trim()) return
    chat.title = title.trim().slice(0, 100)
    await persist(chat)
  }
  function preference(value: ChatPreference) {
    if (!active.value || loading.value || locked.value) return
    active.value.preference = { ...value }
    void persist(active.value)
  }

  async function send(regenerate = false, selection?: ChatPreference) {
    const config = credential.value
    if (busy.value || loading.value || locked.value || !config || !auth.isAuthenticated || config.userId !== auth.user?.id) return
    if (!regenerate && !draft.value.trim()) return
    // 新建会话会重置输入框，先固定本次问题，避免首条消息丢失。
    let question = draft.value.trim()
    if (!active.value) create()
    const chat = active.value
    if (!chat) return
    let history = [...chat.messages]
    if (regenerate) {
      // 只替换最后一轮助手回答，早期轮次保持原样，不复制用户消息。
      const lastUser = history.map(m => m.role).lastIndexOf('user')
      if (lastUser < 0) return
      question = history[lastUser]!.content
      history = history.slice(0, lastUser)
    }
    let context, protocol, timeouts
    try {
      context = chatContext(history, question)
      protocol = chatCapability(config.model, config.userId, config.keyId).protocol
      timeouts = chatTimeouts()
    } catch (error) {
      actionError.value = error instanceof ChatFailure ? error.code : 'configuration'
      if (!regenerate) draft.value = question
      return
    }
    // 只复制单次请求需要的凭证，后续切换模型/Key 不影响该对象。
    const snapshot = { ...config, models: [...config.models] }
    if (selection) chat.preference = { model: snapshot.model, key: selection.key }
    const questionMessage: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: question, createdAt: Date.now(), status: 'complete' }
    if (regenerate) {
      const index = chat.messages.map(m => m.role).lastIndexOf('user')
      chat.messages = chat.messages.slice(0, index + 1)
    } else { chat.messages.push(questionMessage); draft.value = '' }
    const answer: ChatMessage = { id: crypto.randomUUID(), role: 'assistant', content: '', status: 'streaming', createdAt: Date.now(), model: snapshot.model, keyId: snapshot.keyId, protocol, phase: 'waiting' }
    chat.messages.push(answer)
    // ref 会递归代理消息，使用列表中的响应式对象以便逐片渲染。
    const reactiveAnswer = chat.messages[chat.messages.length - 1]!
    chat.title ||= question.replace(/\s+/g, ' ').slice(0, 32)
    chat.updatedAt = Date.now()
    actionError.value = ''
    busy.value = true
    const current = { controller: new AbortController(), chat, answer: reactiveAnswer, owner: chat.userId }
    request = current
    // 本地存储卡住不能阻止网络请求与主动停止；保存仍按顺序异步执行。
    void persist(chat)
    try {
      if (request !== current || current.controller.signal.aborted) return
      await streamChat(snapshot, context, current.controller.signal, text => {
        if (request !== current || auth.user?.id !== current.owner || locked.value) return
        if (reactiveAnswer.content.length + text.length > 500000) throw new ChatFailure('incomplete')
        reactiveAnswer.phase = 'generating'
        reactiveAnswer.content += text
        if (!checkpoint) checkpoint = setTimeout(() => { checkpoint = undefined; void persist(chat) }, 600)
      }, { protocol, timeouts, activity: value => {
        if (request !== current || auth.user?.id !== current.owner || locked.value) return
        if (value === 'reasoning') reactiveAnswer.phase = 'reasoning'
        if (value === 'text') reactiveAnswer.phase = 'generating'
      } })
      if (request === current) {
        if (!reactiveAnswer.content.trim()) throw new ChatFailure('empty')
        reactiveAnswer.status = 'complete'
      }
    } catch (error) {
      if (request !== current) return
      reactiveAnswer.status = reactiveAnswer.content ? 'interrupted' : 'error'
      reactiveAnswer.error = error instanceof ChatFailure ? error.code : 'network'
    } finally {
      reactiveAnswer.phase = undefined
      if (request === current) {
        request = undefined
        busy.value = false
        flushCheckpoint()
        await persist(chat)
      }
    }
  }

  async function restore() {
    const current = ++generation
    stop()
    conversations.value = []
    activeId.value = ''
    draft.value = ''
    storageError.value = false
    actionError.value = ''
    loading.value = true
    const owner = auth.user?.id
    if (!owner || !auth.isAuthenticated || locked.value) { loading.value = false; return }
    try {
      const records = await loadChats(owner)
      if (disposed || current !== generation || auth.user?.id !== owner || locked.value) return
      conversations.value = records
      activeId.value = records[0]?.id || ''
    } catch { if (current === generation) storageError.value = true }
    finally { if (current === generation) loading.value = false }
  }
  watch(() => [auth.user?.id, auth.isAuthenticated, locked.value], () => { void restore() }, { immediate: true, flush: 'sync' })
  function checkSession() {
    let valid = false
    try { valid = !!localStorage.getItem('auth_token') && JSON.parse(localStorage.getItem('auth_user') || 'null')?.id === auth.user?.id } catch { /* 无法确认身份时立即清空视图。 */ }
    if (!valid) {
      generation++
      stop()
      conversations.value = []
      activeId.value = ''
      draft.value = ''
    }
  }
  window.addEventListener('storage', checkSession)
  onBeforeUnmount(() => { stop(); disposed = true; generation++; window.removeEventListener('storage', checkSession) })
  return { conversations: sorted, active, activeId, draft, loading, storageError, actionError, busy, select, create, remove, rename, preference, send, stop }
}
