const { getSchedule, listSchedules } = require("../src/scheduler/runner");

describe("scheduler runner", () => {
  test("exposes only registered schedules", () => {
    const schedules = listSchedules();
    expect(schedules.map((s) => s.id)).toEqual(
      expect.arrayContaining(["crm-auto-dial", "crm-dialer-retry"])
    );
    expect(getSchedule("does-not-exist")).toBeNull();
  });
});
