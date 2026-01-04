
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  // Set the third parameter to '' to load all envs regardless of the `VITE_` prefix.
  // Fix: Cast process to any to access cwd() which might not be defined in the global Process type in certain TypeScript environments.
  const env = loadEnv(mode, (process as any).cwd(), '');
  
  return {
    define: {
      // This allows the @google/genai SDK to access the API_KEY via process.env
      'process.env.API_KEY': JSON.stringify(env.API_KEY)
    },
    build: {
      outDir: 'dist',
      sourcemap: true
    },
    server: {
      port: 3000
    }
  };
});
