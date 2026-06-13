import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LOG_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'error.log');

// An error whose message is safe to show to the user (no implementation
// details). Anything not created through this shows as a generic message.
export function userError(message, status = 500) {
  const err = new Error(message);
  err.status = status;
  err.expose = true;
  return err;
}

export function logError(context, err) {
  const entry = `[${new Date().toISOString()}] ${context}: ${err?.stack ?? err}\n`;
  console.error(entry.trimEnd());
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, entry);
  } catch {
    // logging must never crash the request
  }
}
