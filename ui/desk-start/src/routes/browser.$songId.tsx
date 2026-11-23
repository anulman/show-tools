import { createFileRoute } from '@tanstack/react-router';
import { ChartPreview, loadDeskRoute } from '../song-preview';

export const Route = createFileRoute('/browser/$songId')({
  loader: ({ params, context, abortController }) => loadDeskRoute(params.songId, 'browser', context, abortController.signal),
  component: BrowserSong,
});

function BrowserSong() {
  const data = Route.useLoaderData();
  return data.kind === 'draft' ? <ChartPreview key={data.entry.id} chart={data.chart} source={data.source} archive={data.archive} /> : null;
}
