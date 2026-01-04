import { defineConfig, loadEnv } from 'vite';
// Explicitly import process to fix "Property 'cwd' does not exist on type 'Process'" error
import process from 'node:process';

export default defineConfig(({ mode }) => {
  // Load env file based on `mode`. 
  // We use '' as the third argument to load variables without the VITE_ prefix.
  const env = loadEnv(mode, process.cwd(), '');
  
  // Vercel sometimes provides environment variables directly on process.env 
  // during the build process even if they aren't in a .env file.
  const apiKey = env.API_KEY || process.env.API_KEY;

  return {
    define: {
      // This globally replaces 'process.env.API_KEY' with the actual string in your code.
      'process.env.API_KEY': JSON.stringify(apiKey)
    },
    build: {
      outDir: 'dist',
      sourcemap: false, // Cleaner production builds
      minify: 'esbuild'
    },
    server: {
      port: 3000
    }
  };
});
