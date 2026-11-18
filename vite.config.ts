import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        devOptions: {
          enabled: true,
        },
        includeAssets: [
          'icon.svg',
          'apple-touch-icon.png',
          'pwa-192x192.png',
          'pwa-512x512.png',
          'pwa-maskable-512x512.png',
        ],
        manifest: {
          name: 'CutFlow — Local-First Video Editor',
          short_name: 'CutFlow',
          description: 'Local-first browser video editing and intelligent template production workstation.',
          theme_color: '#0B0C0E',
          background_color: '#0B0C0E',
          display: 'standalone',
          orientation: 'any',
          scope: '/',
          start_url: '/',
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
          globPatterns: ['**/*.{js,css,html,svg,png,woff,woff2,ico}'],
          globIgnores: ['**/ort-wasm*.wasm'],
          runtimeCaching: [
            {
              urlPattern: /\/wasm\/.*\.(wasm|js)$/,
              handler: 'CacheFirst',
              options: {
                cacheName: 'cutflow-local-wasm-v1',
                expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 90 },
              },
            },
            {
              urlPattern: /^https:\/\/huggingface\.co\/.*$/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'cutflow-hf-models-v1',
                expiration: { maxEntries: 64, maxAgeSeconds: 60 * 60 * 24 * 90 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            {
              urlPattern: /^https:\/\/storage\.googleapis\.com\/mediapipe-models\/.*$/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'cutflow-mediapipe-models-v1',
                expiration: { maxEntries: 16, maxAgeSeconds: 60 * 60 * 24 * 90 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
          ],
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
