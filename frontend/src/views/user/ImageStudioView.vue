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
            <div v-if="kind !== 'video'" class="creation-field creation-model"><label for="studio-model">{{ t(`imageStudio.${kind}Model`) }}</label><Select id="studio-model" v-model="selectedModel" :aria-label="t(`imageStudio.${kind}Model`)" :options="modelOptions" :placeholder="t('imageStudio.selectModel')" :disabled="loadingKeys || locked" :match-trigger-width="kind === 'chat'" dropdown-class="canvas-studio-dropdown creation-model-dropdown" searchable /></div>
            <div class="creation-field creation-key"><label for="studio-key">{{ t('imageStudio.key') }}</label><Select id="studio-key" v-model="selectedKey" :aria-label="t('imageStudio.key')" :options="keyOptions" :placeholder="t('imageStudio.selectKey')" :disabled="loadingKeys || locked" dropdown-class="canvas-studio-dropdown" /></div>
          </div>
          <div class="creation-toolbar-right">
            <span v-if="kind === 'image'" role="status">{{ connected ? t('imageStudio.connected') : (loadingModels || credential ? t('imageStudio.loading') : '') }}</span>
            <span v-else-if="kind === 'video'">1080P 视频 · 自动跟进生成进度</span>
            <span v-else role="status">{{ loadingKeys || loadingModels ? t('imageStudio.chatConfigLoading') : t('imageStudio.localOnly') }}</span>
            <button v-if="kind === 'image'" type="button" :disabled="loadingKeys || loadingModels || locked" @click="reconnect">↻ {{ t('imageStudio.reconnect') }}</button>
          </div>
        </div>
        <section v-if="noAvailableKeys" class="creation-key-empty" role="status" aria-labelledby="creation-key-empty-title">
          <div class="creation-key-empty-icon"><Icon name="key" size="xl" /></div>
          <div class="creation-key-empty-copy"><h2 id="creation-key-empty-title">{{ t('imageStudio.noKeysTitle') }}</h2><p>{{ kind === 'video' ? '创建视频创作平台的 Key，即可上传素材、生成和下载视频。' : t('imageStudio.createKeyDescription') }}</p></div>
          <div class="creation-key-empty-actions">
            <div class="creation-key-empty-buttons">
              <RouterLink class="creation-key-create" :to="{ path: '/keys', query: { action: 'create', vendor: kind === 'video' ? 'video' : 'openai' } }"><Icon name="plus" size="sm" />{{ t('imageStudio.createKey') }}<Icon name="arrowRight" size="sm" /></RouterLink>
              <button type="button" class="creation-key-refresh" :disabled="loadingKeys || locked" @click="reload"><Icon name="refresh" size="sm" />{{ t('imageStudio.refreshKeys') }}</button>
            </div>
            <p><Icon name="infoCircle" size="sm" />{{ kind === 'video' ? '在密钥管理中选择「视频创作」平台，返回后点击刷新 Key。' : t('imageStudio.createKeyHint') }}</p>
          </div>
        </section>
        <p v-else-if="error" class="creation-error" role="alert">{{ error }} <button v-if="!locked" type="button" @click="reload">{{ t('imageStudio.retry') }}</button></p>
        <p v-if="notice" class="creation-notice" role="status">{{ notice }}</p>
        <EmbeddedCanvasStudio v-if="kind === 'image'" ref="canvas" :credential="credential" :locked="locked" :error="error" @connected="connected = $event" />
        <CreationChat v-else-if="kind === 'chat'" :credential="credential" :locked="locked" :loading-keys="loadingKeys" :selection="{ model: selectedModel, key: selectedKey }" @restore-selection="restoreChatSelection" />
        <CreationVideo v-else :credential="credential" :locked="locked" :user-id="userId" />
      </section>
    </section>
  </AppLayout>
</template>
<script setup lang="ts">
import CreationVideo from '@/components/video/CreationVideo.vue'
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
// 视频创作使用独立平台 Key，入口直接开放。
const videoEnabled = true
const modes = ([{ id: 'chat', icon: 'chat' }, { id: 'image', icon: 'photograph' }, { id: 'video', icon: 'video' }] as const).filter(mode => mode.id !== 'video' || videoEnabled)
const { userId, selectedKey, selectedModel, credential, modelOptions, keyOptions, loadingKeys, loadingModels, locked, error, notice, noAvailableKeys, reload } = useCreationSelection(kind)
// 仅预选编号，实际归属和平台能力仍由用户 Key 接口重新验证。
watch([() => route.query.key_id, kind], ([id, current]) => {
  if (current === 'video' && typeof id === 'string' && /^[1-9]\d*$/.test(id)) selectedKey.value = Number(id)
}, { immediate: true })
const canvas = ref<InstanceType<typeof EmbeddedCanvasStudio>>()
const connected = ref(false)

watch(kind, () => { connected.value = false })
function reconnect() { if (credential.value) canvas.value?.restartFrame(); else void reload() }
function restoreChatSelection(value: ChatPreference) { selectedKey.value = value.key; selectedModel.value = value.model }
</script>
<style src="@/styles/creation-studio.css"></style>
