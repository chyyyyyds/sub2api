<template>
  <div class="canvas-body">
    <div class="canvas-frame">
      <iframe v-if="frameOwner && !locked && auth.isAuthenticated && frameOwner === auth.user?.id" :key="frameVersion" ref="frame" src="/canvas/image" :title="t('imageStudio.title')" referrerpolicy="no-referrer" :style="!credential ? { pointerEvents: 'none', opacity: 0.5 } : undefined" @load="frameLoaded = true" />
      <div v-if="!frameLoaded || locked" class="studio-empty" role="status">{{ error || t('imageStudio.loading') }}</div>
    </div>
    <p class="studio-local">{{ t('imageStudio.local') }}</p>
  </div>
</template>
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import type { CreationCredential } from '@/composables/useCreationSelection'
import { CANVAS_READY, CANVAS_CONFIGURED, canvasConfig, parseCanvasMessage } from '@/lib/canvas-host-bridge'

const props = defineProps<{
  /** @description 已经过当前用户所属权和模型权限校验的内存配置。 */
  credential: CreationCredential | null
  /** @description 登录失效时立即移除画布。 */
  locked: boolean
  /** @description 宿主可展示的脱敏错误。 */
  error: string
}>()
const emit = defineEmits<{
  /** @description 握手状态变化，只向父组件报告连接状态。 */
  connected: [value: boolean]
}>()
const { t } = useI18n()
const auth = useAuthStore()
const frame = ref<HTMLIFrameElement>()
const frameVersion = ref(0)
const frameLoaded = ref(false)
const frameOwner = ref<number>()
let sessionId = ''
let frameId = ''

function restartFrame() {
  // iframe 文档加载前由宿主占位，文档加载后继续由画布显示初始化进度。
  frameLoaded.value = false
  emit('connected', false)
  frameId = ''
  sessionId = crypto.randomUUID()
  frameVersion.value++
}
function sendConfig() {
  const credential = props.credential
  if (!credential || !frameId || props.locked || !auth.isAuthenticated || credential.userId !== auth.user?.id) return
  sessionId = crypto.randomUUID()
  frame.value?.contentWindow?.postMessage(canvasConfig(credential.userId, credential.apiKey, credential.keyName,
    credential.models, credential.model, frameId, sessionId, credential.keyId), location.origin)
}
function handleMessage(event: MessageEvent) {
  const credential = props.credential
  if (props.locked || !auth.isAuthenticated || frameOwner.value !== auth.user?.id ||
    event.origin !== location.origin || event.source !== frame.value?.contentWindow) return
  const message = parseCanvasMessage(event.data)
  if (!message) return
  // 源窗口、来源域、实例和会话四重绑定；iframe 独立刷新也必须重新握手。
  if (message.type === CANVAS_READY && frameId !== message.frameId) {
    frameId = message.frameId
    sendConfig()
  }
  if (credential && message.type === CANVAS_CONFIGURED && message.frameId === frameId && message.sessionId === sessionId) emit('connected', true)
}
// 提前加载无凭证画布，与 Key 查询并行；身份变化仍重建文档，握手前不读取用户作品。
watch([() => auth.user?.id, () => auth.isAuthenticated], ([owner, authenticated]) => {
  const nextOwner = authenticated ? owner : undefined
  if (frameOwner.value === nextOwner) return
  frameOwner.value = nextOwner
  restartFrame()
}, { immediate: true, flush: 'sync' })
// 同一用户热更新内存配置，保留项目、提示词和结果；重新鉴权期间暂停旧凭证。
watch(() => props.credential, credential => {
  emit('connected', false)
  if (!credential) {
    frame.value?.contentWindow?.postMessage({ type: 'new-api:canvas-suspend', version: 1, frameId, sessionId }, location.origin)
    return
  }
  if (frameOwner.value !== credential.userId) { frameOwner.value = credential.userId; restartFrame() }
  else sendConfig()
}, { immediate: true, flush: 'sync' })
onMounted(() => window.addEventListener('message', handleMessage))
onBeforeUnmount(() => { emit('connected', false); window.removeEventListener('message', handleMessage) })
defineExpose({ restartFrame })
</script>
<style scoped>
.canvas-body{display:flex;flex:1;flex-direction:column;min-height:0;overflow:hidden}.canvas-frame{position:relative;display:flex;flex:1;min-height:0}.canvas-body iframe{display:block;width:100%;flex:1;min-height:0;border:0;background:#0b121b}.studio-empty{position:absolute;inset:0;display:grid;place-items:center;padding:24px;text-align:center;color:#94a9b8;background:#0b121b;font-size:13px}.studio-local{flex:none;padding:7px 14px;border-top:1px solid #20303e;font-size:11px;color:#8295a7;line-height:1.5}
</style>
