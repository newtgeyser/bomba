import fs from 'node:fs/promises';
import path from 'node:path';

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

export async function createDataStore(rootDir) {
  await ensureDir(rootDir);
  const dirs = {
    rootDir,
    schemes: path.join(rootDir, 'schemes'),
    reports: path.join(rootDir, 'reports'),
    ratings: path.join(rootDir, 'ratings'),
    replays: path.join(rootDir, 'replays'),
  };
  await Promise.all(Object.values(dirs).map((d) => ensureDir(d)));

  return {
    dirs,
    async writeJson(filePath, data) {
      const tmp = `${filePath}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
      await fs.rename(tmp, filePath);
    },
    async readJson(filePath) {
      const raw = await fs.readFile(filePath, 'utf8');
      return JSON.parse(raw);
    },
    async listJsonFiles(dir) {
      const names = await fs.readdir(dir);
      return names.filter((n) => n.endsWith('.json'));
    },
    async exists(filePath) {
      try {
        await fs.stat(filePath);
        return true;
      } catch {
        return false;
      }
    },
  };
}

