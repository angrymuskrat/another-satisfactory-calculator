import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
await import('./prepare-highs.mjs');
const children = [
  spawn(process.execPath, ['--import', 'tsx', 'apps/api/server.ts'], { cwd: root, stdio: 'inherit', windowsHide: true }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config', 'apps/web/vite.config.ts', '--configLoader', 'runner'], { cwd: root, stdio: 'inherit', windowsHide: true }),
];
let closing = false;
function stop(code = 0) {
  if (closing) return;
  closing = true;
  for (const child of children) child.kill();
  process.exitCode = code;
}
for (const child of children) {
  child.on('error', error => { console.error(error.message); stop(1); });
  child.on('exit', code => { if (!closing) stop(code ?? 1); });
}
process.on('SIGINT', () => stop()); process.on('SIGTERM', () => stop());
console.log('Калькулятор: http://localhost:5173 · API: http://localhost:3001 · Ctrl+C — остановить');
