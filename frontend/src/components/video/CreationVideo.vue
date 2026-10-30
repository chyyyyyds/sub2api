<template>
  <div class="video-studio">
    <aside class="video-history">
      <div class="video-heading"><h2>生成记录</h2><span>{{ tasks.length }}</span></div>
      <button class="video-secondary video-new" type="button" @click="newProject"><Icon name="plus" size="sm" />新建创作</button>
      <div class="video-history-filter"><select v-model="filter" aria-label="筛选生成记录"><option>全部</option><option>处理中</option><option>已完成</option><option>失败</option></select><button type="button" :disabled="refreshing" aria-label="刷新生成记录" @click="refresh"><Icon name="refresh" size="sm" /></button></div>
      <p v-if="!visible.length" class="video-empty-history">还没有生成记录<br><small>写下想法，开始第一条视频</small></p>
      <button v-for="task in visible" :key="task.id" class="video-history-item" :class="{ selected: selectedId === task.id }" type="button" @click="selectedId = task.id">
        <span class="video-task-status" :class="task.status.toLowerCase()">{{ videoStatus(task.status) }}</span>
        <strong>1080P · {{ task.duration }} 秒</strong><small>{{ formatTime(task.created_at) }}</small><small>{{ task.api_key_name || `Key #${task.api_key_id}` }}</small>
      </button>
      <button v-if="nextCursor" class="video-secondary" type="button" :disabled="loadingMore" @click="loadMore">加载更多</button>
      <p class="video-poll-hint">处理中每 60 秒自动更新<br>离开页面后任务仍会继续</p>
    </aside>
    <section class="video-compose" aria-label="视频生成参数">
      <div class="video-heading"><h2>创作视频</h2><span>1080P</span></div>
      <fieldset :disabled="submitting || !!pending?.input || locked">
        <label class="video-label" for="video-prompt">画面描述 <small>{{ prompt.length }}{{ model?.max_prompt_length ? ` / ${model.max_prompt_length}` : '' }}</small></label>
        <textarea id="video-prompt" v-model="prompt" :maxlength="model?.max_prompt_length || undefined" placeholder="描述人物、场景、动作和镜头运动。可用 @图片1、@图片2 指定参考素材。" />
        <VideoReferenceInput v-model="imageFiles" kind="image" :max="model?.reference_images.max || 0" :formats="model?.reference_images.formats || []" @reading="imagesReading = $event" />
        <VideoReferenceInput v-model="audioFiles" kind="audio" :max="model?.reference_audios.max || 0" :formats="model?.reference_audios.formats || []" @reading="audiosReading = $event" />
        <div class="video-label">模型</div><div class="video-fixed"><Icon name="video" size="sm" /><span>{{ credential?.model || 'oo-sd25-1080p' }}</span></div>
        <div class="video-parameter-pair"><div><div class="video-label">清晰度</div><div class="video-fixed">1080P</div></div><div><label class="video-label" for="video-duration">时长</label><select id="video-duration" v-model="duration"><option v-for="n in model?.durations" :key="n" :value="n">{{ n }} 秒</option></select></div></div>
        <div class="video-label">画面比例</div><div class="video-ratios"><button v-for="value in model?.ratios" :key="value" type="button" :aria-pressed="ratio === value" @click="ratio = value"><span class="video-ratio-icon" :style="{ aspectRatio: value.replace(':', '/') }"></span>{{ value }}</button></div>
        <div class="video-label">模式</div><div class="video-fixed">全能参考模式</div>
      </fieldset>
      <div class="video-submit-panel">
      <p v-if="model && !model.creation_enabled" class="video-warning">{{ model.reason }}</p>
      <p v-if="!referencesValid && model" class="video-warning">请检查参考素材数量和必需参考图。</p>
      <p v-if="quote" class="video-price">本次费用 <strong>${{ quote.charge }}</strong><small>成功后结算，失败退回预留金额</small></p>
      <p v-if="quoteError" class="video-warning">{{ quoteError }}</p><p v-if="error" class="video-warning" role="alert">{{ error }}</p>
      <p v-if="pending" class="video-warning">正在确认上次提交，系统会自动查询是否已创建，避免重复生成。</p>
      <button type="button" class="video-generate" :disabled="!canSubmit" @click="submit"><Icon name="sparkles" size="sm" />{{ submitting ? '正在创建任务…' : pending ? '确认上次提交' : '开始生成' }}</button>
      <p class="video-helper">高峰期上游受理可能超过 100 秒。提交后会自动跟进，无需重复点击。</p>
      </div>
    </section>
    <section class="video-result" aria-label="视频生成结果">
      <div class="video-heading"><h2>生成结果</h2><span v-if="selectedTask">{{ videoStatus(selectedTask.status) }}</span></div>
      <div class="video-preview" :style="{ aspectRatio: previewRatio.replace(':', '/') }">
        <video v-if="previewURL" :src="previewURL" controls playsinline preload="metadata" @error="previewError = '浏览器暂时无法播放此编码，请下载原视频查看。'"></video>
        <div v-else class="video-preview-empty"><Icon :name="selectedTask && !terminal(selectedTask) ? 'refresh' : 'video'" size="xl" /><h3>{{ previewTitle }}</h3><p>{{ previewDescription }}</p><button v-if="selectedTask?.status === 'COMPLETED'" class="video-secondary" type="button" :disabled="previewLoading || !sameKey" @click="loadPreview">{{ previewLoading ? '正在载入视频…' : '载入预览' }}</button></div>
      </div>
      <p v-if="previewError" class="video-warning" role="alert">{{ previewError }}</p>
      <template v-if="selectedTask">
        <div class="video-result-meta"><span>{{ selectedTask.model }}</span><span>{{ selectedTask.duration }} 秒 · {{ selectedTask.resolution }}</span><span>{{ videoBilling(selectedTask.billing_state, selectedTask.status) }} · ${{ selectedTask.charge }}</span></div>
        <p v-if="!sameKey" class="video-warning">请在顶部切换到 {{ selectedTask.api_key_name || `Key #${selectedTask.api_key_id}` }} 后预览或下载。</p>
        <button v-if="selectedTask.status === 'COMPLETED'" class="video-secondary" type="button" :disabled="!sameKey || downloading || selectedTask.download_state === 'EXPIRED'" @click="download(selectedTask)"><Icon name="download" size="sm" />{{ downloading ? '正在下载…' : '下载原视频' }}</button>
        <details class="video-task-detail"><summary>任务详情</summary><p>编号：{{ selectedTask.id }}</p><p>创建：{{ formatTime(selectedTask.created_at) }}</p><p>更新：{{ formatTime(selectedTask.updated_at) }}</p><p v-if="selectedTask.error_code">{{ videoError(selectedTask.error_code) }}</p></details>
        <p class="video-helper">成片由上游临时保存，请在生成完成后及时下载。</p>
      </template>
    </section>
  </div>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import axios from 'axios'
import Icon from '@/components/icons/Icon.vue'
import type { CreationCredential } from '@/composables/useCreationSelection'
import VideoReferenceInput, { type VideoReference } from './VideoReferenceInput.vue'
import { videoAPI, videoStatus, videoBilling, videoError, type VideoModel, type VideoTask, type VideoInput, type VideoQuote } from '@/lib/creation-video'
const props = defineProps<{ credential: CreationCredential | null; locked: boolean; userId?: number | null }>()
const models = ref<VideoModel[]>([]), tasks = ref<VideoTask[]>([])
const prompt = ref(''), imageFiles = ref<VideoReference[]>([]), audioFiles = ref<VideoReference[]>([])
const imagesReading = ref(false), audiosReading = ref(false)
const duration = ref(30), ratio = ref('16:9'), error = ref(''), filter = ref('全部'), submitting = ref(false), refreshing = ref(false)
const quote = ref<VideoQuote | null>(null), quoteError = ref(''), selectedId = ref('')
const previewURL = ref(''), previewLoading = ref(false), previewError = ref(''), downloading = ref(false), previewRatio = ref('16:9')
const pending = ref<{ id: string; input?: VideoInput; hash: string; owner: number; key: number } | null>(null)
const nextCursor = ref(''), loadingMore = ref(false)
let epoch = 0, quoteEpoch = 0, previewEpoch = 0, controller = new AbortController(), refreshInFlight = false
const model = computed(() => models.value.find(m => m.id === props.credential?.model))
const selectedTask = computed(() => tasks.value.find(t => t.id === selectedId.value))
const sameKey = computed(() => !!props.credential && props.credential.keyId === selectedTask.value?.api_key_id)
const terminal = (task: VideoTask) => ['COMPLETED', 'FAILED'].includes(task.status)
const visible = computed(() => tasks.value.filter(t => filter.value === '全部' || (filter.value === '处理中' ? !terminal(t) : filter.value === '已完成' ? t.status === 'COMPLETED' : t.status === 'FAILED')))
const referencesValid = computed(() => !!model.value && (!model.value.requires_image || imageFiles.value.length > 0) && imageFiles.value.length <= model.value.reference_images.max && audioFiles.value.length <= model.value.reference_audios.max && (!imageFiles.value.length || model.value.reference_images.supported) && (!audioFiles.value.length || model.value.reference_audios.supported))
const canSubmit = computed(() => !!props.credential && !props.locked && !submitting.value && !imagesReading.value && !audiosReading.value && (!!pending.value?.input || !!model.value?.creation_enabled && !!prompt.value.trim() && !!quote.value && referencesValid.value && (!model.value.max_prompt_length || prompt.value.length <= model.value.max_prompt_length)))
const previewTitle = computed(() => !selectedTask.value ? '让想法开始流动' : selectedTask.value.status === 'COMPLETED' ? '视频已生成' : selectedTask.value.status === 'FAILED' ? '这次生成未完成' : '视频正在制作中')
const previewDescription = computed(() => !selectedTask.value ? '添加参考素材，描述画面，在这里迎接你的第一条视频。' : selectedTask.value.status === 'FAILED' ? '预留费用会自动退回，可调整描述后重新创作。' : selectedTask.value.status === 'COMPLETED' ? '载入预览或下载完整的 1080P 原视频。' : '上游受理和生成可能较慢，我们会每分钟自动更新进度。')
function formatTime(value: string) { return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) }
function pendingKey(c: CreationCredential) { return `koko-video-pending:${c.userId}:${c.keyId}` }
function clearPreview() { previewEpoch++; if (previewURL.value) URL.revokeObjectURL(previewURL.value); previewURL.value = ''; previewError.value = ''; previewLoading.value = false }
function newProject() { if (submitting.value || pending.value) return; selectedId.value = ''; prompt.value = ''; imageFiles.value = []; audioFiles.value = []; error.value = ''; clearPreview() }
watch(model, m => { if (!m?.durations.includes(duration.value)) duration.value = m?.durations[0] || 30; if (!m?.ratios.includes(ratio.value)) ratio.value = m?.ratios.includes('16:9') ? '16:9' : m?.ratios[0] || '16:9' })
watch(() => [props.credential, model.value, duration.value, props.locked], async () => {
  const request = ++quoteEpoch, c = props.credential; quote.value = null; quoteError.value = ''
  if (!c || !model.value?.creation_enabled || props.locked) return
  try { const price = await videoAPI.quote(c, { model: c.model, duration: duration.value, resolution: '1080p', mode: 'reference' }, controller.signal); if (request === quoteEpoch) quote.value = price } catch { if (request === quoteEpoch) quoteError.value = '费用暂时读取失败，请刷新重试。' }
}, { immediate: true })
watch(() => [props.userId, props.credential?.userId, props.credential?.keyId, props.credential?.model, props.locked], async () => {
  const current = ++epoch; controller.abort(); controller = new AbortController(); models.value = []; tasks.value = []; selectedId.value = ''; nextCursor.value = ''; pending.value = null; clearPreview()
  const c = props.credential
  if (c) { try { const saved = JSON.parse(localStorage.getItem(pendingKey(c)) || 'null'); if (saved?.owner === c.userId && saved?.key === c.keyId && typeof saved.id === 'string' && typeof saved.hash === 'string') pending.value = saved } catch { /* 只恢复任务标识，不持久保存素材和凭证。 */ } }
  if (c && !props.locked) { try { const catalog = await videoAPI.models(c, controller.signal); if (current === epoch) models.value = catalog } catch { if (current === epoch) error.value = '无法读取视频模型参数，请刷新页面。' } }
  if (current === epoch) await refresh()
}, { immediate: true })
async function refresh() {
  const c = props.credential, owner = props.userId ?? c?.userId, current = epoch
  if (!owner || props.locked || refreshInFlight) return
  refreshInFlight = true; refreshing.value = true
  try {
    const first = await videoAPI.history(controller.signal)
    if (current !== epoch) return
    tasks.value = [...first.data, ...tasks.value.filter(old => !first.data.some(t => t.id === old.id))]; nextCursor.value = first.next_cursor || ''; error.value = ''
    if (c && pending.value) { const recovered = await videoAPI.recover(c, pending.value.id, controller.signal); if (current !== epoch) return; if (recovered) { selectedId.value = recovered.id; pending.value = null; localStorage.removeItem(pendingKey(c)); if (!tasks.value.some(t => t.id === recovered.id)) tasks.value.unshift(recovered) } }
  } catch { if (current === epoch) error.value = '生成记录读取失败，稍后会自动重试。' } finally { refreshInFlight = false; refreshing.value = false }
}
async function loadMore() { if (!nextCursor.value || loadingMore.value) return; loadingMore.value = true; const current = epoch; try { const next = await videoAPI.history(controller.signal, nextCursor.value); if (current === epoch) { tasks.value.push(...next.data.filter(n => !tasks.value.some(t => t.id === n.id))); nextCursor.value = next.next_cursor || '' } } catch { error.value = '读取更多记录失败，请重试。' } finally { loadingMore.value = false } }
async function submit() {
  const c = props.credential; if (!c || !canSubmit.value) return
  const current = epoch; submitting.value = true; error.value = ''
  try {
    const input: VideoInput = { model: c.model, prompt: prompt.value.trim(), duration: duration.value, ratio: ratio.value, resolution: '1080p', mode: 'reference', image_urls: imageFiles.value.map(f => f.url), audio_urls: audioFiles.value.map(f => f.url), count: 1 }
    if (!pending.value) {
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(input))))).map(n => n.toString(16).padStart(2, '0')).join('')
      if (current !== epoch) return
      pending.value = { id: crypto.randomUUID(), owner: c.userId, key: c.keyId, input, hash }
      const p = pending.value
      localStorage.setItem(pendingKey(c), JSON.stringify({ id: p.id, hash: p.hash, owner: p.owner, key: p.key }))
    }
    // 刷新后必须恢复原参数且摘要相同才能重发同一个幂等请求，避免生成第二条视频。
    if (!pending.value.input) {
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(input))))).map(n => n.toString(16).padStart(2, '0')).join('')
      if (pending.value.hash !== hash) { error.value = '请恢复上次提交的提示词、素材和比例后确认，或等待系统找回任务。'; return }
      pending.value.input = input
    }
    const task = await videoAPI.create(c, pending.value.input, pending.value.id)
    if (current !== epoch) return
    previewRatio.value = ratio.value; pending.value = null; localStorage.removeItem(pendingKey(c)); tasks.value.unshift(task); selectedId.value = task.id; await refresh()
  } catch (e) {
    if (current !== epoch) return
    if (axios.isAxiosError(e) && e.response && e.response.status >= 400 && e.response.status < 500 && e.response.status !== 408 && e.response.status !== 429) { error.value = videoError(e.response.data?.error?.code); pending.value = null; localStorage.removeItem(pendingKey(c)) }
    else error.value = '任务尚在确认中，系统会自动查询。请勿重复创建。'
  } finally { submitting.value = false }
}
async function loadPreview() {
  const c = props.credential, task = selectedTask.value
  if (!c || !task || !sameKey.value || task.status !== 'COMPLETED' || previewLoading.value) return
  clearPreview(); const request = previewEpoch; previewLoading.value = true
  try { const url = await videoAPI.preview(c, task.id, controller.signal); if (request !== previewEpoch) URL.revokeObjectURL(url); else previewURL.value = url } catch { if (request === previewEpoch) previewError.value = '预览暂时不可用，请稍后重试或下载原视频。' } finally { if (request === previewEpoch) previewLoading.value = false }
}
watch([() => selectedId.value, () => selectedTask.value?.status, () => sameKey.value], () => { clearPreview(); if (selectedTask.value?.status === 'COMPLETED' && sameKey.value) void loadPreview() })
async function download(task: VideoTask) { const c = props.credential; if (!c || !sameKey.value || downloading.value) return; downloading.value = true; try { await videoAPI.download(c, task.id) } catch { error.value = '下载暂不可用，请重试原任务。' } finally { downloading.value = false } }
// 只在可见页面有未结束任务时读取本站记录，避免请求叠加和无意义轮询。
const timer = window.setInterval(() => { if (!document.hidden && (pending.value || tasks.value.some(t => !terminal(t)))) void refresh() }, 60000)
onBeforeUnmount(() => { epoch++; controller.abort(); clearPreview(); clearInterval(timer) })
</script>
<style src="@/styles/video-studio.css"></style>
