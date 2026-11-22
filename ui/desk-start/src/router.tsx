import { createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';
import { TANSTACK_DESK_PATH } from '../../../lib/remote-performance/desk-paths.js';
import type { DeskMount } from './desk-state';

export interface DeskRouterContext {
  runtime: { current?: DeskMount; installedIds?: readonly string[] };
}

export function getRouter() {
  return createRouter({
    routeTree,
    basepath: TANSTACK_DESK_PATH,
    context: { runtime: {} } satisfies DeskRouterContext,
    defaultPendingMs: 250,
    defaultPendingMinMs: 0,
    defaultPreloadStaleTime: 30_000,
    scrollRestoration: true,
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
