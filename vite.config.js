import path from "path"
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// Unique id per build — used by the client to detect that a newer version
// was deployed and reload itself (saved home-screen apps resume stale
// bundles from memory otherwise).
const buildId = Date.now().toString()

// https://vite.dev/config/
export default defineConfig({
  logLevel: 'error',
  server: {
    watch: { ignored: ['**/output/**', '**/tests/**', '**/supabase/**', '**/sandbox-gateway/**', '**/tmp/**'] },
  },
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
  },
  plugins: [
    {
      name: 'sandbox-database-guard',
      configResolved(config) {
        if (config.mode === 'sandbox' || config.server.port === 5174) {
          const env = loadEnv(config.mode, config.envDir, 'VITE_');
          if (config.mode !== 'sandbox' || env.VITE_SUPABASE_URL !== 'http://127.0.0.1:54521') {
            throw new Error('Sandbox preview requires sandbox mode and the local database on port 54521.');
          }
        }
      },
    },
    react(),
    {
      name: 'emit-version-file',
      apply: 'build',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'version.json',
          source: JSON.stringify({ build: buildId }),
        })
      },
    },
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
