import path from "path"
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Unique id per build — used by the client to detect that a newer version
// was deployed and reload itself (saved home-screen apps resume stale
// bundles from memory otherwise).
const buildId = Date.now().toString()

// https://vite.dev/config/
export default defineConfig({
  logLevel: 'error',
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
  },
  plugins: [
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
