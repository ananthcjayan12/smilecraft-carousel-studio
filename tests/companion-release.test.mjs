import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const script = path.resolve('apps/companion-desktop/scripts/publish-release.sh');
for (const state of ['published', 'draft', 'missing', 'bad-checksum']) {
  test(`companion release publishing handles ${state}`, async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'companion-release-'));
    try {
      await mkdir(path.join(dir, 'installers')); await mkdir(path.join(dir, 'bin'));
      const bytes = Buffer.from('latest installer');
      await writeFile(path.join(dir, 'installers', 'companion.dmg'), bytes);
      const checksum = createHash('sha256').update(state === 'bad-checksum' ? 'older installer' : bytes).digest('hex');
      await writeFile(path.join(dir, 'installers', 'companion.dmg.sha256'), `${checksum}  companion.dmg\n`);
      const log = path.join(dir, 'gh.jsonl');
      await writeFile(path.join(dir, 'bin', 'gh'), '#!' + process.execPath + '\n' + `
        const fs = require('node:fs');
        const args = process.argv.slice(2);
        fs.appendFileSync(process.env.RELEASE_TEST_LOG, JSON.stringify(args) + '\\n');
        if (args[1] === 'view' && process.env.RELEASE_TEST_STATE === 'missing') process.exit(1);
      `, { mode: 0o700 });
      const result = spawnSync('bash', [script], { cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: path.join(dir, 'bin') + path.delimiter + process.env.PATH, RELEASE_TAG: 'companion-v0.1.0', RELEASE_TEST_STATE: state, RELEASE_TEST_LOG: log } });
      if (state === 'bad-checksum') {
        assert.notEqual(result.status, 0);
        await assert.rejects(readFile(log), { code: 'ENOENT' });
        return;
      }
      assert.equal(result.status, 0, result.stderr);
      const calls = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
      assert.deepEqual(calls.map(args => args[1]), state === 'missing' ? ['view', 'create', 'upload', 'edit'] : ['view', 'upload', 'edit']);
      assert.ok(calls.every(args => args[2] === 'companion-v0.1.0'));
      assert.ok(calls.find(args => args[1] === 'upload').includes('--clobber'));
      assert.ok(calls.find(args => args[1] === 'edit').includes('--draft=false'));
      if (state === 'missing') assert.ok(calls.find(args => args[1] === 'create').includes('--verify-tag'));
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
}
