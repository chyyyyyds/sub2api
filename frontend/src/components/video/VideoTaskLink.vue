<template>
  <button v-if="id" type="button" class="text-xs text-primary-500 hover:underline" @click="open">视频任务 / 账务</button>
  <BaseDialog :show="show" title="视频任务与财务记录" width="wide" @close="show = false"><p v-if="error" role="alert">{{ error }}</p><div v-else class="space-y-4"><p>{{ id }}</p><template v-if="task"><p>{{ videoStatus(task.status) }} · {{ videoBilling(task.billing_state, task.status) }} · ${{ task.charge }}</p><p>{{ task.model }} · {{ task.duration }} 秒 · {{ task.resolution }}</p><p>原 Key #{{ task.api_key_id }} · {{ new Date(task.created_at).toLocaleString() }}</p></template><template v-if="audit">
      <p>原账号 #{{ audit.account_id }} · 分组 #{{ audit.group_id }} · 渠道 #{{ audit.channel_id }}</p>
      <div class="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
        <p class="font-semibold">资金记录 · {{ videoBilling(audit.financial.state, task?.status || '') }}</p>
        <p class="mt-2">预留 ${{ audit.financial.amount }} · 实际结算 ${{ audit.financial.captured_amount }} · {{ audit.financial.currency }}</p>
        <p>基价 ${{ audit.pricing_snapshot.base_price }} × 分组倍率 {{ audit.pricing_snapshot.group_multiplier }} = ${{ audit.pricing_snapshot.charge }}</p>
        <p v-if="audit.financial.state === 'RELEASED'" class="mt-2 text-green-600 dark:text-green-400">原冻结金额已退回，不写入最终消费记录。</p>
      </div>
      <div class="overflow-x-auto"><table class="w-full text-left text-xs"><thead><tr><th class="py-2">账务操作</th><th>状态</th><th>尝试次数</th><th>应用时间</th></tr></thead><tbody><tr v-for="event in audit.billing_events" :key="event.id" class="border-t border-gray-200 dark:border-gray-700"><td class="py-2">{{ operationName(event.operation) }}</td><td>{{ event.status }}</td><td>{{ event.attempts }}</td><td>{{ event.applied_at ? new Date(event.applied_at).toLocaleString() : '待处理' }}</td></tr></tbody></table></div>
      <details><summary class="cursor-pointer text-xs">查看完整审计证据</summary><pre class="mt-2 overflow-auto whitespace-pre-wrap text-xs">{{ JSON.stringify(audit, null, 2) }}</pre></details>
    </template></div></BaseDialog>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue'
import { apiClient } from '@/api/client'
import BaseDialog from '@/components/common/BaseDialog.vue'
import { useAuthStore } from '@/stores/auth'
import { videoBilling, videoStatus, type VideoTask } from '@/lib/creation-video'
const props = defineProps<{ requestId?: string | null; admin?: boolean }>()
interface VideoAudit {
  account_id: number; group_id: number; channel_id: number
  financial: { state: string; amount: string; captured_amount: string; currency: string }
  pricing_snapshot: { base_price: string; group_multiplier: string; charge: string }
  billing_events: { id: number; operation: string; status: string; attempts: number; applied_at: string | null }[]
}
const show = ref(false), error = ref(''), task = ref<VideoTask | null>(null), audit = ref<VideoAudit | null>(null)
function operationName(operation: string) { return ({ CAPTURE: '成功结算', RELEASE: '失败解冻 / 退款', CACHE_HOLD: '预留缓存同步', CACHE_FINAL: '终态缓存同步' } as Record<string, string>)[operation] || operation }
const id = computed(() => props.requestId?.match(/^video:(?:cap|rel):(vtsk_[a-f0-9]{32})$/)?.[1])
async function open() {
  if (!id.value) return; show.value = true; error.value = ''; audit.value = null; task.value = null
  // 可选 Boolean prop 在 Vue 中默认转换为 false，管理员角色仍需显式判定。
  const admin = props.admin === true || useAuthStore().user?.role === 'admin'
  try { if (admin) audit.value = (await apiClient.get<VideoAudit>(`/admin/video-tasks/${id.value}/audit`)).data; task.value = (await apiClient.get<VideoTask>(`${admin ? '/admin' : '/user'}/video-tasks/${id.value}`)).data } catch { error.value = '任务详情读取失败。' }
}
</script>
