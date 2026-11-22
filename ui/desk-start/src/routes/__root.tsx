import { createRootRouteWithContext, HeadContent, Scripts } from '@tanstack/react-router';
import { useEffect, useState, type ReactNode } from 'react';
import type { DeskRouterContext } from '../router';
import { DeskPage } from '../desk-page';
import { firstSongPath } from '../template';

function Document({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head><HeadContent /></head>
      <body>{children}<Scripts /></body>
    </html>
  );
}

function Root() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? <DeskPage /> : <main className="desk" aria-busy="true">Loading Performance Desk…</main>;
}

export const Route = createRootRouteWithContext<DeskRouterContext>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
      { name: 'theme-color', content: '#293325' },
      { title: 'Performance Desk · Show Tools' },
    ],
    links: [
      { rel: 'icon', href: '/ui/practice/icon.svg', type: 'image/svg+xml' },
      ...['style.css', 'voice-library.css', 'tuner.css'].map(name => ({ rel: 'stylesheet', href: '/ui/practice/' + name })),
    ],
  }),
  shellComponent: Document,
  component: Root,
  notFoundComponent: () => <main className="desk"><p>Song not found.</p><a href={firstSongPath}>Open Performance Desk</a></main>,
});
