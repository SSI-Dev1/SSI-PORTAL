import { createHash } from 'node:crypto';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Production Content-Security-Policy. Injected as a <meta> tag so it also applies on
 * static hosts that can't set headers; deploy/nginx.conf sends the same policy as a
 * header (plus frame-ancestors, which meta tags cannot set).
 */
function contentSecurityPolicy(supabaseUrl: string): Plugin {
  return {
    name: 'ssi-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const hashes = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
          (m) => `'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`,
        );
        let api = '';
        try {
          const u = new URL(supabaseUrl);
          api = ` ${u.origin} wss://${u.host}`;
        } catch {
          /* no backend configured */
        }
        const csp = [
          "default-src 'self'",
          `script-src 'self' ${hashes.join(' ')}`.trim(),
          "style-src 'self'",
          "img-src 'self' data: blob:",
          "font-src 'self'",
          `connect-src 'self'${api}`,
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'self'",
        ].join('; ');
        return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`);
      },
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    plugins: [react(), contentSecurityPolicy(env.VITE_SUPABASE_URL ?? '')],
    // Relative base keeps the build portable (own server or any sub-path).
    base: './',
    server: { host: 'localhost' }, // never expose the dev server on the network
    preview: { host: 'localhost' },
    build: {
      sourcemap: false,
      assetsInlineLimit: 0, // no data: URIs, so the CSP can stay strict
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom', 'react-router-dom'],
            charts: ['recharts'],
            supabase: ['@supabase/supabase-js'],
          },
        },
      },
    },
  };
});
