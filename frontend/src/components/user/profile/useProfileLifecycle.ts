import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

/** 组件卸载后忽略迟到结果，避免旧表单回写资料或弹出认证提示。 */
export function useProfileLifecycle() {
  let active = true
  onBeforeUnmount(() => { active = false })
  return () => active
}

/** 本页安全弹窗保留 Escape、Tab 循环和关闭后的焦点恢复。 */
export function useProfileDialog(close: () => void) {
  const panel = ref<HTMLElement | null>(null)
  let previousFocus: HTMLElement | null = null
  watch(panel, async (element) => {
    if (element) {
      previousFocus = document.activeElement as HTMLElement | null
      await nextTick()
      if (panel.value === element) element.focus()
    } else {
      previousFocus?.focus()
    }
  }, { flush: 'post' })
  onBeforeUnmount(() => previousFocus?.focus())
  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    } else if (event.key === 'Tab') {
      const elements = Array.from(panel.value?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]') ?? [])
        .filter(element => element.getClientRects().length > 0)
      const first = elements[0]
      const last = elements[elements.length - 1]
      if (!first) { event.preventDefault(); return }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.value)) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.value)) {
        event.preventDefault()
        first.focus()
      }
    }
  }
  return { panel, onKeydown }
}
