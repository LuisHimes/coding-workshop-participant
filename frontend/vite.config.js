import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000
  },
  build: {
    rollupOptions: {
      output: {
        // Libraries change rarely, so browsers keep them cached when only the app's own code changes
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (/[\\/]node_modules[\\/](@mui|@emotion|@popperjs|react-transition-group)[\\/]/.test(id)) return 'mui'
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) return 'react'
          return 'vendor'
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{js,jsx}'],
      // main.jsx only mounts <App /> into the page
      exclude: ['src/test/**', 'src/**/*.test.{js,jsx}', 'src/main.jsx'],
      reporter: ['text', 'json-summary'],
      // Fail the run if any file drops below full coverage
      thresholds: { 100: true },
    },
  },
})
