<template>
  <details ref="picker" class="ua-date-picker" @keydown.esc="close">
    <summary><Icon name="calendar" size="sm" /><span>{{ startDate }} — {{ endDate }}</span><Icon name="chevronDown" size="sm" /></summary>
    <div class="ua-date-popover">
      <div class="ua-date-presets"><button v-for="days in [1, 7, 30]" :key="days" type="button" @click="preset(days)">{{ t(`userAnalytics.days${days}`) }}</button></div>
      <form class="ua-date-form" @submit.prevent="apply()">
        <label>{{ t('dates.startDate') }}<input v-model="start" type="date" required :max="end" /></label>
        <label>{{ t('dates.endDate') }}<input v-model="end" type="date" required :min="start" :max="naturalDayRange(1).end" /></label>
        <button class="ua-button ua-primary" type="submit">{{ t('dates.apply') }}</button>
      </form><small>{{ t('userAnalytics.naturalDays') }} · {{ analyticsTimezone() }}</small>
    </div>
  </details>
</template>
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '@/components/icons/Icon.vue'
import { analyticsTimezone, naturalDayRange } from './analytics'
const props = defineProps<{ startDate: string; endDate: string }>()
const emit = defineEmits<{
  'update:startDate': [value: string]
  'update:endDate': [value: string]
  change: [range: { startDate: string; endDate: string; preset: string | null }]
}>()
const { t } = useI18n()
const picker = ref<HTMLDetailsElement | null>(null)
const start = ref(props.startDate)
const end = ref(props.endDate)
watch(() => [props.startDate, props.endDate], () => { start.value = props.startDate; end.value = props.endDate })
function close() { if (picker.value) { picker.value.open = false; picker.value.querySelector('summary')?.focus() } }
function outside(event: Event) { if (picker.value && !picker.value.contains(event.target as Node)) picker.value.open = false }
function apply(preset: string | null = null) {
  if (!start.value || !end.value || start.value > end.value) return
  emit('update:startDate', start.value); emit('update:endDate', end.value)
  emit('change', { startDate: start.value, endDate: end.value, preset }); close()
}
function preset(days: number) { const range = naturalDayRange(days); start.value = range.start; end.value = range.end; apply(String(days)) }
onMounted(() => document.addEventListener('click', outside))
onBeforeUnmount(() => document.removeEventListener('click', outside))
</script>
