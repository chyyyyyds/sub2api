<template>
  <AppLayout>
    <div
      data-testid="profile-shell"
      class="up-profile"
    >
      <div v-if="loading" class="up-notice" role="status">{{ t('common.loading') }}</div>
      <div v-else-if="profileFailed || settingsFailed" class="up-notice up-error" role="alert">
        <p>{{ t(profileFailed ? 'profileV1.loadFailed' : 'profileV1.settingsFailed') }}</p>
        <button class="btn btn-secondary" type="button" @click="loadProfile">{{ t('profileV1.retry') }}</button>
      </div>
      <div v-else-if="user" :key="user.id" class="up-content">
        <ProfileInfoCard
          :user="user"
          :linuxdo-enabled="linuxdoOAuthEnabled"
          :dingtalk-enabled="dingtalkOAuthEnabled"
          :oidc-enabled="oidcOAuthEnabled"
          :oidc-provider-name="oidcOAuthProviderName"
          :wechat-enabled="wechatOAuthEnabled"
          :wechat-open-enabled="wechatOAuthOpenEnabled"
          :wechat-mp-enabled="wechatOAuthMPEnabled"
        />

        <div
          v-if="contactInfo"
          class="up-panel up-support"
        >
          <div class="flex items-center gap-4">
            <div class="rounded-xl bg-primary-100 p-3 text-primary-600">
              <Icon name="chat" size="lg" />
            </div>
            <div>
              <h3 class="font-semibold text-primary-800 dark:text-primary-200">
                {{ t('common.contactSupport') }}
              </h3>
              <p class="text-sm font-medium">{{ contactInfo }}</p>
            </div>
          </div>
        </div>

        <div class="up-grid up-security-grid">
          <section class="up-panel up-password">
            <div class="up-heading"><span class="up-section-icon"><Icon name="lock" size="md" /></span><div><h2>{{ t('profile.changePassword') }}</h2><p>{{ t('profileV1.passwordDescription') }}</p></div></div>
            <ProfilePasswordForm embedded />
          </section>
          <section class="up-panel up-security">
            <div class="up-heading"><span class="up-section-icon"><Icon name="shield" size="md" /></span><div><h2>{{ t('profileV1.securityTitle') }}</h2><p>{{ t('profileV1.securityDescription') }}</p></div></div>
            <ProfileTotpCard />
            <ProfilePasskeyCard :enabled="passkeyEnabled" />
          </section>
        </div>

        <ProfileBalanceNotifyCard
          v-if="user && balanceLowNotifyEnabled"
          :enabled="user.balance_notify_enabled ?? true"
          :threshold="user.balance_notify_threshold"
          :extra-emails="user.balance_notify_extra_emails ?? []"
          :system-default-threshold="systemDefaultThreshold"
          :user-email="user.email"
        />

      </div>
    </div>
  </AppLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import '@/styles/user-profile.css'
import { useProfileLifecycle } from '@/components/user/profile/useProfileLifecycle'
import { useI18n } from 'vue-i18n'
import { Icon } from '@/components/icons'
import AppLayout from '@/components/layout/AppLayout.vue'
import ProfileBalanceNotifyCard from '@/components/user/profile/ProfileBalanceNotifyCard.vue'
import ProfileInfoCard from '@/components/user/profile/ProfileInfoCard.vue'
import ProfilePasswordForm from '@/components/user/profile/ProfilePasswordForm.vue'
import ProfileTotpCard from '@/components/user/profile/ProfileTotpCard.vue'
import ProfilePasskeyCard from '@/components/user/profile/ProfilePasskeyCard.vue'
import { isWeChatWebOAuthEnabled } from '@/api/auth'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'

const { t } = useI18n()
const appStore = useAppStore()
const authStore = useAuthStore()
const user = computed(() => authStore.user)

const isActive = useProfileLifecycle()
const loading = ref(true)
const profileFailed = ref(false)
const settingsFailed = ref(false)
const contactInfo = ref('')
const balanceLowNotifyEnabled = ref(false)
const systemDefaultThreshold = ref(0)
const linuxdoOAuthEnabled = ref(false)
const dingtalkOAuthEnabled = ref(false)
const wechatOAuthEnabled = ref(false)
const wechatOAuthOpenEnabled = ref<boolean | undefined>(undefined)
const wechatOAuthMPEnabled = ref<boolean | undefined>(undefined)
const oidcOAuthEnabled = ref(false)
const oidcOAuthProviderName = ref('OIDC')
const passkeyEnabled = ref(false)
let requestInFlight = false

// 首次资料与开关读取完成后才开放表单，避免旧读取覆盖用户刚保存的资料。
async function loadProfile() {
  if (!isActive() || requestInFlight) return
  requestInFlight = true
  loading.value = true
  profileFailed.value = false
  settingsFailed.value = false
  const profileRefresh = authStore.refreshUser().catch(() => { if (isActive()) profileFailed.value = true })

  const settingsLoad = appStore.fetchPublicSettings()
    .then((settings) => {
      if (!isActive()) return
      if (!settings) { settingsFailed.value = true; return }
      contactInfo.value = settings.contact_info || ''
      balanceLowNotifyEnabled.value = settings.balance_low_notify_enabled ?? false
      systemDefaultThreshold.value = settings.balance_low_notify_threshold ?? 0
      linuxdoOAuthEnabled.value = settings.linuxdo_oauth_enabled ?? false
      dingtalkOAuthEnabled.value = settings.dingtalk_oauth_enabled ?? false
      wechatOAuthEnabled.value = isWeChatWebOAuthEnabled(settings)
      wechatOAuthOpenEnabled.value = typeof settings.wechat_oauth_open_enabled === 'boolean'
        ? settings.wechat_oauth_open_enabled
        : undefined
      wechatOAuthMPEnabled.value = typeof settings.wechat_oauth_mp_enabled === 'boolean'
        ? settings.wechat_oauth_mp_enabled
        : undefined
      oidcOAuthEnabled.value = settings.oidc_oauth_enabled ?? false
      oidcOAuthProviderName.value = settings.oidc_oauth_provider_name || 'OIDC'
      passkeyEnabled.value = settings.passkey_enabled === true
    })
    .catch(() => { if (isActive()) settingsFailed.value = true })

  await Promise.all([profileRefresh, settingsLoad])
  requestInFlight = false
  if (isActive()) loading.value = false
}
onMounted(loadProfile)
</script>
