import { createFileRoute } from '@tanstack/react-router';
import { ChartPreview, loadDeskRoute } from '../song-preview';

export const Route = createFileRoute('/browser/$songId')({
  loader: ({ params, context, abortController }) => loadDeskRoute(params.songId, 'browser', context, abortController.signal),
  component: BrowserSong,
});

function BrowserSong() {
  const data = Route.useLoaderData();
  return data.arrangement ? <ChartPreview key={data.entry.id} {...data.arrangement} /> : null;
}
