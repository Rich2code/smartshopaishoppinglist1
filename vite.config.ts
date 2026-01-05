import { defineConfig, loadEnv } from 'vite';
import process from 'process';

export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  const env = loadEnv(mode, process.cwd(), '');
  
  // Use the loaded env or fallback to process.env (used by Vercel)
  const apiKey = env.API_KEY || process.env.API_KEY;

  return {
    define: {
      // Bakes the API key directly into the client-side bundle
      'process.env.API_KEY': JSON.stringify(apiKey)
    },
    build: {
      outDir: 'dist',
      minify: 'esbuild'
    },
    server: {
      port: 3000
    }
  };
});