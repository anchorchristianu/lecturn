import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // When running `netlify dev`, it proxies the Vite server and serves
    // functions at /.netlify/functions/* and the /api/* redirect below.
    port: 5173,
  },
});
