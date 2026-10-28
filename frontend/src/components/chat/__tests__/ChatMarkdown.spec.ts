import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { describe, expect, it, vi } from 'vitest'
import ChatMarkdown from '../ChatMarkdown.vue'
import imageStudio from '@/i18n/locales/zh/imageStudio'
const render = (content: string) => mount(ChatMarkdown, { props: { content }, global: { plugins: [createI18n({ legacy: false, locale: 'zh', messages: { zh: { imageStudio } }, messageCompiler: message => () => typeof message === 'string' ? message : '' })] } })
describe('Markdown 安全渲染', () => {
  it('渲染 Markdown 与语法高亮，代码复制保持原始文本', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const wrapper = render('**标题**\n\n```java\npublic class Demo {}\n```')
    expect(wrapper.find('strong').text()).toBe('标题')
    expect(wrapper.find('.hljs-keyword').text()).toBe('public')
    await wrapper.get('[data-chat-copy]').trigger('click')
    expect(writeText).toHaveBeenCalledWith('public class Demo {}')
  })
  it('原始 HTML、SVG、事件属性、javascript 链接不能执行，远程图片不加载', () => {
    const wrapper = render('<script>alert(1)</script><img src=x onerror=alert(1)>\n\n<svg onload=alert(1)>x</svg>\n\n[x](javascript:alert(1))\n\n![秘密](https://evil.example/track)')
    expect(wrapper.find('script,svg,img,iframe').exists()).toBe(false)
    expect(wrapper.find('[onerror],[onload]').exists()).toBe(false)
    expect(wrapper.html()).not.toContain('href="javascript:')
  })
  it('代码块里的 HTML 作为文本显示', () => {
    const wrapper = render('```html\n<img src=x onerror=alert(1)>\n```')
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.get('code').text()).toBe('<img src=x onerror=alert(1)>')
  })
  it('生成期长文本降级纯文本，结束后恢复 Markdown 且始终清洗 XSS', async () => {
    const wrapper = render('初始')
    await wrapper.setProps({ streaming: true, content: '**标题**\n' + '中'.repeat(31000) + '<img onerror=alert(1)>' })
    await vi.waitFor(() => expect(wrapper.find('.creation-stream-plain').exists()).toBe(true))
    expect(wrapper.find('img').exists()).toBe(false)
    await wrapper.setProps({ streaming: false })
    expect(wrapper.find('strong').text()).toBe('标题')
    expect(wrapper.find('img').exists()).toBe(false)
    wrapper.unmount()
  })
})
