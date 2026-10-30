<template>
  <div class="video-reference">
    <div class="video-label"><label :for="`video-${kind}-files`">{{ kind === 'image' ? '参考图片' : '参考音频' }} <small>{{ modelValue.length }} / {{ max }}</small></label><label class="video-upload-button" :for="`video-${kind}-files`"><Icon name="upload" size="sm" />{{ reading ? '读取中…' : '上传' }}<input :id="`video-${kind}-files`" type="file" multiple :accept="accept" :disabled="reading || modelValue.length >= max" @change="selectFiles"></label></div>
    <div v-if="modelValue.length" class="video-media-grid" :class="{ 'is-audio': kind === 'audio' }"><div v-for="(file, index) in modelValue" :key="file.id" class="video-media-item"><img v-if="kind === 'image'" :src="file.url" :alt="`参考图片${index + 1}`"><Icon v-else name="play" size="sm" /><span :title="file.name">{{ kind === 'image' ? `@图片${index + 1}` : file.name }}</span><button type="button" :aria-label="`移除${file.name}`" @click="remove(index)">×</button></div></div>
    <label v-else class="video-dropzone" :for="`video-${kind}-files`"><Icon :name="kind === 'image' ? 'photograph' : 'upload'" size="md" /><span>{{ kind === 'image' ? '添加角色、场景或风格参考' : '添加配音、音乐或节奏参考' }}</span><small>{{ kind === 'image' ? 'JPG / PNG / WebP' : 'MP3 / WAV / M4A / AAC / FLAC' }} · 单个 ≤ 50MB</small></label>
    <details class="video-url-entry"><summary>使用素材链接</summary><div><input v-model="link" type="url" placeholder="https://…" :aria-label="kind === 'image' ? '参考图片链接' : '参考音频链接'" @keydown.enter.prevent="addLink"><button type="button" :disabled="modelValue.length >= max" @click="addLink">添加</button></div></details>
    <p v-if="error" class="video-warning" role="alert">{{ error }}</p>
  </div>
</template>
<script lang="ts">
/** @description 本次创作的素材；仅在内存保存。 */
export interface VideoReference {
  /** @description 素材标识。 */ id: string
  /** @description 文件名或素材链接。 */ name: string
  /** @description HTTPS 或 data URL。 */ url: string
}
</script>
<script setup lang="ts">
import { computed, ref } from 'vue'
import Icon from '@/components/icons/Icon.vue'
const props = defineProps<{ modelValue: VideoReference[]; kind: 'image' | 'audio'; max: number; formats: string[] }>()
const emit = defineEmits<{ 'update:modelValue': [value: VideoReference[]]; reading: [value: boolean] }>()
const link = ref(''), error = ref(''), reading = ref(false)
const imageMimes: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }
const audioMimes: Record<string, string> = { mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac' }
const accept = computed(() => (props.formats.length ? props.formats : Object.keys(props.kind === 'image' ? imageMimes : audioMimes)).map(f => `.${f === 'jpeg' ? 'jpg,.jpeg' : f}`).join(','))
function remove(index: number) { emit('update:modelValue', props.modelValue.filter((_, i) => i !== index)) }
function addLink() { try { const url = new URL(link.value.trim()); if (url.protocol !== 'https:' || url.username || url.password || props.modelValue.length >= props.max) throw new Error(); emit('update:modelValue', [...props.modelValue, { id: crypto.randomUUID(), name: url.pathname.split('/').pop() || '素材链接', url: url.href }]); link.value = ''; error.value = '' } catch { error.value = '请输入可公开访问的 HTTPS 素材链接，并检查数量上限。' } }
async function selectFiles(event: Event) {
  const input = event.target as HTMLInputElement, files = [...(input.files || [])]; error.value = ''
  if (!files.length) return
  if (files.length + props.modelValue.length > props.max) { error.value = `最多可添加 ${props.max} 个素材。`; input.value = ''; return }
  reading.value = true; emit('reading', true)
  try {
    const added: VideoReference[] = []
    for (const file of files) {
      const ext = file.name.split('.').pop()?.toLowerCase() || '', mimes = props.kind === 'image' ? imageMimes : audioMimes
      const allowed = props.formats.length ? props.formats : Object.keys(mimes)
      if (!mimes[ext] || !allowed.some(f => f === ext || (f === 'jpeg' && ext === 'jpg'))) throw new Error(`文件格式不支持：${file.name}`)
      if (file.size > 50 * 1024 * 1024) throw new Error(`单个文件不能超过 50MB：${file.name}`)
      // 顺序读取并规范 MIME，兼容系统无法识别 M4A 等文件类型的情况。
      const url = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).replace(/^data:[^;]*;/, `data:${mimes[ext]};`)); reader.onerror = () => reject(new Error('文件读取失败')); reader.readAsDataURL(file) })
      added.push({ id: crypto.randomUUID(), name: file.name, url })
    }
    emit('update:modelValue', [...props.modelValue, ...added])
  } catch (e) { error.value = e instanceof Error ? e.message : '文件读取失败' } finally { reading.value = false; emit('reading', false); input.value = '' }
}
</script>
