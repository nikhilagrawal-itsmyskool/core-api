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

// Resolve a (seeded) asset type uuid by its code.
export async function typeIdByCode(code: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/lookups/types`, { headers });
  const data = await res.json();
  const type = data.types.find((t: any) => t.code === code);
  if (!type) throw new Error(`Asset type "${code}" not found`);
  return type.uuid;
}

// Create an asset and return the parsed body.
export async function createAsset(body: Record<string, any>): Promise<any> {
  const res = await fetch(`${BASE_URL}/assets`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (res.status !== 200) {
    throw new Error(`createAsset failed (${res.status}): ${await res.text()}`);
  }
  return res.json();
}
