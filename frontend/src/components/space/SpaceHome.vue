<template>
  <div class="space-home">
    <a class="skip-link" href="#space-main">跳转到主要内容</a>
    <div class="hero-landscape" aria-hidden="true"></div>
    <header class="space-header">
      <nav class="space-nav" aria-label="首页导航">
        <router-link to="/home" aria-label="返回首页"><SpaceBrand :name="siteName" :logo="siteLogo" /></router-link>
        <div class="nav-actions">
          <router-link v-if="showModelPlazaEntry" to="/model-plaza" class="nav-secondary">模型广场</router-link>
          <router-link :to="startPath" class="space-button nav-start">{{ isAuthenticated ? '进入控制台' : '立即开始' }}<Icon name="arrowRight" /></router-link>
        </div>
      </nav>
    </header>

    <main id="space-main">
      <section class="hero-section space-container" aria-labelledby="hero-title">
        <div class="hero-copy">
          <span class="hero-badge"><Icon name="sparkles" size="sm" />让先进的 AI 触手可及</span>
          <h1 id="hero-title"><span class="hero-brand">{{ siteName }}</span><span class="hero-title">探索更强大的 AI 世界</span></h1>
          <p class="hero-description">汇聚全球领先的 AI 模型与实用工具，<br class="desktop-break" />为每一个人的创意、学习与工作，提供强大的 AI 助力。</p>
          <router-link :to="startPath" class="space-button hero-start">{{ isAuthenticated ? '进入控制台' : '立即开始' }}<Icon name="arrowRight" size="lg" /></router-link>
        </div>

        <div class="model-orbit" aria-label="探索热门 AI 模型">
          <router-link v-for="model in models" :key="model.name" :to="modelPath" class="model-card" :class="model.className">
            <span class="model-icon" :class="model.className">
              <img v-if="model.image" :src="model.image" alt="" width="44" height="44" />
              <Icon v-else name="grid" size="xl" />
            </span>
            <span class="model-info"><strong>{{ model.name }}</strong><span>{{ model.description }}</span></span>
            <Icon class="model-arrow" name="arrowRight" size="sm" />
          </router-link>
        </div>
      </section>

      <section class="space-stats space-container" aria-label="平台概览">
        <div v-for="stat in stats" :key="stat.label" class="stat-item"><strong>{{ stat.value }}</strong><span>{{ stat.label }}</span></div>
      </section>

      <div class="space-content space-container">
        <section class="advantages" aria-labelledby="advantages-title">
          <div class="section-heading"><span class="section-eyebrow">· &nbsp; 核心优势 &nbsp; ·</span><h2 id="advantages-title">顶尖模型，一站式 AI 服务平台</h2><p>强大的模型能力，丰富的工具生态，满足不同场景的需求，让 AI 成为你生活与工作的得力伙伴。</p></div>
          <div class="feature-grid">
            <article v-for="(feature, index) in features" :key="feature.title" class="feature-card" :class="`feature-${index}`">
              <div class="feature-visual" aria-hidden="true"></div>
              <span class="feature-icon"><Icon :name="feature.icon" size="xl" /></span>
              <h3>{{ feature.title }}</h3><p>{{ feature.description }}</p>
            </article>
          </div>
        </section>

        <section class="use-cases" aria-labelledby="use-cases-title">
          <div class="use-cases-heading"><div><h2 id="use-cases-title">丰富的使用场景</h2><p>无论是学习、工作还是创意创作，{{ siteName }}都能为你提供高效、智能的 AI 解决方案。</p></div><router-link :to="startPath" class="explore-link">开启探索 <Icon name="arrowRight" size="sm" /></router-link></div>
          <div class="scene-grid">
            <router-link v-for="(scene, index) in scenes" :key="scene.title" :to="startPath" class="scene-card">
              <img :src="`/site-assets/space/scene-${index + 1}.webp`" alt="" loading="lazy" width="640" height="320" />
              <div class="scene-copy"><h3>{{ scene.title }}</h3><p>{{ scene.description }}</p></div><span class="scene-arrow"><Icon name="arrowRight" /></span>
            </router-link>
          </div>
        </section>
        <footer class="space-footer"><SpaceBrand :name="siteName" :logo="siteLogo" /><span>连接全球 AI，让更多可能成为现实</span><span>© {{ new Date().getFullYear() }} {{ siteName }}</span></footer>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import Icon from '@/components/icons/Icon.vue'
import SpaceBrand from './SpaceBrand.vue'
import openaiLogo from '@/assets/user-console/brands/openai.png'
import claudeLogo from '@/assets/user-console/brands/claude.png'
import deepseekLogo from '@/assets/user-console/brands/deepseek.png'

const props = defineProps<{
  /** 站点公开配置中的品牌名称。 */
  siteName: string
  /** 经过安全校验的站点图标。 */
  siteLogo: string
  /** 当前访客是否已经登录。 */
  isAuthenticated: boolean
  /** 根据用户角色确定的控制台地址。 */
  dashboardPath: string
  /** 是否允许向当前访客展示模型广场入口。 */
  showModelPlazaEntry: boolean
}>()

// 统一复用现有路由及权限配置，所有模型卡片均可键盘访问。
const startPath = computed(() => props.isAuthenticated ? props.dashboardPath : '/login')
const modelPath = computed(() => props.showModelPlazaEntry ? '/model-plaza' : startPath.value)
const models = [
  { name: 'ChatGPT', description: '智能对话 · 创意写作', image: openaiLogo, className: 'model-chatgpt' },
  { name: 'Claude', description: '深度思考 · 专业分析', image: claudeLogo, className: 'model-claude' },
  { name: 'DeepSeek', description: '智能对话 · 推理模型', image: deepseekLogo, className: 'model-deepseek' },
  { name: '更多顶尖模型', description: '一站式体验', image: '', className: 'model-more' }
]
// 设计稿中的展示文案；后续如需实时统计，可在接入统计接口后统一替换。
const stats = [
  { value: '50+', label: '已接入主流 AI 模型' },
  { value: '99.9%', label: '服务稳定可靠' },
  { value: '累计为 500+', label: '企业、个人提供服务' },
  { value: '2000万+', label: 'API 调用 / 日' }
]
const features = [
  { title: '顶尖模型集合', description: '汇聚全球领先的 AI 大模型，一站式体验前沿的智能能力。', icon: 'bolt' },
  { title: '丰富的 AI 工具', description: '写作、图像、代码、办公等多种实用工具，开箱即用。', icon: 'cube' },
  { title: '简单易用', description: '无需复杂配置，轻松上手，让先进的 AI 能力触手可及。', icon: 'clock' },
  { title: '安全可靠', description: '企业级安全保障，数据加密，全方位守护你的隐私与内容。', icon: 'shield' }
] as const
const scenes = [
  { title: '写作创作', description: '激发灵感，生成高质量内容' },
  { title: '学习研究', description: '整理知识，提升学习效率' },
  { title: '办公提效', description: '文档处理、数据分析、智能总结' },
  { title: '图像创作', description: '用想象力，创造精彩的视觉作品' }
]
</script>

<style scoped>
.space-home { --space-cyan: #45e2f5; --space-muted: #b8c9dc; --space-border: rgba(86, 176, 230, .32); min-height: 100vh; position: relative; isolation: isolate; overflow: hidden; background: #020a13; color: #f5f8ff; font-family: 'Microsoft YaHei', 'PingFang SC', sans-serif; }
.space-home a { text-decoration: none; }
.space-home a:focus-visible { outline: 2px solid var(--space-cyan); outline-offset: 5px; }
.skip-link { position: absolute; top: -80px; left: 24px; z-index: 50; background: #031427; padding: 12px 18px; color: white; }
.skip-link:focus { top: 18px; }
.space-container { width: min(1280px, calc(100% - 96px)); margin-inline: auto; }
.hero-landscape { position: absolute; z-index: -1; inset: 0 0 auto; height: 760px; background: linear-gradient(180deg, rgba(1, 8, 18, .12) 0%, transparent 55%, #020a13 99%), url('/site-assets/space/hero.webp') center top / cover no-repeat; }
/* 顶部导航采用通栏布局，以细分隔线与深色背景承接主视觉。 */
.space-header { position: relative; z-index: 2; border-block: 1px solid rgba(100, 173, 216, .2); background: linear-gradient(100deg, rgba(0, 7, 15, .96), rgba(2, 13, 26, .92)); backdrop-filter: blur(16px); }
.space-nav { width: min(1280px, calc(100% - 96px)); min-height: 82px; margin: auto; padding: 12px 8px; display: flex; align-items: center; justify-content: space-between; gap: 20px; }
.space-nav > a { display: inline-flex; align-items: center; min-height: 48px; }
.space-nav :deep(.space-brand) { font-size: 28px; gap: 12px; }
.space-nav :deep(.space-brand-mark) { width: 44px; height: 44px; }
.nav-actions { display: flex; gap: 22px; align-items: center; }
.nav-secondary { display: grid; place-items: center; min-height: 48px; padding: 0 28px; font-size: 14px; font-weight: 600; border: 1px solid rgba(161, 201, 232, .48); border-radius: 8px; color: #e1e9f7; background: rgba(3, 14, 30, .65); box-shadow: inset 0 0 0 1px #b1d8ff0d; transition: border-color .2s, background .2s; }
.nav-secondary:hover { border-color: #7ed8ed; background: #0b2034; }
.space-button { display: inline-flex; justify-content: center; align-items: center; gap: 20px; color: #001422; font-weight: 700; background: linear-gradient(115deg, #61e6fc 0%, #36bbf4 55%, #41e6f7 100%); border: 1px solid #79efff; box-shadow: 0 0 18px #21b4ff50, inset 0 0 10px #a0f5ff77; transition: box-shadow .2s, filter .2s; }
.space-button:hover { filter: brightness(1.12); box-shadow: 0 0 30px #21b4ff77; }
.nav-start { min-height: 48px; padding: 0 25px; gap: 14px; border-radius: 8px; font-size: 14px; }
.hero-section { min-height: 440px; display: grid; grid-template-columns: 1fr 1fr; align-items: center; position: relative; padding: 40px 8px 38px; }
.hero-copy { position: relative; z-index: 1; }
.hero-badge { display: inline-flex; align-items: center; gap: 10px; color: #b3e9ff; padding: 7px 17px; font-size: 13px; border: 1px solid #349ac1; border-radius: 30px; background: #00152899; box-shadow: inset 0 0 12px #28a8ef20; }
.hero-badge svg { color: var(--space-cyan); }
h1 { margin: 20px 0 16px; letter-spacing: 1px; font-weight: 700; }
.hero-brand { display: block; width: fit-content; font-size: clamp(44px, 4.3vw, 64px); line-height: 1.18; color: #dcf1ff; text-shadow: 0 2px 20px #4ac4ff30; }
.hero-title { display: block; margin-top: 8px; font-size: clamp(28px, 3.25vw, 47px); line-height: 1.35; white-space: nowrap; text-shadow: 0 2px 16px #000; }
.hero-description { margin: 0 0 26px; color: #d2dce9; font-size: 17px; line-height: 1.85; letter-spacing: .5px; text-shadow: 0 2px 10px #000; }
.hero-start { min-width: 202px; min-height: 54px; font-size: 18px; border-radius: 20px; }
.model-orbit { position: relative; height: 330px; margin: 0 -8px 0 6px; }
.model-card { position: absolute; display: flex; align-items: center; gap: 15px; width: 240px; min-height: 102px; padding: 16px; border: 1px solid #9cdeff; border-radius: 17px; background: linear-gradient(120deg, #244f7f91, #00172dde 48%, #0755a69c); backdrop-filter: blur(16px); box-shadow: inset 0 0 17px #5bb7ff55, 0 9px 24px #0008, 0 0 12px #2bafff20; transition: box-shadow .2s, background .2s; }
.model-card:hover { box-shadow: inset 0 0 22px #5bb7ff88, 0 0 26px #29b5ff66; background-color: #08417c99; }
.model-icon { width: 62px; height: 62px; flex-shrink: 0; border: 1px solid #47adff30; border-radius: 12px; background: linear-gradient(140deg, #093c5aaf, #001225aa); display: grid; place-items: center; box-shadow: 0 5px 14px #0005; }
.model-icon img { object-fit: contain; }
.model-icon.model-chatgpt img { filter: brightness(0) saturate(100%) invert(85%) sepia(66%) saturate(1839%) hue-rotate(126deg); }
.model-icon.model-deepseek img { filter: brightness(0) saturate(100%) invert(57%) sepia(99%) saturate(2147%) hue-rotate(186deg); }
.model-icon.model-more { color: #d7f5ff; }
.model-info { min-width: 0; display: flex; flex-direction: column; gap: 8px; color: #f6f8ff; }
.model-info strong { font-size: 17px; font-weight: 600; white-space: nowrap; }
.model-info > span { color: #c7def7; font-size: 12px; white-space: nowrap; }
.model-arrow { display: none; }
.model-orbit > .model-chatgpt { top: 25px; left: 5px; transform: rotate(-7deg); }
.model-orbit > .model-claude { top: 54px; right: 4px; transform: rotate(-3deg); }
.model-orbit > .model-deepseek { bottom: 45px; left: 42px; transform: rotate(-7deg); }
.model-orbit > .model-more { bottom: 24px; right: -12px; transform: rotate(1deg); }
.space-stats { min-height: 94px; display: grid; grid-template-columns: repeat(4, 1fr); align-items: center; padding: 16px 70px; border-block: 1px solid #65baf12b; background: linear-gradient(90deg, transparent, #01132466 20%, #01132466 80%, transparent); }
.stat-item { display: flex; position: relative; align-items: center; flex-direction: column; gap: 5px; padding: 0 12px; }
.stat-item + .stat-item::before { content: ''; position: absolute; height: 34px; top: 12px; left: 0; width: 1px; background: linear-gradient(transparent, #42d0ff77, transparent); }
.stat-item strong { color: #39e7f4; font-size: 26px; font-weight: 600; line-height: 1.2; white-space: nowrap; }
.stat-item:nth-child(3) strong { font-size: 23px; }
.stat-item span { color: #c7d2e0; font-size: 14px; }
.space-content { position: relative; padding-top: 30px; }
.section-heading { text-align: center; margin-bottom: 20px; }
.section-eyebrow { font-size: 13px; color: #88c5ff; text-shadow: 0 0 12px #38a0ff; }
h2 { font-size: 29px; line-height: 1.4; font-weight: 650; letter-spacing: 1px; margin: 8px 0 4px; }
.section-heading p, .use-cases-heading p { color: #b9c7d8; font-size: 14px; line-height: 1.7; margin: 0; }
.feature-grid, .scene-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }
.feature-card { position: relative; min-height: 184px; padding: 20px 23px 18px; border: 1px solid var(--space-border); border-radius: 13px; overflow: hidden; background: #031021; }
.feature-visual { position: absolute; z-index: 0; inset: 0; background: linear-gradient(180deg, #020c1c11, #020a16b0 48%, #020b16 100%), url('/site-assets/space/hero.webp') 58% 65% / 800px auto; opacity: .8; }
.feature-1 .feature-visual { background-position: center, 92% 84%; }
.feature-2 .feature-visual { background-position: center, 79% 24%; background-size: auto, 540px auto; }
.feature-3 .feature-visual { background-position: center, 35% 86%; }
.feature-card > :not(.feature-visual) { position: relative; }
.feature-icon { display: grid; place-items: center; width: 54px; height: 54px; margin-bottom: 12px; color: #35e4fa; border: 1px solid #2492bf5c; border-radius: 11px; background: linear-gradient(140deg, #0a3d63d9, #001629df); box-shadow: inset 0 0 14px #1277b32b; }
h3 { margin: 0 0 5px; font-size: 20px; font-weight: 600; line-height: 1.4; }
.feature-card p { max-width: 240px; margin: 0; color: #cad5e4; font-size: 13px; line-height: 1.7; }
.use-cases { padding-top: 22px; }
.use-cases-heading { display: flex; align-items: center; justify-content: space-between; gap: 24px; margin-bottom: 13px; }
.use-cases-heading h2 { font-size: 25px; margin: 0 0 3px; }
.explore-link { display: inline-flex; align-items: center; gap: 8px; flex-shrink: 0; min-height: 44px; color: #8de7f7; font-size: 13px; }
.scene-card { position: relative; min-height: 158px; overflow: hidden; border: 1px solid var(--space-border); border-radius: 11px; color: white; background: #071b32; }
.scene-card::after { content: ''; position: absolute; inset: 0; background: linear-gradient(180deg, #000b 0%, #00102322 60%, #00102333); }
.scene-card > img { width: 100%; height: 100%; object-fit: cover; position: absolute; transition: transform .3s; }
.scene-card:hover > img { transform: scale(1.05); }
.scene-copy { position: relative; z-index: 1; padding: 16px 18px; }
.scene-copy h3 { font-size: 17px; margin-bottom: 3px; }
.scene-copy p { font-size: 12px; color: #d1e0ef; margin: 0; }
.scene-arrow { position: absolute; z-index: 1; right: 13px; bottom: 12px; width: 30px; height: 30px; display: grid; place-items: center; background: #07172b99; border: 1px solid #7fdcff40; border-radius: 50%; color: #a7ecff; }
.space-footer { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-top: 34px; padding: 24px 0; border-top: 1px solid #4f9ccc26; color: #8a9eb5; font-size: 12px; }
.space-footer :deep(.space-brand) { font-size: 17px; }
.space-footer :deep(.space-brand-mark) { width: 27px; height: 27px; }
@media (min-width: 1600px) { .hero-section { min-height: 520px; } .hero-landscape { height: 860px; } .hero-description { font-size: 18px; } .model-orbit { margin-right: 20px; } }
@media (max-width: 1150px) { .space-container, .space-nav { width: calc(100% - 64px); } .model-card { width: 207px; min-height: 91px; padding: 13px; gap: 10px; } .model-icon { width: 49px; height: 49px; } .model-icon img { width: 37px; height: 37px; } .model-info strong { font-size: 15px; } .model-info > span { font-size: 11px; } .model-orbit > .model-chatgpt { left: 5px; } .model-orbit > .model-claude { right: -8px; top: 72px; } .model-orbit > .model-deepseek { left: 23px; bottom: 58px; } .model-orbit > .model-more { right: -17px; bottom: 18px; } .hero-description { font-size: 15px; } .space-stats { padding-inline: 10px; } .feature-card { padding: 18px; } h3 { font-size: 18px; } .feature-grid, .scene-grid { gap: 12px; } }
@media (max-width: 900px) { .hero-section { grid-template-columns: 1fr; padding-top: 45px; padding-bottom: 22px; } .hero-copy { text-align: center; } .hero-brand { margin-inline: auto; font-size: 48px; } .hero-title { font-size: 36px; } .hero-description { font-size: 16px; } .hero-landscape { height: 1020px; background-position: 62% top; } .hero-copy { text-shadow: 0 2px 16px #000; } .model-orbit { height: auto; width: min(620px, 100%); display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 35px auto 0; } .model-orbit > .model-card { position: relative; inset: auto; transform: none; width: 100%; min-height: 96px; } .model-info strong { font-size: 17px; } .model-info > span { font-size: 12px; } .model-icon { width: 54px; height: 54px; } .feature-grid, .scene-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; } .feature-card { min-height: 190px; padding: 22px; } .feature-card p { max-width: none; font-size: 14px; } .scene-card { min-height: 180px; } .space-footer > span:nth-child(2) { display: none; } }
@media (max-width: 600px) { .space-container, .space-nav { width: calc(100% - 32px); } .space-nav { min-height: 66px; padding: 8px 0; gap: 10px; } .space-nav > a { min-height: 44px; } .nav-actions { gap: 10px; } .nav-secondary { padding: 0 10px; min-height: 44px; font-size: 12px; border-radius: 7px; } .nav-start { min-height: 44px; font-size: 12px; padding: 0 11px; border-radius: 7px; gap: 5px; } .nav-start svg { width: 15px; } .space-nav :deep(.space-brand) { font-size: 20px; gap: 8px; } .space-nav :deep(.space-brand-mark) { width: 32px; height: 32px; } .hero-section { padding: 36px 0 24px; } .hero-badge { font-size: 12px; } h1 { margin-top: 23px; } .hero-brand { font-size: 46px; } .hero-title { font-size: clamp(24px, 6.7vw, 34px); letter-spacing: 0; margin-top: 12px; } .hero-description { padding-inline: 5px; font-size: 14px; line-height: 1.9; margin-bottom: 23px; } .desktop-break { display: none; } .hero-start { min-height: 50px; min-width: 185px; font-size: 16px; border-radius: 16px; } .model-orbit { margin-top: 31px; gap: 11px; } .model-orbit > .model-card { min-height: 82px; padding: 11px 9px; gap: 8px; border-radius: 12px; } .model-icon { height: 39px; width: 39px; border-radius: 9px; } .model-icon img { width: 31px; height: 31px; } .model-icon svg { width: 28px; } .model-info { gap: 5px; } .model-info strong { font-size: 13px; } .model-info > span { font-size: 10px; letter-spacing: -.3px; } .space-stats { grid-template-columns: 1fr 1fr; gap: 22px 0; padding: 20px 0; } .stat-item strong { font-size: 25px; } .stat-item:nth-child(3) strong { font-size: 21px; } .stat-item span { font-size: 12px; } .stat-item:nth-child(3)::before { display: none; } .space-content { padding-top: 27px; } h2 { font-size: 23px; letter-spacing: 0; margin: 9px 0; } .section-heading p, .use-cases-heading p { font-size: 13px; } .feature-grid { gap: 11px; } .feature-card { min-height: 206px; padding: 16px 13px; border-radius: 11px; } .feature-icon { width: 45px; height: 45px; margin-bottom: 14px; } h3 { font-size: 16px; } .feature-card p { font-size: 12px; line-height: 1.85; } .use-cases { padding-top: 26px; } .use-cases-heading h2 { font-size: 23px; } .use-cases-heading { gap: 8px; } .explore-link { display: none; } .scene-grid { gap: 11px; } .scene-card { min-height: 150px; } .scene-copy { padding: 13px 12px; } .scene-copy h3 { font-size: 15px; } .scene-copy p { font-size: 11px; line-height: 1.6; } .space-footer { margin-top: 25px; gap: 12px; padding-block: 20px; } .space-footer > span { font-size: 10px; } }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition: none !important; } }
</style>
