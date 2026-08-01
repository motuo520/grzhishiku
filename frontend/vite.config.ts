import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    // Bind explicitly to IPv4 loopback. Default 'localhost' resolved to IPv6 ::1 on
    // this machine, so the dev server only listened on [::1]:3000 and browsers that
    // resolve localhost to 127.0.0.1 got "connection refused" (the recurring
    // "frontend stopped" symptom).
    host: '127.0.0.1',
    port: 3000,
    proxy: {
      '/api': {
        // Backend (uvicorn) binds IPv4 127.0.0.1; use it explicitly to avoid the
        // same IPv6 localhost resolution issue in the proxy.
        target: 'http://127.0.0.1:8000',
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
      },
    },
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          animation: ['framer-motion'],
          charts: ['recharts', 'd3'],
          query: ['@tanstack/react-query'],
          editor: ['@tiptap/react', '@tiptap/starter-kit'],
          ui: ['lucide-react', 'zustand'],
        },
      },
    },
  },
});
