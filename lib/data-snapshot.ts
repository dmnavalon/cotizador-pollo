import fs from 'fs';
import path from 'path';
import type { DataSnapshot } from './types';

const DATA_FILE = path.join(process.cwd(), 'data', 'products.json');

export function readSnapshot(): DataSnapshot | null {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(raw) as DataSnapshot;
  } catch {
    return null;
  }
}

export function writeLocalSnapshot(snapshot: DataSnapshot): void {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(snapshot, null, 2));
}
