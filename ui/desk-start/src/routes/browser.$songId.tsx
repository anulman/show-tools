import { createFileRoute } from '@tanstack/react-router';
import { loadDeskRoute } from '../song-preview';

export const Route = createFileRoute('/browser/$songId')({
  loader: ({ params, context, abortController }) => loadDeskRoute(params.songId, 'browser', context, abortController.signal),
  component: () => null,
});
