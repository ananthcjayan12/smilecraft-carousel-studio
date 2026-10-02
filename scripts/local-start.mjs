import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
process.chdir(root);
if(existsSync('.env'))process.loadEnvFile('.env');
await import('../server/index.mjs');
