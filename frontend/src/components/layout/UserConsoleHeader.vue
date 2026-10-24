<template>
  <header class="uc-header">
    <nav class="uc-nav" :aria-label="t('userConsole.navigation')">
      <RouterLink
        v-for="item in items" :key="item.path" :to="item.path"
        class="uc-nav-link" :class="{ 'uc-active': activePath === item.path }"
        :aria-current="activePath === item.path ? 'page' : undefined"
        :data-tour="item.path === '/keys' ? 'sidebar-my-keys' : undefined"
      >{{ t(item.label) }}</RouterLink>
    </nav>

    <div v-if="user" ref="actionsRef" class="uc-actions" @keydown.esc="closePopovers(true)">
      <!-- 公告数据、未读数、详情与已读操作均复用正式组件。Teleport 不继承用户端样式。 -->
      <div class="uc-announcements"><AnnouncementBell /></div>
      <div class="uc-popover-anchor">
        <button
          ref="balanceButton" class="uc-balance" type="button"
          :aria-label="t('common.balance')" :aria-expanded="balanceOpen" aria-controls="uc-balance-details"
          @click="balanceOpen = !balanceOpen; accountOpen = false"
        ><Icon name="creditCard" size="sm" /><span>{{ money(availableBalance) }}</span></button>
        <div v-if="balanceOpen" id="uc-balance-details" class="uc-popover uc-balance-details">
          <p>{{ t('common.availableBalance') }} <strong>{{ money(availableBalance) }}</strong></p>
          <p>{{ t('common.frozenBalance') }} <strong>{{ money(frozenBalance) }}</strong></p>
          <p>{{ t('common.totalBalance') }} <strong>{{ money(availableBalance + frozenBalance) }}</strong></p>
        </div>
      </div>
      <div class="uc-popover-anchor">
        <button
          ref="accountButton" class="uc-account" type="button"
          :aria-label="t('common.userMenu')" :aria-expanded="accountOpen" aria-controls="uc-account-menu"
          @click="accountOpen = !accountOpen; balanceOpen = false"
        >
          <span class="uc-avatar"><img v-if="avatarUrl" :src="avatarUrl" :alt="displayName" /><span v-else>{{ initials }}</span></span>
          <span class="uc-account-text"><span>{{ displayName }}</span><small>{{ t('admin.users.roles.' + user.role) }}</small></span>
          <Icon name="chevronDown" size="sm" />
        </button>
        <div v-if="accountOpen" id="uc-account-menu" class="uc-popover uc-account-menu">
          <div class="uc-identity"><strong>{{ displayName }}</strong><small>{{ user.email }}</small></div>
          <RouterLink to="/profile" @click="closePopovers()">{{ t('nav.profile') }}</RouterLink>
          <RouterLink v-if="walletVisible" to="/redeem" @click="closePopovers()">{{ t('userConsole.wallet') }}</RouterLink>
          <RouterLink v-if="authStore.isAdmin" to="/admin/dashboard" @click="closePopovers()">{{ t('userConsole.adminConsole') }}</RouterLink>
          <div v-if="appStore.contactInfo" class="uc-support">{{ t('common.contactSupport') }}: {{ appStore.contactInfo }}</div>
          <button type="button" class="uc-logout" @click="logout">{{ t('nav.logout') }}</button>
        </div>
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { useAppStore } from '@/stores/app'
import { FeatureFlags, isFeatureFlagEnabled } from '@/utils/featureFlags'
import AnnouncementBell from '@/components/common/AnnouncementBell.vue'
import Icon from '@/components/icons/Icon.vue'
import { userConsoleActivePath, userConsoleNavigation } from './userConsoleNavigation'
import { money as analyticsMoney } from '@/components/user/analytics/analytics'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const appStore = useAppStore()
const user = computed(() => authStore.user)
const items = computed(() => userConsoleNavigation({
  authenticated: authStore.isAuthenticated,
  admin: authStore.isAdmin,
  simple: authStore.isSimpleMode,
  backend: appStore.backendModeEnabled,
  monitor: isFeatureFlagEnabled(FeatureFlags.channelMonitor),
}))
const activePath = computed(() => userConsoleActivePath(route.path))
const walletVisible = computed(() => items.value.some(item => item.path === '/redeem'))
const availableBalance = computed(() => Number(user.value?.balance || 0))
const frozenBalance = computed(() => Number(user.value?.frozen_balance || 0))
const displayName = computed(() => user.value?.username || user.value?.email?.split('@')[0] || '')
const initials = computed(() => displayName.value.substring(0, 2).toUpperCase())
const avatarUrl = computed(() => user.value?.avatar_url?.trim() || '')
const accountOpen = ref(false)
const balanceOpen = ref(false)
const actionsRef = ref<HTMLElement | null>(null)
const accountButton = ref<HTMLButtonElement | null>(null)
const balanceButton = ref<HTMLButtonElement | null>(null)

function money(value: number) {
  return analyticsMoney(value, 2)
}

function closePopovers(restoreFocus = false) {
  if (restoreFocus) (accountOpen.value ? accountButton.value : balanceButton.value)?.focus()
  accountOpen.value = false
  balanceOpen.value = false
}

function onOutside(event: Event) {
  if (!actionsRef.value?.contains(event.target as Node)) closePopovers()
}

// 沿用现有退出契约：即使请求失败，也由认证 store 清理会话并返回登录页。
async function logout() {
  closePopovers()
  try {
    await authStore.logout()
  } catch (error) {
    console.error('Logout error:', error)
  }
  await router.push('/login')
}

watch(() => route.fullPath, () => closePopovers())
onMounted(() => {
  document.addEventListener('click', onOutside)
  document.addEventListener('focusin', onOutside)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onOutside)
  document.removeEventListener('focusin', onOutside)
})
</script>
