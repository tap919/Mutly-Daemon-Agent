import fs from "fs/promises";
import path from "path";

const writeLocks = new Map<string, Promise<void>>();

export function getDataPath(filename: string): string {
  const base = process.env.MUTLY_DATA_DIR ?? path.join(process.cwd(), "data");
  return path.join(base, filename);
}

export async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
  await fs.rename(tmp, filePath);
}

export async function withFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const prev = writeLocks.get(filePath) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  writeLocks.set(filePath, prev.then(() => gate));
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (writeLocks.get(filePath) === gate) {
      writeLocks.delete(filePath);
    }
  }
}
