import { requireAction } from "../../auth/authz";
import { WEBSITE_ACTIONS } from "../website-actions";

// Role matrix through the real requireAction. website.publish is NOT on admin by default
// (god-first + the dedicated website-incharge role), so the tool stays out of the sellable core.

const prevOffline = process.env.IS_OFFLINE;
beforeAll(() => { process.env.IS_OFFLINE = "true"; });
afterAll(() => { process.env.IS_OFFLINE = prevOffline; });

function result(roles: string, action: string): number | "allowed" {
  let status: number | "allowed" = "allowed";
  const cb = (_e: any, res: any) => { if (res && res.statusCode) status = res.statusCode; };
  const ev: any = {
    headers: { "X-School-Code": "DBPASN" },
    requestContext: { authorizer: { principalId: "u1", context: { type: "employee", roles } } },
  };
  return requireAction(ev, action, cb as any) ? "allowed" : status;
}

describe("website authorization (guard end-to-end)", () => {
  it("website-incharge: can use the publisher", () => {
    expect(result("website-incharge", WEBSITE_ACTIONS["website-handler.pushEvent"])).toBe("allowed");
    expect(result("website-incharge", WEBSITE_ACTIONS["website-handler.listPublications"])).toBe("allowed");
  });

  it("admin: NO access by default (kept out of the sellable core) -> 403", () => {
    expect(result("admin", WEBSITE_ACTIONS["website-handler.pushEvent"])).toBe(403);
  });

  it("teacher: no access -> 403", () => {
    expect(result("teacher", WEBSITE_ACTIONS["website-handler.pushEvent"])).toBe(403);
  });

  it("god: everything", () => {
    expect(result("god", WEBSITE_ACTIONS["website-handler.pushEvent"])).toBe("allowed");
  });
});
