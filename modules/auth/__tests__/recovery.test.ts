import { TEST_SCHOOL_CODE, TEST_USERNAME, TEST_PASSWORD } from '../../../tests/setup';
import * as fs from 'fs';
import * as path from 'path';

// Load module config - use GATEWAY_PORT env var if set, otherwise use module port.
const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../local.config.json'), 'utf8'));
const port = process.env.GATEWAY_PORT || config.httpPort;
const BASE_URL = `http://localhost:${port}/${config.prefix}`;

// The SS1 seed gives the test family father_mobile = family_unique_number = login
// username = TEST_USERNAME, so a parent OTP request for that phone resolves to it.
const TEST_PHONE = TEST_USERNAME;

const post = (url: string, body: any) =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-School-Code': TEST_SCHOOL_CODE },
    body: JSON.stringify(body),
  });

async function loginWorks(password: string): Promise<boolean> {
  const res = await post(`${BASE_URL}/student/login`, { username: TEST_USERNAME, password });
  return res.status === 200;
}

describe('Account Recovery API', () => {
  const requestUrl = `${BASE_URL}/recover/request-otp`;
  const verifyUrl = `${BASE_URL}/recover/verify-otp`;
  const setPwdUrl = `${BASE_URL}/recover/set-password`;

  describe('validation', () => {
    it('rejects an unknown userType', async () => {
      const res = await post(requestUrl, { userType: 'teacher', purpose: 'username', phone: TEST_PHONE });
      expect(res.status).toBe(400);
    });

    it('rejects a short phone number', async () => {
      const res = await post(requestUrl, { userType: 'parent', purpose: 'username', phone: '12345' });
      expect(res.status).toBe(400);
    });
  });

  describe('forgot username', () => {
    it('returns the username after a valid OTP', async () => {
      const reqRes = await post(requestUrl, { userType: 'parent', purpose: 'username', phone: TEST_PHONE });
      expect(reqRes.status).toBe(200);
      const reqData = await reqRes.json();
      expect(reqData.otpId).toBeTruthy();
      expect(reqData.devCode).toBeTruthy(); // OTP_DEV_ECHO=true locally

      const verRes = await post(verifyUrl, { otpId: reqData.otpId, code: reqData.devCode });
      expect(verRes.status).toBe(200);
      const verData = await verRes.json();
      expect(verData.purpose).toBe('username');
      expect(verData.usernames).toContain(TEST_USERNAME);
    });

    it('rejects a wrong OTP code', async () => {
      const reqRes = await post(requestUrl, { userType: 'parent', purpose: 'username', phone: TEST_PHONE });
      const reqData = await reqRes.json();
      const verRes = await post(verifyUrl, { otpId: reqData.otpId, code: '000000' });
      expect(verRes.status).toBe(400);
    });

    it('gives a generic 200 (no devCode) for a phone with no account', async () => {
      const reqRes = await post(requestUrl, { userType: 'parent', purpose: 'username', phone: '9000000001' });
      expect(reqRes.status).toBe(200);
      const reqData = await reqRes.json();
      expect(reqData.otpId).toBeTruthy();
      expect(reqData.devCode).toBeUndefined(); // nothing matched → no code echoed
    });
  });

  describe('forgot password', () => {
    it('resets the password end-to-end and the new password logs in', async () => {
      const newPassword = 'Recovered@789';
      try {
        const reqRes = await post(requestUrl, { userType: 'parent', purpose: 'password', phone: TEST_PHONE });
        const reqData = await reqRes.json();
        expect(reqData.devCode).toBeTruthy();

        const verRes = await post(verifyUrl, { otpId: reqData.otpId, code: reqData.devCode });
        expect(verRes.status).toBe(200);
        const verData = await verRes.json();
        expect(verData.purpose).toBe('password');
        expect(verData.resetToken).toBeTruthy();

        const setRes = await post(setPwdUrl, { resetToken: verData.resetToken, newPassword });
        expect(setRes.status).toBe(200);

        expect(await loginWorks(newPassword)).toBe(true);

        // A second set-password against the same (consumed) token must fail (one-shot).
        const replay = await post(setPwdUrl, { resetToken: verData.resetToken, newPassword: 'Another@111' });
        expect(replay.status).toBe(400);
      } finally {
        // Restore the seed password so other suites keep working, regardless of outcome.
        await restorePassword(newPassword);
      }
    });

    it('rejects a password shorter than the minimum', async () => {
      const reqRes = await post(requestUrl, { userType: 'parent', purpose: 'password', phone: TEST_PHONE });
      const reqData = await reqRes.json();
      const verRes = await post(verifyUrl, { otpId: reqData.otpId, code: reqData.devCode });
      const verData = await verRes.json();
      const setRes = await post(setPwdUrl, { resetToken: verData.resetToken, newPassword: '123' });
      expect(setRes.status).toBe(400);
    });
  });
});

// Best-effort: get a fresh OTP, reset the password back to the seed default.
async function restorePassword(currentNewPassword: string): Promise<void> {
  try {
    if (await loginWorks(TEST_PASSWORD)) return; // already correct
    const reqRes = await post(`${BASE_URL}/recover/request-otp`, { userType: 'parent', purpose: 'password', phone: TEST_PHONE });
    const reqData = await reqRes.json();
    if (!reqData.devCode) return;
    // Respect the 60s resend cooldown by waiting only if needed is overkill here; the
    // prior request in this suite was for verify, so a fresh request may hit cooldown.
    const verRes = await post(`${BASE_URL}/recover/verify-otp`, { otpId: reqData.otpId, code: reqData.devCode });
    const verData = await verRes.json();
    if (!verData.resetToken) return;
    await post(`${BASE_URL}/recover/set-password`, { resetToken: verData.resetToken, newPassword: TEST_PASSWORD });
  } catch {
    /* best effort */
  }
}
