<template>
  <div :class="props.embedded ? 'space-y-4' : 'card'">
    <div
      v-if="!props.embedded"
      class="border-b border-gray-100 px-6 py-4 dark:border-dark-700"
    >
      <h2 class="text-lg font-medium text-gray-900 dark:text-white">
        {{ t('profile.changePassword') }}
      </h2>
    </div>
    <div :class="props.embedded ? '' : 'px-6 py-6'">
      <form @submit.prevent="handleChangePassword" class="space-y-4">
        <div v-if="props.embedded">
          <p class="text-sm font-semibold text-gray-900 dark:text-white">
            {{ t('profile.changePassword') }}
          </p>
        </div>
        <div>
          <label for="old_password" class="input-label">
            {{ t('profile.currentPassword') }}
          </label>
          <input
            id="old_password"
            v-model="form.old_password"
            :type="showPasswords ? 'text' : 'password'"
            :disabled="loading"
            required
            autocomplete="current-password"
            class="input"
          />
        </div>

        <div>
          <label for="new_password" class="input-label">
            {{ t('profile.newPassword') }}
          </label>
          <input
            id="new_password"
            v-model="form.new_password"
            :type="showPasswords ? 'text' : 'password'"
            :disabled="loading"
            required
            autocomplete="new-password"
            class="input"
          />
          <p class="input-hint">
            {{ t('profile.passwordHint') }}
          </p>
        </div>

        <div>
          <label for="confirm_password" class="input-label">
            {{ t('profile.confirmNewPassword') }}
          </label>
          <input
            id="confirm_password"
            v-model="form.confirm_password"
            :type="showPasswords ? 'text' : 'password'"
            :disabled="loading"
            required
            autocomplete="new-password"
            class="input"
          />
        </div>

        <label class="up-password-visibility">
          <input v-model="showPasswords" type="checkbox" :disabled="loading">
          {{ t(showPasswords ? 'profileV1.hidePassword' : 'profileV1.showPassword') }}
        </label>
        <div class="flex justify-end pt-4">
          <button type="submit" :disabled="loading" class="btn btn-primary">
            {{ loading ? t('profile.changingPassword') : t('profile.changePasswordButton') }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useProfileLifecycle } from './useProfileLifecycle'
import { onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores/app'
import { userAPI } from '@/api'
import { extractApiErrorMessage } from '@/utils/apiError'

const { t } = useI18n()
const isActive = useProfileLifecycle()
const appStore = useAppStore()
const props = withDefaults(defineProps<{
  embedded?: boolean
}>(), {
  embedded: false,
})

const showPasswords = ref(false)
const loading = ref(false)
const form = ref({
  old_password: '',
  new_password: '',
  confirm_password: ''
})

const handleChangePassword = async () => {
  if (loading.value || !isActive()) return
  if (!form.value.old_password) { appStore.showError(t('auth.passwordRequired')); return }
  if (form.value.new_password !== form.value.confirm_password) {
    appStore.showError(t('profile.passwordsNotMatch'))
    return
  }

  if (form.value.new_password.length < 8) {
    appStore.showError(t('profile.passwordTooShort'))
    return
  }

  loading.value = true
  try {
    await userAPI.changePassword(form.value.old_password, form.value.new_password)
    if (!isActive()) return
    showPasswords.value = false
    form.value = { old_password: '', new_password: '', confirm_password: '' }
    appStore.showSuccess(t('profile.passwordChangeSuccess'))
  } catch (error: unknown) {
    if (!isActive()) return
    appStore.showError(extractApiErrorMessage(error, t('profile.passwordChangeFailed')))
  } finally {
    loading.value = false
  }
}
onBeforeUnmount(() => { form.value = { old_password: '', new_password: '', confirm_password: '' } })
</script>
