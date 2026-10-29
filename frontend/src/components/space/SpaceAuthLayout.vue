<template>
  <div class="space-auth">
    <header class="auth-brand">
      <router-link to="/home" aria-label="返回首页"><SpaceBrand :name="siteName" :logo="siteLogo" /></router-link>
      <router-link v-if="modelPlazaEnabled" to="/model-plaza" class="auth-plaza"><Icon name="grid" size="sm" /><span>{{ t('nav.modelPlaza') }}</span></router-link>
    </header>
    <main class="auth-main">
      <div class="auth-heading"><h1>{{ siteName }}</h1><p>{{ locale === 'zh' ? '连接全球 AI，让更多可能成为现实' : 'Connect with AI. Make more possible.' }}</p><span aria-hidden="true"></span></div>
      <section class="auth-panel" aria-label="账号登录">
        <slot />
        <div v-if="$slots.footer" class="auth-panel-footer"><slot name="footer" /></div>
      </section>
    </main>
    <footer class="auth-copyright">© {{ new Date().getFullYear() }} {{ siteName }}</footer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores'
import { sanitizeUrl } from '@/utils/url'
import SpaceBrand from './SpaceBrand.vue'
import Icon from '@/components/icons/Icon.vue'
import { FeatureFlags, resolveFeatureFlag } from '@/utils/featureFlags'

const { t, locale } = useI18n()
const appStore = useAppStore()
const modelPlazaEnabled = computed(() => resolveFeatureFlag(appStore.cachedPublicSettings, FeatureFlags.modelPlaza))
// 复用后台站点配置；尚未配置品牌时展示设计稿中的默认名称。
const siteName = computed(() => {
  const name = appStore.cachedPublicSettings?.site_name || appStore.siteName
  return !name || name === 'Sub2API' ? '天启星' : name
})
const siteLogo = computed(() => sanitizeUrl(appStore.siteLogo || '', { allowRelative: true, allowDataUrl: true }))
onMounted(() => { if (!appStore.publicSettingsLoaded) appStore.fetchPublicSettings() })
</script>

<style scoped>
.space-auth { --auth-accent: #51def4; min-height: 100svh; display: flex; flex-direction: column; position: relative; isolation: isolate; color: #f1f6ff; color-scheme: dark; background: #020c1b; font-family: 'Microsoft YaHei', 'PingFang SC', sans-serif; }
.space-auth::before { content: ''; position: fixed; z-index: -1; inset: 0; background: linear-gradient(180deg, #0006150a, #00102c08 65%, #00081735), url('/site-assets/space/login.webp') center center / cover no-repeat; }
.auth-brand { position: absolute; top: 38px; left: max(40px, calc((100vw - 1360px) / 2)); right: max(40px, calc((100vw - 1360px) / 2)); z-index: 2; display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.auth-brand a { display: inline-flex; min-height: 44px; border-radius: 8px; }
.auth-brand .auth-plaza { align-items: center; gap: 8px; padding: 8px 12px; color: #e4f7ff; font-size: 15px; font-weight: 600; white-space: nowrap; background: #031526a6; }
.auth-plaza:hover { color: var(--auth-accent); background: #123549cc; }
.auth-brand :deep(.space-brand) { font-size: 28px; }
.auth-brand :deep(.space-brand-mark) { height: 44px; width: 44px; }
.auth-main { width: 100%; margin: auto; padding: 125px 24px 48px; }
.auth-heading { text-align: center; margin-bottom: 30px; text-shadow: 0 2px 22px #00102c; }
.auth-heading h1 { font-size: clamp(40px, 4.7vw, 62px); font-weight: 700; letter-spacing: 8px; line-height: 1.25; margin: 0 0 10px; color: #dff0ff; text-shadow: 0 0 25px #38a6ff45; }
.auth-heading p { margin: 0; color: #eef5ff; font-size: 19px; letter-spacing: 4px; line-height: 1.8; }
.auth-heading > span { display: block; width: 95px; height: 1px; margin: 20px auto 0; background: linear-gradient(90deg, transparent, #25dfff, transparent); box-shadow: 0 0 13px #36c5ff; }
.auth-panel { width: 100%; max-width: 452px; margin: 0 auto; padding: 37px 38px 28px; border: 1px solid #b2e1ff; border-top-color: #c4e8ff; border-radius: 23px; background: linear-gradient(155deg, #03101eec 25%, #061324eb 70%, #183357dd); backdrop-filter: blur(22px); box-shadow: inset 0 0 8px #7bc5ffb0, inset 0 -9px 23px #418aff66, 0 0 0 1px #3f94f1, 0 0 30px #107ce52e, 0 18px 60px #0005; }
.auth-panel-footer { display: flex; align-items: center; gap: 14px; margin-top: 27px; font-size: 14px; text-align: center; }
.auth-panel-footer::before, .auth-panel-footer::after { content: ''; height: 1px; flex: 1; background: #b0c7e325; }
.auth-panel-footer :deep(p) { flex-shrink: 0; margin: 0; color: #bac9dc; }
.auth-panel :deep(a) { color: var(--auth-accent); }
.auth-panel :deep(a:hover) { color: #b4f5ff; }
.auth-panel :deep(.input) { min-height: 52px; border: 1px solid #49678799; border-radius: 12px; background: #111e30bd; color: #f4f8ff; box-shadow: inset 0 1px 4px #0002; font-size: 15px; }
.auth-panel :deep(.input::placeholder) { color: #98a6ba; opacity: 1; }
.auth-panel :deep(.input:focus) { border-color: #4adcf6; outline: 2px solid #42ccff33; outline-offset: 1px; }
.auth-panel :deep(.input-error) { border-color: #f88e9c; }
.auth-panel :deep(.btn-primary) { min-height: 54px; border-radius: 16px; border: 1px solid #65ebfb; background: linear-gradient(110deg, #4cdcf3, #40b8f4 52%, #38e7f4); color: #001a29; font-size: 17px; font-weight: 700; box-shadow: 0 0 22px #25b6ff55; }
.auth-panel :deep(.btn-primary:hover:not(:disabled)) { filter: brightness(1.12); }
.auth-panel :deep(.btn-primary:disabled) { opacity: .55; }
.auth-panel :deep(.btn-secondary) { background: #12283cd9; border-color: #426888; color: #e0ecfa; }
.space-auth :deep(a:focus-visible), .space-auth :deep(button:focus-visible) { outline: 2px solid var(--auth-accent); outline-offset: 4px; }
.auth-copyright { text-align: center; padding: 0 20px 18px; color: #c1d3e9a6; font-size: 11px; }
@media (min-height: 950px) and (min-width: 700px) { .auth-main { padding-top: 145px; padding-bottom: 90px; } .auth-heading { margin-bottom: 34px; } .auth-panel { padding: 42px; max-width: 470px; } }
@media (max-width: 600px) { .auth-brand { top: 22px; left: 22px; } .auth-brand :deep(.space-brand) { font-size: 23px; } .auth-brand :deep(.space-brand-mark) { height: 36px; width: 36px; } .auth-main { padding: 110px 20px 40px; } .auth-heading { margin-bottom: 25px; } .auth-heading h1 { font-size: 43px; letter-spacing: 5px; } .auth-heading p { font-size: 13px; letter-spacing: 2px; } .auth-heading > span { margin-top: 15px; } .auth-panel { padding: 29px 24px 26px; border-radius: 20px; } .auth-panel :deep(.input) { font-size: 16px; } .space-auth::before { background-position: 52% center; } .auth-panel-footer { font-size: 13px; gap: 10px; } }
@media (max-height: 650px) and (min-width: 700px) { .auth-main { padding-top: 90px; padding-bottom: 30px; } .auth-heading h1 { font-size: 40px; } .auth-heading p { font-size: 14px; } .auth-heading { margin-bottom: 20px; } }
@media (min-height: 651px) and (max-height: 800px) and (min-width: 700px) { .auth-main { padding-top: 96px; padding-bottom: 25px; } .auth-heading h1 { font-size: 48px; } .auth-heading p { font-size: 16px; } .auth-heading > span { margin-top: 14px; } .auth-heading { margin-bottom: 23px; } .auth-panel { padding: 28px 36px 25px; } }
@media (max-width: 600px) { .auth-brand { right: 22px; gap: 10px; } .auth-brand .auth-plaza { padding: 8px; font-size: 14px; } }
</style>
