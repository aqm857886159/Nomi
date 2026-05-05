export const APP_ROUTES = [
  { path: '/studio/*', component: 'NomiStudioApp' },
  { path: '/share/*', component: 'ShareFullPage' },
  { path: '/', component: 'RedirectToStudio' },
  { path: '/workspace/*', component: 'RedirectToStudio' },
  { path: '/oauth/github', component: 'RedirectToStudio' },
  { path: '*', component: 'RedirectToStudio' },
] as const

export type AppRouteComponent = typeof APP_ROUTES[number]['component']
export type AppRoutePath = typeof APP_ROUTES[number]['path']

export function getAppRoutePath(component: AppRouteComponent, path?: AppRoutePath): AppRoutePath {
  const route = APP_ROUTES.find((candidate) => {
    if (candidate.component !== component) return false
    return path ? candidate.path === path : true
  })
  if (!route) {
    throw new Error(`Route is not registered: ${component}${path ? ` ${path}` : ''}`)
  }
  return route.path
}
