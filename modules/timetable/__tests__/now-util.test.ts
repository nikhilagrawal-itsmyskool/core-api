import { localParts, timeToMinutes, pickNowNext } from "../now-util";

// Pure logic — no server or DB needed.
describe("now-util — school-local time math", () => {
  it("reads an instant as IST wall-clock (UTC+5:30)", () => {
    // 04:00Z + 5:30 = 09:30 IST on the same date (Wed 2026-07-15).
    const p = localParts(new Date("2026-07-15T04:00:00Z"));
    expect(p.dateStr).toBe("2026-07-15");
    expect(p.minutes).toBe(9 * 60 + 30);
    expect(p.dayOfWeek).toBe(3); // Wednesday
  });

  it("rolls the local date/day forward when IST crosses midnight", () => {
    // 20:00Z + 5:30 = 01:30 IST the next day (Thu 2026-07-16).
    const p = localParts(new Date("2026-07-15T20:00:00Z"));
    expect(p.dateStr).toBe("2026-07-16");
    expect(p.minutes).toBe(90);
    expect(p.dayOfWeek).toBe(4); // Thursday
  });

  it("maps Sunday to 7 (not 0)", () => {
    const p = localParts(new Date("2026-07-19T06:00:00Z")); // Sun 11:30 IST
    expect(p.dayOfWeek).toBe(7);
  });
});

describe("now-util — timeToMinutes", () => {
  it("parses HH:MM:SS to minutes-of-day", () => {
    expect(timeToMinutes("08:00:00")).toBe(480);
    expect(timeToMinutes("13:45:00")).toBe(825);
  });
  it("returns null for missing/blank times", () => {
    expect(timeToMinutes(null)).toBeNull();
    expect(timeToMinutes(undefined)).toBeNull();
    expect(timeToMinutes("")).toBeNull();
  });
});

describe("now-util — pickNowNext", () => {
  const slots = [
    { startMin: 480, endMin: 520 }, // 08:00–08:40
    { startMin: 520, endMin: 560 }, // 08:40–09:20
    { startMin: 600, endMin: 640 }, // 10:00–10:40 (gap before it)
  ];

  it("brackets the current slot and finds the next", () => {
    expect(pickNowNext(slots, 500)).toEqual({ nowIdx: 0, nextIdx: 1 });
  });
  it("end is exclusive; in a gap there is no now but there is a next", () => {
    expect(pickNowNext(slots, 560)).toEqual({ nowIdx: -1, nextIdx: 2 });
  });
  it("after the last slot there is no now and no next", () => {
    expect(pickNowNext(slots, 620)).toEqual({ nowIdx: 2, nextIdx: -1 });
  });
  it("before school there is no now, next is the first slot", () => {
    expect(pickNowNext(slots, 400)).toEqual({ nowIdx: -1, nextIdx: 0 });
  });
  it("ignores slots without configured times", () => {
    const withNull = [{ startMin: null, endMin: null }, ...slots];
    expect(pickNowNext(withNull, 500)).toEqual({ nowIdx: 1, nextIdx: 2 });
  });
});
