<template>
  <div class="creation-chat-body creation-live-chat" :style="{ paddingBottom: `${keyboardInset}px` }">
    <aside class="creation-history" :class="{ 'is-open': historyOpen }" :aria-label="t('imageStudio.history')">
      <div class="creation-pane-title">{{ t('imageStudio.history') }}<button type="button" :disabled="loading || locked" @click="newChat">＋ {{ t('imageStudio.newChat') }}</button></div>
      <div class="creation-history-list">
        <p v-if="loading" role="status">{{ t('imageStudio.historyLoading') }}</p>
        <div v-else-if="!conversations.length" class="creation-history-empty">{{ t('imageStudio.noChats') }}</div>
        <div v-for="chat in conversations" :key="chat.id" class="creation-history-row" :class="{ selected: activeId === chat.id }">
          <button class="creation-history-select" type="button" :aria-current="activeId === chat.id ? 'true' : undefined" @click="switchChat(chat.id)">{{ chat.title || t('imageStudio.newChat') }}<small>{{ chat.messages.length }} {{ t('imageStudio.messageCount') }}</small></button>
          <div class="creation-history-actions"><button type="button" :aria-label="t('imageStudio.renameChat')" @click="editId = chat.id; editTitle = chat.title">✎</button><button type="button" :aria-label="t('imageStudio.deleteChat')" @click="deleteId = chat.id">×</button></div>
        </div>
      </div>
      <p>{{ t('imageStudio.chatLocal') }}</p>
      <button class="creation-mobile-close" type="button" @click="historyOpen = false">{{ t('imageStudio.closeHistory') }}</button>
    </aside>
    <button v-if="historyOpen" class="creation-history-scrim" :aria-label="t('imageStudio.closeHistory')" @click="historyOpen = false"></button>
    <div class="creation-chat-main">
      <div class="creation-chat-mobilebar"><button type="button" @click="historyOpen = !historyOpen">☰ {{ t('imageStudio.history') }}</button><span>{{ active?.title || t('imageStudio.newChat') }}</span><button type="button" :disabled="loading || locked" @click="newChat">＋</button></div>
      <p v-if="storageError" class="creation-error" role="alert">{{ t('imageStudio.storageError') }}</p>
      <p v-if="protocolNotice" class="creation-protocol-notice" role="status">{{ protocolNotice }}</p>
      <p v-if="actionError" class="creation-error" role="alert">{{ errorText(actionError) }}</p>
      <div ref="messagesElement" class="creation-messages" :aria-label="t('imageStudio.messages')" :aria-busy="busy" @scroll="trackScroll">
        <div v-if="!active?.messages.length" class="creation-welcome"><Icon name="chat" size="xl" /><h2>{{ t('imageStudio.chatWelcome') }}</h2><p>{{ t('imageStudio.chatPending') }}</p></div>
        <div v-else class="creation-message-list">
          <article v-for="message in active.messages" :key="message.id" v-memo="[message.content, message.status, message.phase, message.error, lastAssistantId, busy, credential, locked, locale, message.status === 'streaming' ? now : 0]" class="creation-message" :class="`is-${message.role}`" :data-message-id="message.id">
            <div class="creation-message-meta"><strong>{{ message.role === 'user' ? t('imageStudio.you') : message.role === 'system' ? 'System' : 'AI' }}</strong><span>{{ message.model }}</span><span v-if="message.keyId">Key #{{ message.keyId }}</span></div>
            <ChatMarkdown v-if="message.role === 'assistant'" :content="message.content" :streaming="message.status === 'streaming'" />
            <div v-else class="creation-user-text">{{ message.content }}</div>
            <p v-if="message.status === 'streaming'" class="creation-stream-status" role="status">{{ t(`imageStudio.chatPhases.${message.phase || 'waiting'}`) }}<span v-if="!message.content && now - message.createdAt >= 15000"> · {{ t('imageStudio.slowFirstText') }}</span><span class="creation-cursor">▍</span></p>
            <p v-if="message.status === 'interrupted' || message.status === 'error'" class="creation-message-error" role="status">{{ t(`imageStudio.${message.status}`) }} · {{ errorText(message.error || 'network') }}</p>
            <div v-if="message.role === 'assistant' && message.status !== 'streaming'" class="creation-message-actions"><button v-if="message.content" type="button" @click="copyMessage(message.content)">{{ t('imageStudio.copyMessage') }}</button><button v-if="message.id === lastAssistantId" type="button" :disabled="busy || !credential || locked" @click="generateAgain">↻ {{ t('imageStudio.regenerate') }}</button></div>
          </article>
        </div>
      </div>
      <div class="creation-composer">
        <p>{{ busy ? t('imageStudio.requestFrozen') : t('imageStudio.keyTip') }}</p>
        <textarea v-model="draft" :aria-label="t('imageStudio.message')" :placeholder="t('imageStudio.messagePlaceholder')" :disabled="loading || locked" @keydown="onKeydown" />
        <div class="creation-compose-actions"><span class="creation-compose-hint">{{ t('imageStudio.enterHint') }}</span><button v-if="busy" class="creation-stop" type="button" @click="stop">■ {{ t('imageStudio.stopGeneration') }}</button><button v-else type="button" :disabled="!canSend" @click="submit">{{ t('imageStudio.send') }} ↗</button></div>
        <span v-if="copyState" role="status" class="creation-copy-status">{{ copyState }}</span>
      </div>
    </div>
    <div v-if="editId || deleteId" class="creation-dialog-backdrop" @keydown.esc="editId = ''; deleteId = ''">
      <section role="dialog" aria-modal="true" :aria-label="t(editId ? 'imageStudio.renameChat' : 'imageStudio.deleteChat')" class="creation-chat-dialog">
        <template v-if="editId"><label for="chat-title">{{ t('imageStudio.renameChat') }}</label><input id="chat-title" v-model="editTitle" maxlength="100" @keydown.enter="saveTitle" /></template>
        <p v-else>{{ t('imageStudio.deleteConfirm') }}</p>
        <div><button type="button" @click="editId = ''; deleteId = ''">{{ t('imageStudio.cancel') }}</button><button type="button" :disabled="!!editId && !editTitle.trim()" @click="editId ? saveTitle() : confirmDelete()">{{ t('imageStudio.confirm') }}</button></div>
      </section>
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '@/components/icons/Icon.vue'
import ChatMarkdown from './ChatMarkdown.vue'
import { useCreationChat } from '@/composables/useCreationChat'
import type { CreationCredential } from '@/composables/useCreationSelection'
import { chatCapability } from '@/lib/creation-chat-config'
import type { ChatPreference } from '@/lib/creation-chat'

const props = defineProps<{
  /** @description Stage A 已验证的内存凭证，不可保存或记录。 */
  credential: CreationCredential | null
  /** @description 会话失效时阻止发送并清空当前用户视图。 */
  locked: boolean
  /** @description Stage A 仍在发现本人 Key。 */
  loadingKeys: boolean
  /** @description 当前 UI 的非敏感偏好。 */
  selection: ChatPreference
}>()
const emit = defineEmits<{
  /** @description 切换或恢复本地会话时请求 Stage A 重新验证选择。 */
  restoreSelection: [selection: ChatPreference]
}>()
const { t, locale } = useI18n()
const { conversations, active, activeId, draft, loading, storageError, actionError, busy, select, create, remove, rename, preference, send, stop } = useCreationChat(toRef(props, 'credential'), toRef(props, 'locked'))
const keyboardInset = ref(0)
function fitKeyboard() {
  // 部分手机键盘只压缩 VisualViewport；给当前工作区预留被遮挡高度。
  const viewport = window.visualViewport
  keyboardInset.value = viewport && window.innerWidth <= 800 ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0
}
onMounted(() => { window.visualViewport?.addEventListener('resize', fitKeyboard); window.visualViewport?.addEventListener('scroll', fitKeyboard); fitKeyboard() })
onBeforeUnmount(() => { window.visualViewport?.removeEventListener('resize', fitKeyboard); window.visualViewport?.removeEventListener('scroll', fitKeyboard) })
const now = ref(Date.now())
let statusTimer: ReturnType<typeof setInterval> | undefined
watch(busy, value => {
  clearInterval(statusTimer)
  now.value = Date.now()
  if (value) statusTimer = setInterval(() => { now.value = Date.now() }, 1000)
})
onBeforeUnmount(() => clearInterval(statusTimer))
const protocolNotice = computed(() => {
  const config = props.credential
  if (!config) return ''
  try {
    return chatCapability(config.model, config.userId, config.keyId).source === 'compatibility' ? t('imageStudio.protocolUnverified') : ''
  } catch { return t('imageStudio.chatErrors.configuration') }
})
const historyOpen = ref(false), editId = ref(''), editTitle = ref(''), deleteId = ref(''), copyState = ref('')
const messagesElement = ref<HTMLElement>()
const atBottom = ref(true)
let pendingRestore: ChatPreference | undefined
const canSend = computed(() => !!draft.value.trim() && !busy.value && !loading.value && !props.locked && !!props.credential)
const lastAssistantId = computed(() => { const messages = active.value?.messages.filter(m => m.role === 'assistant') || []; return messages[messages.length - 1]?.id })
const errorText = (code: string) => t(`imageStudio.chatErrors.${code}`)
function restorePreference() {
  if (pendingRestore && !props.loadingKeys) { const value = pendingRestore; pendingRestore = undefined; emit('restoreSelection', { ...value }) }
}
watch(activeId, () => {
  atBottom.value = true
  // 换会话或换号时一并销毁旧会话的弹窗草稿，避免残留另一用户的标题。
  editId.value = ''; editTitle.value = ''; deleteId.value = ''; copyState.value = ''; historyOpen.value = false
  pendingRestore = active.value?.preference ? { ...active.value.preference } : undefined
  restorePreference()
})
watch(() => props.loadingKeys, restorePreference)
watch(() => [props.selection, props.credential] as const, ([value]) => {
  // 只保存验证完成且与 UI 一致的偏好；异步切换期间不覆盖会话原配置。
  if (!pendingRestore && props.credential?.model === value.model && (value.key === 'auto' || props.credential.keyId === value.key)) preference(value)
}, { deep: true })
function newChat() { create(); historyOpen.value = false }
function switchChat(id: string) { select(id); historyOpen.value = false }
function submit() { atBottom.value = true; void send(false, props.selection) }
function generateAgain() { atBottom.value = true; void send(true, props.selection) }
function onKeydown(event: KeyboardEvent) { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); if (canSend.value) submit() } }
async function saveTitle() { if (editTitle.value.trim()) { await rename(editId.value, editTitle.value); editId.value = '' } }
function confirmDelete() { void remove(deleteId.value); deleteId.value = '' }
function trackScroll() { const el = messagesElement.value; if (el) atBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 100 }
watch(() => { const messages = active.value?.messages || []; return [activeId.value, messages.length, messages[messages.length - 1]?.content] }, async () => { if (atBottom.value) { await nextTick(); messagesElement.value?.scrollTo({ top: messagesElement.value.scrollHeight }) } })
async function copyMessage(content: string) { try { await navigator.clipboard.writeText(content); copyState.value = t('imageStudio.copied') } catch { copyState.value = t('imageStudio.copyFailed') } }
</script>
<style src="@/styles/creation-chat.css"></style>
