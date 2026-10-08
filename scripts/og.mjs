// Renderuje og/index.html u public/og.png (1200×630) preko headless Chromium-a.
// Upotreba: npm run og   (CHROME=/putanja/do/chrome ako nije u PATH-u)
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = fileURLToPath(new URL('../public/og.png', import.meta.url));
const chrome = process.env.CHROME || 'chromium-browser';

const server = await createServer({ root, logLevel: 'warn', server: { port: 5199, strictPort: true } });
await server.listen();
try {
  // asinhrono: Vite server u ovom procesu mora da odgovara dok Chromium učitava stranicu
  await promisify(execFile)(chrome, [
    '--headless', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--window-size=1200,630', '--virtual-time-budget=6000', `--screenshot=${out}`,
    'http://localhost:5199/og/',
  ], { timeout: 60000 });
  console.log(`og slika: ${out}`);
} finally {
  await server.close();
}
