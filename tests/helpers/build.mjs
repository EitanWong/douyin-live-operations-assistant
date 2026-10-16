import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

// Every test process owns its build; Chrome's active development output is untouched.
export async function buildFixture() {
  const dist = await mkdtemp(join(tmpdir(), 'douyin-build-test-'));
  const cleanup = () => rm(dist, {recursive:true, force:true});
  try {
    await promisify(execFile)(process.execPath, [fileURLToPath(new URL('../../scripts/build.mjs', import.meta.url))], {env:{...process.env, DOUYIN_DIST_DIR:dist}});
    return {dist, cleanup};
  } catch (error) { await cleanup(); throw error; }
}
