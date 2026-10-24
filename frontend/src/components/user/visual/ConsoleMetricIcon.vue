<template>
  <!-- 使用运行中的已验收原型提取的静态SVG节点，不接受外部HTML。 -->
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.95" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <component :is="shape.tag" v-for="(shape, index) in (shapes[name] || shapes.chart)" :key="index" v-bind="shape.attrs" />
  </svg>
</template>
<script setup lang="ts">
defineProps<{
  /** 图标名称，仅控制展示。 */
  name: string
  /** 兼容统计卡展示参数，实际尺寸由局部CSS控制。 */
  size?: string
}>()
// 节点均来自V1.2.1的本地Lucide图标，不含事件、脚本或业务数据。
const shapes: Record<string, Array<{ tag: string; attrs: Record<string, string> }>> = {
  wallet: [{"attrs":{"d":"M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"},"tag":"path"},{"attrs":{"d":"M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"},"tag":"path"}],
  coins: [{"attrs":{"cx":"8","cy":"8","r":"6"},"tag":"circle"},{"attrs":{"d":"M18.09 10.37A6 6 0 1 1 10.34 18"},"tag":"path"},{"attrs":{"d":"M7 6h1v4"},"tag":"path"},{"attrs":{"d":"m16.71 13.88.7.71-2.82 2.82"},"tag":"path"}],
  chart: [{"attrs":{"d":"M3 3v16a2 2 0 0 0 2 2h16"},"tag":"path"},{"attrs":{"d":"M18 17V9"},"tag":"path"},{"attrs":{"d":"M13 17V5"},"tag":"path"},{"attrs":{"d":"M8 17v-3"},"tag":"path"}],
  cube: [{"attrs":{"d":"M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"},"tag":"path"},{"attrs":{"d":"m3.3 7 8.7 5 8.7-5"},"tag":"path"},{"attrs":{"d":"M12 22V12"},"tag":"path"}],
  zap: [{"attrs":{"d":"M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"},"tag":"path"}],
  file: [{"attrs":{"d":"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"},"tag":"path"},{"attrs":{"d":"M14 2v4a2 2 0 0 0 2 2h4"},"tag":"path"},{"attrs":{"d":"M10 9H8"},"tag":"path"},{"attrs":{"d":"M16 13H8"},"tag":"path"},{"attrs":{"d":"M16 17H8"},"tag":"path"}],
  timer: [{"attrs":{"x1":"10","x2":"14","y1":"2","y2":"2"},"tag":"line"},{"attrs":{"x1":"12","x2":"15","y1":"14","y2":"11"},"tag":"line"},{"attrs":{"cx":"12","cy":"14","r":"8"},"tag":"circle"}],
  key: [{"attrs":{"d":"M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"},"tag":"path"},{"attrs":{"cx":"16.5","cy":"7.5","fill":"currentColor","r":".5"},"tag":"circle"}],
  activity: [{"attrs":{"d":"M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"},"tag":"path"}],
  layers: [{"attrs":{"d":"M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"},"tag":"path"},{"attrs":{"d":"M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"},"tag":"path"},{"attrs":{"d":"M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"},"tag":"path"}],
  radio: [{"attrs":{"d":"M4.9 16.1C1 12.2 1 5.8 4.9 1.9"},"tag":"path"},{"attrs":{"d":"M7.8 4.7a6.14 6.14 0 0 0-.8 7.5"},"tag":"path"},{"attrs":{"cx":"12","cy":"9","r":"2"},"tag":"circle"},{"attrs":{"d":"M16.2 4.8c2 2 2.26 5.11.8 7.47"},"tag":"path"},{"attrs":{"d":"M19.1 1.9a9.96 9.96 0 0 1 0 14.1"},"tag":"path"},{"attrs":{"d":"M9.5 18h5"},"tag":"path"},{"attrs":{"d":"m8 22 4-11 4 11"},"tag":"path"}],
  check: [{"attrs":{"cx":"12","cy":"12","r":"10"},"tag":"circle"},{"attrs":{"d":"m9 12 2 2 4-4"},"tag":"path"}]
}
</script>
