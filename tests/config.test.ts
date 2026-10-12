import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {describe, expect, it} from 'vitest';

describe('项目数据目录', () => {
  it('拒绝把数据库和缓存放到项目 data/ 之外', () => {
    const root = path.resolve(process.cwd());
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', "import './src/config.ts'"], {
      cwd: root, env: {...process.env, DATA_DIR: '../outside'}, encoding: 'utf8',
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('DATA_DIR 必须位于项目的 data/ 目录内');
  });
});
