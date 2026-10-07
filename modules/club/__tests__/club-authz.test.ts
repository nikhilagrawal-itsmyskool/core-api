import { can } from "../../../shared/lib/authz-policy";

// ── Policy: locked-down defaults (everything god-first; god opens up via the grid) ──
const ALL_CLUB_ACTIONS = [
  "club.setup.view", "club.setup.manage",
  "club.activity.view", "club.activity.manage", "club.activity.approve", "club.activity.review",
  "club.plan.view", "club.plan.manage", "club.plan.publish", "club.plan.conduct",
];

describe("club authorization policy", () => {
  it("god can do every club action", () => {
    for (const a of ALL_CLUB_ACTIONS) expect(can(["god"], a)).toBe(true);
  });

  it("admin has NOTHING by default (locked to god; granted via the grid)", () => {
    for (const a of ALL_CLUB_ACTIONS) expect(can(["admin"], a)).toBe(false);
  });

  it("club-incharge is read-only across the three resources", () => {
    expect(can(["club-incharge"], "club.setup.view")).toBe(true);
    expect(can(["club-incharge"], "club.activity.view")).toBe(true);
    expect(can(["club-incharge"], "club.plan.view")).toBe(true);
    // ...and nothing that writes
    for (const a of ["club.setup.manage", "club.activity.manage", "club.activity.approve",
      "club.activity.review", "club.plan.manage", "club.plan.publish", "club.plan.conduct"]) {
      expect(can(["club-incharge"], a)).toBe(false);
    }
  });

  it("teacher can only conduct", () => {
    expect(can(["teacher"], "club.plan.conduct")).toBe(true);
    expect(can(["teacher"], "club.activity.view")).toBe(false);
    expect(can(["teacher"], "club.setup.view")).toBe(false);
    expect(can(["teacher"], "club.plan.view")).toBe(false);
  });
});

// ── guard(): the wiring actually blocks (403) a role that lacks the action, and 401s an
// unauthenticated caller. Uses the offline fallback to synthesize a role-bearing caller.
describe("club guard() enforcement", () => {
  const invoke = (handlerExport: any, roles: string | undefined): Promise<any> =>
    new Promise((resolve) => {
      const event: any = {
        headers: {},
        requestContext: roles ? { authorizer: { context: { type: "employee", roles } } } : {},
        pathParameters: {},
        queryStringParameters: {},
      };
      handlerExport(event, { callbackWaitsForEmptyEventLoop: true }, (_e: any, res: any) => resolve(res));
    });

  const prev = process.env.IS_OFFLINE;
  beforeAll(() => { process.env.IS_OFFLINE = "true"; });
  afterAll(() => { process.env.IS_OFFLINE = prev; });

  it("blocks a teacher from creating a club (403)", async () => {
    const { createClub } = require("../club-handler");
    const res = await invoke(createClub, "teacher");
    expect(res.statusCode).toBe(403);
  });

  it("blocks a teacher from listing the activity bank (403)", async () => {
    const { listActivities } = require("../club-activity-handler");
    const res = await invoke(listActivities, "teacher");
    expect(res.statusCode).toBe(403);
  });

  it("blocks a club-incharge from managing clubs — club.setup.manage denied (403)", async () => {
    const { updateClub } = require("../club-handler");
    const res = await invoke(updateClub, "club-incharge");
    expect(res.statusCode).toBe(403);
  });

  it("401s when there is no authenticated caller", async () => {
    process.env.IS_OFFLINE = "false";
    const { listClubs } = require("../club-handler");
    const res = await invoke(listClubs, undefined);
    expect(res.statusCode).toBe(401);
    process.env.IS_OFFLINE = "true";
  });
});
