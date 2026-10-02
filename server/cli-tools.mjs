import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawnSync } from 'node:child_process';

function executable(file) {
  try { fs.accessSync(file, fs.constants.X_OK); return true; } catch { return false; }
}

export function resolveCliBinary(name, envKey, env = process.env) {
  const configured = String(env[envKey] || '').trim();
  if (configured) return configured.startsWith('~/') ? path.join(os.homedir(), configured.slice(2)) : configured;
  const extensions = process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : [''];
  const directories = String(env.PATH || '').split(path.delimiter).filter(Boolean);
  directories.push(path.join(os.homedir(), '.local', 'bin'), path.join(os.homedir(), '.npm-global', 'bin'), '/opt/homebrew/bin', '/usr/local/bin');
  for (const directory of [...new Set(directories)]) for (const extension of extensions) {
    const candidate = path.join(directory, `${name}${extension}`);
    if (executable(candidate)) return candidate;
  }
  return name;
}

const inspections=new Map();
const inspectionKey=(binary,authArgs)=>JSON.stringify([binary,authArgs||[]]);
export function inspectCli(name, envKey, { authArgs, refresh=false } = {}) {
  const binary = resolveCliBinary(name, envKey),key=inspectionKey(binary,authArgs),cached=inspections.get(key);
  if(!refresh&&cached&&cached.expires>Date.now())return {...cached.value};
  const versionCheck = spawnSync(binary, ['--version'], { encoding: 'utf8', timeout: 5000 });
  const installed = versionCheck.status === 0;
  const version = installed ? String(versionCheck.stdout || versionCheck.stderr || '').trim() : '';
  const authCheck = installed && authArgs ? spawnSync(binary, authArgs, { encoding: 'utf8', timeout: 8000 }) : null;
  const authenticated = authArgs ? Boolean(authCheck && authCheck.status === 0) : installed;
  const error = installed ? (authenticated ? '' : String(authCheck?.stderr || authCheck?.stdout || 'Authentication required.').trim()) : String(versionCheck.error?.message || versionCheck.stderr || `${name} was not found.`).trim();
  const value={binary,installed,authenticated,version,error};inspections.set(inspectionKey(binary,authArgs),{value,expires:Date.now()+30000});return {...value};
}

function run(binary, args, timeout) {
  return new Promise(resolve => execFile(binary, args, { encoding: 'utf8', timeout, windowsHide: true }, (error, stdout, stderr) => resolve({ status: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout, stderr, error })));
}

// Non-blocking variant for request handlers: spawnSync stalls every other request while the CLI starts.
export async function inspectCliAsync(name, envKey, { authArgs } = {}) {
  const binary = resolveCliBinary(name, envKey);
  const versionCheck = await run(binary, ['--version'], 5000);
  const installed = versionCheck.status === 0;
  const version = installed ? String(versionCheck.stdout || versionCheck.stderr || '').trim() : '';
  const authCheck = installed && authArgs ? await run(binary, authArgs, 8000) : null;
  const authenticated = authArgs ? Boolean(authCheck && authCheck.status === 0) : installed;
  const error = installed ? (authenticated ? '' : String(authCheck?.stderr || authCheck?.stdout || 'Authentication required.').trim()) : String(versionCheck.error?.message || versionCheck.stderr || `${name} was not found.`).trim();
  const value={binary,installed,authenticated,version,error};inspections.set(inspectionKey(binary,authArgs),{value,expires:Date.now()+30000});return {...value};
}
