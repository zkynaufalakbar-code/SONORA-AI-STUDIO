import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / 1024 ** idx;
  return `${val >= 100 ? val.toFixed(0) : val >= 10 ? val.toFixed(1) : val.toFixed(2)} ${units[idx]}`;
}

export function formatDb(db: number): string {
  if (!Number.isFinite(db) || db <= -96) return '-inf dB';
  return `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`;
}

export function dbToLinear(db: number): number {
  if (db <= -96) return 0;
  return Math.pow(10, db / 20);
}

export function linearToDb(lin: number): number {
  if (lin <= 1e-5) return -100;
  return 20 * Math.log10(lin);
}
