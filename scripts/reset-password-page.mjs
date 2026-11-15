// GitHub Pages has no SPA fallback: publish dist/reset-password/index.html (the app's index.html
// with <base href="../"> so the relative ./assets paths still resolve) so reset emails can open
// https://portal.ssiglobal.uk/reset-password/ directly, in a fresh browser session too.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const html = readFileSync('dist/index.html', 'utf8');
if (!html.includes('<head>')) throw new Error('dist/index.html has no <head>');
mkdirSync('dist/reset-password', { recursive: true });
writeFileSync('dist/reset-password/index.html', html.replace('<head>', '<head>\n    <base href="../" />'));
console.log('dist/reset-password/index.html written');
