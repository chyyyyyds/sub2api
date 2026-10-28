<template>
  <span class="space-brand">
    <img v-if="logo && name !== '天启星'" :src="logo" alt="" class="space-brand-mark" />
    <svg v-else class="space-brand-mark" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <circle cx="24" cy="24" r="16" stroke="currentColor" stroke-width="2.4" />
      <ellipse cx="24" cy="25" rx="23" ry="9" transform="rotate(-32 24 25)" stroke="currentColor" stroke-width="2.4" />
      <path d="m19 15 14 9-14 9V15Z" fill="currentColor" />
      <path d="M10 11 8 7m29 30 3 4M36 8l4-3" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
    </svg>
    <span>{{ name }}</span>
  </span>
</template>

<script setup lang="ts">
defineProps<{
  /** 中文品牌名称，沿用站点公开配置。 */
  name: string
  /** 已校验的自定义品牌图标地址。 */
  logo?: string
}>()
</script>

<style scoped>
.space-brand { display: inline-flex; align-items: center; gap: 11px; color: #f4f8ff; font-size: 24px; font-weight: 650; letter-spacing: 1px; white-space: nowrap; }
.space-brand-mark { width: 38px; height: 38px; object-fit: contain; color: #47def7; }
@media (max-width: 600px) { .space-brand { font-size: 20px; gap: 8px; } .space-brand-mark { width: 32px; height: 32px; } }
</style>
