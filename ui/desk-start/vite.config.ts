import { defineConfig } from 'vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';
import { TANSTACK_DESK_PATH } from '../../lib/remote-performance/desk-paths.js';

export default defineConfig({
  base: TANSTACK_DESK_PATH,
  plugins: [tanstackStart({ spa: { enabled: true } }), react()],
});
