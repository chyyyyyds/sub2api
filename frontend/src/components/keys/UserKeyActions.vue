<template>
  <div class="uk-actions">
    <button type="button" @click.stop="emit('use')"><Icon name="terminal" size="sm" /><small>{{ t('keys.useKey') }}</small></button>
    <button type="button" :disabled="hideCcs" :title="hideCcs ? t('userKeys.ccsHidden') : undefined" @click.stop="emit('ccs')"><Icon name="upload" size="sm" /><small>{{ t('keys.importToCcSwitch') }}</small></button>
    <button type="button" @click.stop="emit('edit')"><Icon name="edit" size="sm" /><small>{{ t('common.edit') }}</small></button>
    <button type="button" class="uk-danger" @click.stop="emit('delete')"><Icon name="trash" size="sm" /><small>{{ t('common.delete') }}</small></button>
  </div>
</template>
<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import Icon from '@/components/icons/Icon.vue'
defineProps<{ hideCcs?: boolean }>()
const emit = defineEmits<{ use: []; ccs: []; edit: []; delete: [] }>()
const { t } = useI18n()
</script>
