<template>
  <BaseDialog :show="!!account" title="视频创作 · 上游配置" width="extra-wide" @close="$emit('close')">
    <template v-if="account">
      <div class="space-y-5">
        <p><strong>{{ account.name }}</strong> · 视频创作平台</p>
        <p class="text-sm text-gray-500">参数通过上游接口读取。当前只接入 oo-sd25-1080p，1080P；其他模型保留接入入口。</p>
        <div class="flex flex-wrap gap-3"><button class="btn btn-secondary" :disabled="busy" @click="refresh">刷新上游状态和参数</button><button class="btn btn-primary" :disabled="busy" @click="initialize">关联视频分组与定价</button></div>
        <p v-if="error" role="alert" class="text-red-500">{{ error }}</p>
        <p v-if="status">上游：{{ status.account.status }} · 余额：{{ status.account.balance }} {{ status.account.currency }} · 关联分组：{{ status.group_ids.join('、') || '未关联' }}</p>
        <p v-if="result" class="rounded-lg border p-3">分组 #{{ result.group_id }} · 渠道 #{{ result.channel_id }} · 已接入 {{ result.models.length }} 个模型。<RouterLink to="/admin/groups" class="text-primary-500">管理分组</RouterLink> · <RouterLink to="/admin/channels" class="text-primary-500">编辑售价</RouterLink></p>
        <div v-if="status" class="overflow-x-auto"><table class="w-full text-left text-sm"><thead><tr><th class="p-3">模型</th><th>实时参数</th><th>上游价格</th><th>接入状态</th></tr></thead><tbody><tr v-for="m in status.models" :key="m.id" class="border-t"><td class="p-3"><strong>{{ m.id }}</strong><p class="text-xs text-gray-500">{{ m.maintenance ? '维护中' : m.enabled ? '上游可用' : '上游停用' }}</p></td><td class="py-3">{{ m.durations.join(' / ') }} 秒 · {{ m.resolutions.join(' / ') }}<p>{{ m.ratio.join(' / ') }}</p><p>参考图 {{ m.reference_images.max }} · 参考音频 {{ m.reference_audios.max }}</p><p>提示词 {{ m.max_prompt_length || '不限' }} 字符</p></td><td>{{ Object.entries(m.duration_prices || {}).map(([s,p]) => `${s}秒 ${p}积分`).join('；') }}</td><td><label class="flex items-center gap-2"><input v-model="selected" type="checkbox" :value="m.id" :disabled="!m.integration_supported || busy">{{ m.integration_supported ? '开放创作' : '预留接入，暂未开放' }}</label></td></tr></tbody></table></div>
        <button v-if="status" class="btn btn-primary" :disabled="busy" @click="saveModels">保存开放模型</button>
        <p class="text-sm text-gray-500">新模型需要补充对应协议后才可开放。实时停用或维护中的模型会自动阻止新任务。</p>
      </div>
    </template>
  </BaseDialog>
</template>
<script setup lang="ts">
import { ref, watch } from 'vue'
import BaseDialog from '@/components/common/BaseDialog.vue'
import { apiClient } from '@/api/client'
interface Account { id: number; name: string; status: string; extra?: Record<string, unknown> }
interface Model { id: string; enabled: boolean; maintenance: boolean; durations: number[]; resolutions: string[]; ratio: string[]; reference_images: { max: number }; reference_audios: { max: number }; duration_prices: Record<string, number>; max_prompt_length: number; integration_supported: boolean; studio_enabled: boolean }
interface Snapshot { account: { status: string; balance: string; currency: string }; models: Model[]; group_ids: number[] }
interface Initialized { account_id: number; group_id: number; channel_id: number; models: string[]; creation_enabled: boolean }
const props = defineProps<{ account: Account | null }>()
defineEmits<{ close: [] }>()
const status = ref<Snapshot | null>(null), result = ref<Initialized | null>(null), selected = ref<string[]>([]), busy = ref(false), error = ref('')
let epoch = 0
watch(() => props.account?.id, () => { epoch++; status.value = null; result.value = null; selected.value = []; if (props.account) void refresh() }, { immediate: true })
async function refresh() {
  const a = props.account, current = epoch; if (!a) return; busy.value = true; error.value = ''
  try { const response = await apiClient.post<Snapshot>(`/admin/accounts/${a.id}/koko/refresh`, {}, { timeout: 180000 }); if (current !== epoch) return; status.value = response.data; selected.value = response.data.models.filter(m => m.studio_enabled).map(m => m.id) } catch { if (current === epoch) error.value = '读取上游失败，请检查凭据和网络后重试。' } finally { busy.value = false }
}
async function initialize() { if (!props.account) return; busy.value = true; try { result.value = (await apiClient.post<Initialized>('/admin/koko-video/initialize', { account_id: props.account.id }, { timeout: 180000 })).data; await refresh() } catch { error.value = '关联失败，请检查分组或渠道配置。' } finally { busy.value = false } }
async function saveModels() { const a = props.account; if (!a) return; busy.value = true; try { const extra = { ...a.extra, video_enabled_models: selected.value }; await apiClient.put(`/admin/accounts/${a.id}`, { extra }); a.extra = extra; await refresh() } catch { error.value = '保存失败，请重试。' } finally { busy.value = false } }
</script>
