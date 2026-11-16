// Usage: node scripts/upload-secret.mjs <json file> <SECRET_NAME>
// Minifies the JSON (secrets are capped at about 5 kB) and pipes it to
// `wrangler secret put`, so the value never touches the shell history.
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

const [file, name] = process.argv.slice(2);
if (!file || !name) {
  console.error('usage: node scripts/upload-secret.mjs <json file> <SECRET_NAME>');
  process.exit(1);
}
const value = JSON.stringify(JSON.parse(readFileSync(file, 'utf8')));
console.log(`${name}: ${value.length} bytes`);
if (value.length > 5100) {
  console.error(`${file} is over the 5.1 kB secret limit once minified; trim it first.`);
  process.exit(1);
}
const child = spawn('wrangler', ['secret', 'put', name], { stdio: ['pipe', 'inherit', 'inherit'], shell: true });
child.stdin.end(value);
child.on('exit', (code) => process.exit(code ?? 1));
