import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import basicSsl from "@vitejs/plugin-basic-ssl";

export default defineConfig({
  plugins: [
    vue(),
    basicSsl(), // Uncomment to enable self-signed HTTPS for IP access
  ],
  server: {
    host: "0.0.0.0",
    port: 5667,
    // https: true, // Uncomment to enable HTTPS (requires @vitejs/plugin-basic-ssl)
    headers: {
      // Essential for SharedArrayBuffer / WebCodecs in some contexts
      // Note: These headers require HTTPS (Secure Context) to be respected by browsers.
      // On HTTP IP access, they will cause warnings/errors and be ignored.
      // Since we use Transferable objects (postMessage) instead of SharedArrayBuffer,
      // we can strictly speaking omit them if not using SharedArrayBuffer.
      // "Cross-Origin-Embedder-Policy": "require-corp",
      // "Cross-Origin-Opener-Policy": "same-origin",
    },
  },
  worker: {
    format: "es",
  },
});
