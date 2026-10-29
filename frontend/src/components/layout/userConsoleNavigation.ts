import type { RouteLocationNormalizedLoaded } from 'vue-router'

/** 用户外壳依据路由契约选择，管理员访问共享用户页时也使用新布局。 */
export function isUserConsoleRoute(route: Pick<RouteLocationNormalizedLoaded, 'meta'>): boolean {
  return route.meta.requiresAdmin === false
}

export interface UserConsoleNavigationState {
  /** 是否已通过现有认证。 */
  authenticated: boolean
  /** 是否为管理员，沿用后台模式的访问例外。 */
  admin: boolean
  /** 是否启用原有简易模式。 */
  simple: boolean
  /** 是否启用原有后台模式。 */
  backend: boolean
  /** 由正式功能开关注册表解析的渠道状态开关。 */
  monitor: boolean
}

/** 声明用户入口；隐藏菜单不删除路由，也不代替现有权限守卫。 */
export function userConsoleNavigation(state: UserConsoleNavigationState) {
  if (!state.authenticated || (state.backend && !state.admin)) return []
  return [
    { path: '/dashboard', label: 'nav.dashboard', enabled: true },
    { path: '/usage', label: 'nav.usage', enabled: !state.simple },
    // 管理员保留监控入口，普通用户遵循后台功能开关。
    { path: '/monitor', label: 'nav.channelStatus', enabled: state.admin || state.monitor },
    { path: '/keys', label: 'nav.apiKeys', enabled: true },
    { path: '/ai-creation/image', label: 'imageStudio.navigation', enabled: true },
    { path: '/redeem', label: 'userConsole.wallet', enabled: !state.simple },
    { path: '/profile', label: 'nav.profile', enabled: true },
  ].filter(item => item.enabled)
}

/** 仪表盘与使用记录各自高亮对应的主导航。 */
export function userConsoleActivePath(path: string): string {
  if (path.startsWith('/ai-creation/')) return '/ai-creation/image'
  return path
}
