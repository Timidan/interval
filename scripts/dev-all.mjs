import { spawn } from 'node:child_process';
const children = [['server/index.mjs'], ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4190', '--strictPort']].map(args => spawn(process.execPath, args, { stdio: 'inherit' }));
let stopping = false;
const stop = () => { if (stopping) return; stopping = true; for (const child of children) child.kill('SIGTERM'); };
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, stop);
for (const child of children) child.on('exit', code => { if (code) process.exitCode = code; stop(); });
