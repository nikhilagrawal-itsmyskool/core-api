import * as fs from 'fs';
import * as path from 'path';

// Load dev environment variables
const configPath = path.join(__dirname, '../configs/dev/dev.yml');
const configContent = fs.readFileSync(configPath, 'utf8');

// Simple YAML parser for key: value pairs
const lines = configContent.split('\n');
for (const line of lines) {
  const match = line.match(/^(\w+):\s*['"]?([^'"]+)['"]?\s*$/);
  if (match) {
    const [, key, value] = match;
    process.env[key] = value;
  }
}

// Set JWT config for tests
process.env.JWT_SECRET = 'test-secret-key';
process.env.JWT_ADMIN_EXPIRY_TIME = '1h';
process.env.JWT_MAGIC_KEY = 'test-magic-key';

// Shared test credentials
export const TEST_SCHOOL_CODE = 'SS1';
export const TEST_USERNAME = '8373919559';
export const TEST_PASSWORD = 'Itsmyskool@123';
