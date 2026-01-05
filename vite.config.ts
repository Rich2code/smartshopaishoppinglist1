import { defineConfig, loadEnv } from 'vite';
import process from 'node:process';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  
  // Vercel provides vars via process.env during build.
  // Vite loads them via loadEnv for local development.
  const apiKey = env.API_KEY || process.env.API_KEY;

  if (!apiKey && mode === 'production') {
    console.warn('WARNING: API_KEY is not defined in the environment. The app will fail to make AI requests.');
  }

  return {
    define: {
      // This is the CRITICAL part for browser apps.
      // It replaces every instance of process.env.API_KEY with the actual string.
      'process.env.API_KEY': JSON.stringify(apiKey)
    },
    build: {
      outDir: 'dist',
      minify: 'esbuild'
    }
  };
});