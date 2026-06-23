import { TEST_SCHOOL_CODE } from '../../../tests/setup';
import * as fs from 'fs';
import * as path from 'path';

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../local.config.json'), 'utf8'));
const port = process.env.GATEWAY_PORT || config.httpPort;

export const BASE_URL = `http://localhost:${port}/${config.prefix}`;
export const headers = {
  'Content-Type': 'application/json',
  'X-School-Code': TEST_SCHOOL_CODE,
};

// Resolve a seeded category uuid by its code.
export async function categoryIdByCode(code: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/categories`, { headers });
  const data = await res.json();
  const cat = data.categories.find((c: any) => c.code === code);
  if (!cat) throw new Error(`Category "${code}" not found`);
  return cat.uuid;
}

// Create an item directly (bypassing the fuzzy guard with confirmNewItem).
export async function createItem(body: Record<string, any>): Promise<any> {
  const res = await fetch(`${BASE_URL}/items`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ confirmNewItem: true, ...body }),
  });
  if (res.status !== 200) {
    throw new Error(`createItem failed (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

export async function getItem(id: string): Promise<any> {
  const res = await fetch(`${BASE_URL}/items/${id}`, { headers });
  return res.json();
}

// A name unique to this test run, to avoid collisions with the seeded master.
export function uniqueName(prefix: string): string {
  return `${prefix} ${Date.now()}${Math.floor(Math.random() * 1000)}`;
}
