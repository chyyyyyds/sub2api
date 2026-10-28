<template>
  <div class="user-console" :class="{ 'uc-creation': isCreation }">
    <a class="uc-skip" href="#user-console-content">{{ t('userConsole.skipContent') }}</a>
    <UserConsoleHeader />
    <main id="user-console-content" class="uc-workspace" tabindex="-1">
      <div class="uc-content"><slot /></div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import UserConsoleHeader from './UserConsoleHeader.vue'
import '@/styles/user-console.css'

const { t } = useI18n()
const route = useRoute()
// 创作工作台占用剩余可视高度；其他用户页保留原滚动方式。
const isCreation = computed(() => route.path.startsWith('/ai-creation/'))
</script>
