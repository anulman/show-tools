import { createContext } from 'react';
import type { mountDesk } from '../../practice/desk.js';

export type DeskMount = Awaited<ReturnType<typeof mountDesk>>;

export interface SongObservation {
  id: string;
  digest?: string;
  installedIds?: readonly string[];
  reason: 'selected' | 'observed';
}

export const DeskState = createContext<{
  active?: SongObservation;
  runtime?: DeskMount;
}>({});
