import { requireAction } from "../../auth/authz";
import { OUTREACH_ACTIONS } from "../outreach-actions";

// Role matrix through the real requireAction (offline authorizer-override context injects
// roles). Verifies: admin + moments-incharge own the module (view/post/manage); class-teacher
// and a plain teacher have NO Moments access (it is not class-teacher scoped); god has all.

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

describe("outreach authorization (guard end-to-end)", () => {
  it("admin: full module (compose to any audience + reads)", () => {
    expect(result("admin", OUTREACH_ACTIONS["outreach-handler.createMoment"])).toBe("allowed");
    expect(result("admin", OUTREACH_ACTIONS["outreach-handler.listMoments"])).toBe("allowed");
  });

  it("moments-incharge: owns the module (view/post/manage)", () => {
    expect(result("moments-incharge", OUTREACH_ACTIONS["outreach-handler.createMoment"])).toBe("allowed");
    expect(result("moments-incharge", OUTREACH_ACTIONS["outreach-handler.listMoments"])).toBe("allowed");
    expect(result("moments-incharge", OUTREACH_ACTIONS["outreach-handler.publish"])).toBe("allowed");
  });

  it("class-teacher: no Moments access (not class-teacher scoped) -> 403", () => {
    expect(result("class-teacher", OUTREACH_ACTIONS["outreach-handler.createMoment"])).toBe(403);
    expect(result("class-teacher", OUTREACH_ACTIONS["outreach-me-handler.createMoment"])).toBe(403);
    expect(result("class-teacher", OUTREACH_ACTIONS["outreach-handler.listMoments"])).toBe(403);
  });

  it("plain teacher: no access -> 403", () => {
    expect(result("teacher", OUTREACH_ACTIONS["outreach-handler.createMoment"])).toBe(403);
    expect(result("teacher", OUTREACH_ACTIONS["outreach-handler.listMoments"])).toBe(403);
  });

  it("god: everything", () => {
    expect(result("god", OUTREACH_ACTIONS["outreach-handler.createMoment"])).toBe("allowed");
    expect(result("god", OUTREACH_ACTIONS["outreach-me-handler.publish"])).toBe("allowed");
  });
});
