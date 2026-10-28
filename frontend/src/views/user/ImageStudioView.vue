<template>
  <AppLayout>
    <section class="creation-studio">
      <div class="creation-workspacebar">
        <nav class="creation-tabs" :aria-label="t('imageStudio.modes')">
          <RouterLink v-for="mode in modes" :key="mode.id" :to="`/ai-creation/${mode.id}`" :aria-current="kind === mode.id ? 'page' : undefined">
            <Icon :name="mode.icon" size="sm" />{{ t(`imageStudio.${mode.id}`) }}
          </RouterLink>
        </nav>
        <RouterLink class="creation-manage" to="/keys">{{ t('imageStudio.keys') }} ↗</RouterLink>
      </div>
      <section class="creation-stage" :class="{ 'is-chat': kind === 'chat' }" :aria-label="t(`imageStudio.${kind}`)">
        <div class="creation-toolbar">
          <div class="creation-tool-left">
            <div class="creation-field creation-model"><label for="studio-model">{{ t(`imageStudio.${kind}Model`) }}</label><Select id="studio-model" v-model="selectedModel" :aria-label="t(`imageStudio.${kind}Model`)" :options="modelOptions" :placeholder="t(kind === 'video' ? 'imageStudio.unverifiedModels' : 'imageStudio.selectModel')" :disabled="loadingKeys || locked || kind === 'video'" :match-trigger-width="kind === 'chat'" dropdown-class="canvas-studio-dropdown creation-model-dropdown" searchable /></div>
            <div class="creation-field creation-key"><label for="studio-key">{{ t('imageStudio.key') }}</label><Select id="studio-key" v-model="selectedKey" :aria-label="t('imageStudio.key')" :options="keyOptions" :placeholder="t('imageStudio.selectKey')" :disabled="loadingKeys || locked" dropdown-class="canvas-studio-dropdown" /></div>
          </div>
          <div class="creation-toolbar-right">
            <span v-if="kind === 'image'" role="status">{{ connected ? t('imageStudio.connected') : (loadingModels || credential ? t('imageStudio.loading') : '') }}</span>
            <span v-else-if="kind === 'video'">{{ t('imageStudio.stageA') }}</span>
            <span v-else role="status">{{ loadingKeys || loadingModels ? t('imageStudio.chatConfigLoading') : t('imageStudio.localOnly') }}</span>
            <button v-if="kind === 'image'" type="button" :disabled="loadingKeys || loadingModels || locked" @click="reconnect">↻ {{ t('imageStudio.reconnect') }}</button>
          </div>
        </div>
        <p v-if="error" class="creation-error" role="alert">{{ error }} <button v-if="!locked" type="button" @click="reload">{{ t('imageStudio.retry') }}</button></p>
        <p v-if="notice" class="creation-notice" role="status">{{ notice }}</p>
        <EmbeddedCanvasStudio v-if="kind === 'image'" ref="canvas" :credential="credential" :locked="locked" :error="error" @connected="connected = $event" />
        <CreationChat v-else-if="kind === 'chat'" :credential="credential" :locked="locked" :loading-keys="loadingKeys" :selection="{ model: selectedModel, key: selectedKey }" @restore-selection="restoreChatSelection" />
        <div v-else class="creation-video-body">
          <aside class="creation-video-create"><div class="creation-pane-title">{{ t('imageStudio.createVideo') }}<small>{{ t('imageStudio.async') }}</small></div><label for="video-prompt">{{ t('imageStudio.videoPrompt') }}</label><textarea id="video-prompt" v-model="videoDraft" :placeholder="t('imageStudio.videoPlaceholder')" /><div class="creation-video-fields"><label v-for="field in videoFields" :key="field">{{ t(`imageStudio.${field}`) }}<select disabled><option>{{ t('imageStudio.waitCapabilities') }}</option></select></label></div><label>{{ t('imageStudio.references') }}</label><div class="creation-upload"><Icon name="photograph" size="lg" /><span>{{ t('imageStudio.referencePending') }}</span></div><div class="creation-warning">{{ t('imageStudio.videoPending') }}</div><button disabled type="button" class="creation-primary">＋ {{ t('imageStudio.createPending') }}</button></aside>
          <section class="creation-video-tasks"><div class="creation-pane-title">{{ t('imageStudio.taskCenter') }}<small>{{ t('imageStudio.stageA') }}</small></div><div class="creation-warning">{{ t('imageStudio.storageWarning') }}</div><div class="creation-stats"><div v-for="stat in ['running', 'downloadable', 'failedExpired']" :key="stat"><span>{{ t(`imageStudio.${stat}`) }}</span><strong>—</strong></div></div><div class="creation-task-controls"><nav :aria-label="t('imageStudio.taskFilters')"><button v-for="filter in taskFilters" :key="filter" type="button" :aria-pressed="taskFilter === filter" @click="taskFilter = filter">{{ t(`imageStudio.${filter}`) }}</button></nav><button disabled type="button">↻ {{ t('imageStudio.refresh') }}</button></div><div class="creation-task-empty"><Icon name="video" size="xl" /><p>{{ t('imageStudio.noTasks') }}</p><span>{{ t('imageStudio.noFakeTasks') }}</span></div></section>
        </div>
      </section>
    </section>
  </AppLayout>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import AppLayout from '@/components/layout/AppLayout.vue'
import EmbeddedCanvasStudio from '@/components/canvas/EmbeddedCanvasStudio.vue'
import Select from '@/components/common/Select.vue'
import Icon from '@/components/icons/Icon.vue'
import CreationChat from '@/components/chat/CreationChat.vue'
import type { ChatPreference } from '@/lib/creation-chat'
import { useCreationSelection, type CreationKind } from '@/composables/useCreationSelection'

const { t } = useI18n()
const route = useRoute()
const kind = computed<CreationKind>(() => route.path.endsWith('/chat') ? 'chat' : route.path.endsWith('/video') ? 'video' : 'image')
// 视频源码和直达路由保留，默认隐藏入口；本轮暂停开发。
const videoEnabled = import.meta.env.VITE_CREATION_VIDEO_ENABLED === 'true'
const modes = ([{ id: 'chat', icon: 'chat' }, { id: 'image', icon: 'photograph' }, { id: 'video', icon: 'video' }] as const).filter(mode => mode.id !== 'video' || videoEnabled)
const { selectedKey, selectedModel, credential, modelOptions, keyOptions, loadingKeys, loadingModels, locked, error, notice, reload } = useCreationSelection(kind)
const canvas = ref<InstanceType<typeof EmbeddedCanvasStudio>>()
const connected = ref(false)
// 视频继续停留在 Stage A，Stage B 只接入原生 Vue 聊天。
const videoDraft = ref('')
const videoFields = ['duration', 'ratio', 'resolution', 'generationMode']
const taskFilters = ['allTasks', 'running', 'completed', 'failedExpired']
const taskFilter = ref('allTasks')
watch(kind, () => { connected.value = false })
function reconnect() { if (credential.value) canvas.value?.restartFrame(); else void reload() }
function restoreChatSelection(value: ChatPreference) { selectedKey.value = value.key; selectedModel.value = value.model }
</script>
<style src="@/styles/creation-studio.css"></style>
