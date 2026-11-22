import { createFileRoute } from '@tanstack/react-router';
import { loadDeskRoute, SongPreview } from '../song-preview';

export const Route = createFileRoute('/$songId')({
  loader: ({ params, context, abortController }) => loadDeskRoute(params.songId, 'hardware', context, abortController.signal),
  component: HardwareSong,
});

function HardwareSong() {
  const data = Route.useLoaderData();
  return <SongPreview key={data.entry.id} data={data} />;
}
