/**
 * Start the full accesU stack (database, API, client) from the repo root.
 * Run with: npm run dev
 */
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const services = [
  { name: 'db', cwd: resolve(root, 'server'), args: ['run', 'dev:db'] },
  { name: 'api', cwd: resolve(root, 'server'), args: ['run', 'dev'] },
  { name: 'client', cwd: resolve(root, 'client'), args: ['run', 'dev'] },
];

const children = services.map(({ name, cwd, args }) => {
  console.log(`[${name}] starting: ${npm} ${args.join(' ')} (in ${cwd})`);
  const child = spawn(npm, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  child.on('exit', (code, signal) => {
    console.log(`[${name}] stopped (${signal ?? code})`);
  });
  return child;
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\nStopping all services…');
  for (const child of children) child.kill('SIGTERM');
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
