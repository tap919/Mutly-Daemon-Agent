import fs from 'fs';
import path from 'path';
import type { RealityReport } from '../types';

const DB_FILE_PATH = path.join(process.cwd(), 'data', 'scans_db.json');

// Ensure parent directory exists
function ensureDbExists() {
  const dir = path.dirname(DB_FILE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(DB_FILE_PATH)) {
    fs.writeFileSync(DB_FILE_PATH, JSON.stringify([], null, 2), 'utf-8');
  }
}

export async function saveScan(report: RealityReport): Promise<void> {
  ensureDbExists();
  const data = await fs.promises.readFile(DB_FILE_PATH, 'utf-8');
  const scans: RealityReport[] = JSON.parse(data);
  scans.unshift(report); // Put latest first
  await fs.promises.writeFile(DB_FILE_PATH, JSON.stringify(scans, null, 2), 'utf-8');
}

export async function getScan(id: string): Promise<RealityReport | null> {
  ensureDbExists();
  const data = await fs.promises.readFile(DB_FILE_PATH, 'utf-8');
  const scans: RealityReport[] = JSON.parse(data);
  return scans.find((s) => s.id === id) || null;
}

export async function listScans(): Promise<RealityReport[]> {
  ensureDbExists();
  const data = await fs.promises.readFile(DB_FILE_PATH, 'utf-8');
  return JSON.parse(data);
}
