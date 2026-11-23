import { Link, Outlet, useBlocker, useRouter, useRouterState } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { nextSetSong, SET_SONGS, songForRoute, songRoute } from '../../../songs/routes.js';
import { TANSTACK_DESK_PATH } from '../../../lib/remote-performance/desk-paths.js';
import type { AudioMode } from '../../practice/audio-mode.js';
import { DeskState, type DeskMount, type SongObservation } from './desk-state';
import { firstSongPath, template } from './template';

function routeSong(pathname: string) {
  return songForRoute(pathname.replace(/^\/(?:browser\/)?/, '').replace(/\/$/, ''));
}

function routeMode(pathname: string): AudioMode {
  const path = pathname.slice(1);
  return path === 'browser' || path.startsWith('browser/') ? 'browser' : 'hardware';
}

export function DeskPage() {
  const mode = useRouterState({ select: state => routeMode(state.location.pathname) });
  return <MountedDesk key={mode} mode={mode} />;
}

function MountedDesk({ mode }: { mode: AudioMode }) {
  const router = useRouter();
  const runtimeSlot = router.options.context.runtime;
  const pathname = useRouterState({ select: state => state.location.pathname });
  const requested = routeSong(pathname);
  const requestedId = requested?.id;
  const initialSong = useRef(requestedId);
  const previousPath = useRef(pathname);
  const [active, setActive] = useState<SongObservation>();
  const [runtime, setRuntime] = useState<DeskMount>();
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const lifecycle = new AbortController();
    let handle: DeskMount | undefined;
    let previousSong: string | undefined;
    void import('../../practice/desk.js').then(({ mountDesk }) => mountDesk({
      mode,
      initialSongId: initialSong.current,
      signal: lifecycle.signal,
      assetBase: new URL('/ui/practice/', location.origin),
      workerURL: mode === 'browser' ? new URL(TANSTACK_DESK_PATH + 'browser/sw.js', location.origin) : undefined,
      allowSongInput: songId => {
        const requestedSong = routeSong(router.state.location.pathname);
        return !requestedSong || (!requestedSong.previewOnly && requestedSong.id === songId);
      },
      onModeChange: next => {
        const slug = routeSong(router.state.location.pathname);
        location.assign(TANSTACK_DESK_PATH + (next === 'browser' ? 'browser/' : '') + (slug ? songRoute(slug.id) : ''));
      },
      onSong: observation => {
        if (lifecycle.signal.aborted) return;
        const currentRoute = routeSong(router.state.location.pathname);
        runtimeSlot.installedIds = observation.installedIds;
        setActive(observation);
        const slug = songRoute(observation.id);
        if (slug && (!currentRoute || observation.reason === 'selected' || currentRoute.id === previousSong)) {
          void router.navigate({
            to: mode === 'hardware' ? '/$songId' : '/browser/$songId',
            params: { songId: slug },
            replace: !currentRoute || observation.reason === 'observed',
            ignoreBlocker: true,
          });
        }
        previousSong = observation.id;
      },
    })).then(mounted => {
      if (lifecycle.signal.aborted) return mounted.dispose();
      handle = mounted;
      runtimeSlot.current = mounted;
      setRuntime(mounted);
      setReady(true);
    }).catch(reason => {
      if (!lifecycle.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not open the Performance Desk.');
    });
    return () => {
      lifecycle.abort();
      if (runtimeSlot.current === handle) {
        delete runtimeSlot.current;
        delete runtimeSlot.installedIds;
      }
      void handle?.dispose();
    };
  }, [mode, router, runtimeSlot]);

  useBlocker({
    shouldBlockFn: () => mode === 'browser' && runtime?.canBrowseSong() === false,
    enableBeforeUnload: false,
  });

  useEffect(() => {
    if (previousPath.current !== pathname) {
      previousPath.current = pathname;
      runtime?.retireRoute();
    }
  }, [pathname, runtime]);

  useEffect(() => {
    if (runtime) void router.invalidate();
  }, [runtime, active?.digest, active?.id, router]);

  useEffect(() => {
    if (mode === 'browser' && runtime && requestedId && active && requestedId !== active.id)
      void runtime.requestBrowserSong(requestedId).catch(reason => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [active?.id, mode, requestedId, runtime]);

  useEffect(() => {
    if (!active || !ready) return;
    const from = requestedId ?? active.id;
    const next = nextSetSong(from, active.installedIds ?? []);
    const slug = next && songRoute(next.id);
    if (slug) void router.preloadRoute({ to: mode === 'hardware' ? '/$songId' : '/browser/$songId', params: { songId: slug } });
  }, [active?.id, active?.digest, active?.installedIds, mode, ready, requestedId, router]);

  useEffect(() => {
    if (requested?.previewOnly) document.title = requested.title + ' · Performance Desk';
  }, [active?.id, pathname, requested]);

  const home = (mode === 'browser' ? '/browser' : '') + firstSongPath;
  const header = template.header.replace('href="./"', 'href="' + home + '"');
  const previewing = requested?.previewOnly || (mode === 'hardware' && !!(requestedId && active && requestedId !== active.id));
  const activeSong = mode === 'hardware' && requested?.previewOnly && SET_SONGS.find(song => song.id === active?.id);
  const activeSlug = activeSong && songRoute(activeSong.id);
  return (
    <DeskState.Provider value={{ active, runtime }}>
      {mode === 'browser' && <link rel="manifest" href={TANSTACK_DESK_PATH + 'browser/manifest.webmanifest'} />}
      <main id="practice-desk" className="desk">
        <header className="topline" dangerouslySetInnerHTML={{ __html: header }} />
        {mode === 'hardware' && <details className="chart-preview-menu">
          <summary>Chart previews</summary>
          <ul>
            {SET_SONGS.filter(song => song.previewOnly).map(song => {
              const slug = songRoute(song.id);
              return slug && <li key={song.id}><Link to="/$songId" params={{ songId: slug }}>{song.title}</Link></li>;
            })}
          </ul>
        </details>}
        {activeSlug && activeSong && <p>
          <Link to="/$songId" params={{ songId: activeSlug }}>Back to {activeSong.title}</Link>
        </p>}
        {error && <p role="alert">{error}</p>}
        <Outlet />
        <div hidden={previewing} inert={previewing} style={{ display: previewing ? 'none' : 'contents' }} dangerouslySetInnerHTML={{ __html: template.song }} />
      </main>
      <div style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: template.dialogs }} />
    </DeskState.Provider>
  );
}
