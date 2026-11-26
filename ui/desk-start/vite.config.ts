import { defineConfig } from 'vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';
import { TANSTACK_ASSET_PATH, TANSTACK_DESK_PATH } from '../../lib/remote-performance/desk-paths.js';

export default defineConfig({
  base: TANSTACK_DESK_PATH,
  build: { assetsDir: TANSTACK_ASSET_PATH.slice(1, -1) },
  plugins: [tanstackStart({ spa: { enabled: true } }), react()],
});
