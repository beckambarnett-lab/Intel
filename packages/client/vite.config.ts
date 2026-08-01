import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    // Bind all interfaces so a second device on the LAN can join for real
    // two-player testing. Two windows on one machine works without this.
    host: true,
  },
  optimizeDeps: {
    // @ember/shared is a workspace package consumed as TypeScript source, not
    // as a built artifact. Pre-bundling it would stale-cache the sim, and the
    // client MUST run byte-identical sim code to the server or prediction
    // diverges silently.
    exclude: ['@ember/shared'],
  },
});
