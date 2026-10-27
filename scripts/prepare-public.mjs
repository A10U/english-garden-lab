import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const result = spawnSync('python3', ['speech-training/build_demo.py', '--output', 'public'], {cwd: root, stdio: 'inherit'});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
