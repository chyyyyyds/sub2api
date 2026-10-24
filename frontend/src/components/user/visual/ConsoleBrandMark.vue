<template>
  <!-- 仅展示已验收的本地品牌素材；未知厂商沿用原组件，不推断授权范围。 -->
  <img v-if="artwork" :src="artwork" :alt="platform" class="uc-brand" :class="`uc-brand--${size}`" draggable="false" />
  <PlatformIcon v-else :platform="platform" :size="size" />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import PlatformIcon from '@/components/common/PlatformIcon.vue'
import type { GroupPlatform } from '@/types'
import openai from '@/assets/user-console/brands/openai.png'
import anthropic from '@/assets/user-console/brands/anthropic.png'
import claude from '@/assets/user-console/brands/claude.png'
import google from '@/assets/user-console/brands/google.png'
import gemini from '@/assets/user-console/brands/gemini.png'
import deepseek from '@/assets/user-console/brands/deepseek.png'

const props = withDefaults(defineProps<{
  /** 厂商标识，只用于选择图片，不参与业务映射。 */
  platform?: GroupPlatform
  /** 图片展示尺寸。 */
  size?: 'xs' | 'sm' | 'md' | 'lg'
  /** 密钥页使用原型已验收的 Claude、Google 版本。 */
  variant?: 'model' | 'key'
}>(), { size: 'sm', variant: 'model' })

const artwork = computed(() => {
  const images: Partial<Record<GroupPlatform, string>> = {
    openai,
    anthropic: props.variant === 'key' ? claude : anthropic,
    gemini: props.variant === 'key' ? google : gemini,
    deepseek
  }
  return props.platform ? images[props.platform] : undefined
})
</script>

<style scoped>
.uc-brand { display:block; width:23px; height:23px; object-fit:contain; object-position:center; flex-shrink:0; user-select:none; pointer-events:none; }
.uc-brand--xs { width:16px; height:16px; }
.uc-brand--md { width:30px; height:30px; }
.uc-brand--lg { width:38px; height:38px; }
</style>
