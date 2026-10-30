<template><button type="button" class="text-xs text-primary-500" @click="open">KOKO 视频开关</button><BaseDialog :show="show" title="KOKO 视频创建权限" @close="show = false"><p>分组 #{{ groupId }}。该开关只影响 KOKO 新视频任务，原聊天、图片和其他视频行为不变。</p><label class="my-5 flex gap-3"><input v-model="enabled" type="checkbox">允许本分组创建 KOKO 视频</label><p>总开关、实时能力和渠道正式价格也必须满足。新分组默认关闭；请在渠道管理修改每个视频的美元售价。</p><p v-if="error" role="alert">{{ error }}</p><button class="btn btn-primary mt-4" @click="save">保存开关</button></BaseDialog></template>
<script setup lang="ts">
import { ref } from 'vue'
import BaseDialog from '@/components/common/BaseDialog.vue'
import { apiClient } from '@/api/client'
const props = defineProps<{ groupId: number }>()
const show = ref(false), enabled = ref(false), error = ref('')
async function open() { show.value = true; error.value = ''; try { enabled.value = (await apiClient.get<{ enabled: boolean }>(`/admin/groups/${props.groupId}/koko-video`)).data.enabled } catch { error.value = '开关读取失败' } }
async function save() { try { await apiClient.put(`/admin/groups/${props.groupId}/koko-video`, { enabled: enabled.value }); show.value = false } catch { error.value = '保存失败' } }
</script>
