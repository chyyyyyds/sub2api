<template>
  <div v-if="streaming && displayed.length > 30000" class="creation-markdown creation-stream-plain">{{ displayed }}</div>
  <div v-else class="creation-markdown" @click="copyCode" v-html="html"></div>
  <span v-if="copyState" class="creation-copy-status" role="status">{{ copyState }}</span>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Marked } from 'marked'
import DOMPurify from 'dompurify'
import hljs from 'highlight.js/lib/core'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import java from 'highlight.js/lib/languages/java'
import python from 'highlight.js/lib/languages/python'
import sql from 'highlight.js/lib/languages/sql'
import json from 'highlight.js/lib/languages/json'
import bash from 'highlight.js/lib/languages/bash'
import xml from 'highlight.js/lib/languages/xml'
import css from 'highlight.js/lib/languages/css'

/** @description 模型返回的 Markdown 纯文本；绝不作为可信 HTML。 */
const props = defineProps<{
  /** @description 待清洗的 Markdown 纯文本。 */
  content: string
  /** @description 生成时节流渲染；长文本先显示纯文本，结束后恢复 Markdown。 */
  streaming?: boolean
}>()
const displayed = ref(props.content)
let renderTimer: ReturnType<typeof setTimeout> | undefined
watch(() => [props.content, props.streaming], () => {
  if (!props.streaming) { clearTimeout(renderTimer); renderTimer = undefined; displayed.value = props.content; return }
  if (!renderTimer) renderTimer = setTimeout(() => { renderTimer = undefined; displayed.value = props.content }, 100)
}, { flush: 'sync' })
onBeforeUnmount(() => clearTimeout(renderTimer))
const { t } = useI18n()
const copyState = ref('')
for (const [name, language] of Object.entries({ javascript, typescript, java, python, sql, json, bash, xml, css })) hljs.registerLanguage(name, language)
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const parser = new Marked({ breaks: true, gfm: true, renderer: {
  // 原始 HTML 直接显示为文本；再用 DOMPurify 作为第二道边界。
  html: token => escape(token.text),
  image: token => escape(token.text),
  code: token => {
    const language = token.lang?.split(/\s/)[0] || 'text'
    const value = token.text.length <= 30000 && hljs.getLanguage(language) ? hljs.highlight(token.text, { language, ignoreIllegals: true }).value : escape(token.text)
    return `<pre><div class="creation-code-header"><span>${escape(language)}</span><button type="button" data-chat-copy="true">${escape(t('imageStudio.copyCode'))}</button></div><code class="hljs">${value}</code></pre>`
  }
} })
const html = computed(() => DOMPurify.sanitize(parser.parse(displayed.value) as string, {
  ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'del', 'blockquote', 'ul', 'ol', 'li', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'pre', 'code', 'div', 'span', 'button', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
  ALLOWED_ATTR: ['href', 'title', 'class', 'type', 'data-chat-copy'], ALLOW_DATA_ATTR: false
}))
async function copyCode(event: MouseEvent) {
  const target = event.target
  if (!(target instanceof Element)) return
  const button = target.closest('button[data-chat-copy]')
  const code = button?.closest('pre')?.querySelector('code')?.textContent
  if (code === undefined || code === null) return
  try { await navigator.clipboard.writeText(code); copyState.value = t('imageStudio.copied') }
  catch { copyState.value = t('imageStudio.copyFailed') }
}
</script>
