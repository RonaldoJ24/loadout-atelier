import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Two local processes, one terminal. Only the API loads the private env file.
const root = fileURLToPath(new URL('../', import.meta.url));
const frontendEnv = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !name.startsWith('DEEPSEEK_')),
);
const api = spawn(
  process.execPath,
  ['--env-file-if-exists=.env.local', '--import', 'tsx', '--watch', 'server/index.ts'],
  { cwd: root, stdio: 'inherit' },
);
const ui = spawn(process.execPath, ['node_modules/vite/bin/vite.js', ...process.argv.slice(2)], {
  cwd: root,
  env: frontendEnv,
  stdio: 'inherit',
});
let stopping = false;
const stop = (exitCode) => {
  if (stopping) return;
  stopping = true;
  process.exitCode = exitCode;
  for (const child of [api, ui]) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  }
};
for (const child of [api, ui]) {
  child.once('error', () => {
    console.error('Could not start Loadout Atelier. Run npm ci and try again.');
    stop(1);
  });
  child.once('exit', (code) => stop(code ?? 1));
}
process.once('SIGINT', () => stop(0));
process.once('SIGTERM', () => stop(0));
