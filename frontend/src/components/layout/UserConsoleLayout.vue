<template>
  <div class="user-console">
    <a class="uc-skip" href="#user-console-content">{{ t('userConsole.skipContent') }}</a>
    <UserConsoleHeader />
    <main id="user-console-content" class="uc-workspace" tabindex="-1">
      <div class="uc-content"><slot /></div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import UserConsoleHeader from './UserConsoleHeader.vue'
import '@/styles/user-console.css'

const { t } = useI18n()
</script>
