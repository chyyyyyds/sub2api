<template>
  <div class="user-console">
    <a class="uc-skip" href="#user-console-content">{{ t('userConsole.skipContent') }}</a>
    <UserConsoleHeader />
    <main id="user-console-content" class="uc-workspace" tabindex="-1">
      <!-- 两个原有页面只建立导航关系，不接管统计及表格的数据逻辑。 -->
      <nav v-if="isDashboard" class="uc-tabs" :aria-label="t('nav.dashboard')">
        <RouterLink to="/dashboard" :aria-current="route.path === '/dashboard' ? 'page' : undefined">
          {{ t('userConsole.overview') }}
        </RouterLink>
        <RouterLink v-if="!authStore.isSimpleMode" to="/usage" :aria-current="route.path === '/usage' ? 'page' : undefined">
          {{ t('userConsole.requests') }}
        </RouterLink>
      </nav>
      <div class="uc-content"><slot /></div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import UserConsoleHeader from './UserConsoleHeader.vue'
import '@/styles/user-console.css'

const { t } = useI18n()
const route = useRoute()
const authStore = useAuthStore()
const isDashboard = computed(() => ['/dashboard', '/usage'].includes(route.path))
</script>
