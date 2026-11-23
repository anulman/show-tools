import { createFileRoute } from '@tanstack/react-router';
import { ChartPreview, loadDeskRoute, SongPreview } from '../song-preview';

export const Route = createFileRoute('/$songId')({
  loader: ({ params, context, abortController }) => loadDeskRoute(params.songId, 'hardware', context, abortController.signal),
  component: HardwareSong,
});

function HardwareSong() {
  const data = Route.useLoaderData();
  if (data.kind === 'draft') return <ChartPreview key={data.entry.id} chart={data.chart} source={data.source} archive={data.archive} />;
  return <SongPreview key={data.entry.id} data={data} />;
}
