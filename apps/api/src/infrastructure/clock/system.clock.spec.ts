import { SystemClock } from "./system.clock";

describe("SystemClock", () => {
  it("devuelve la hora real del sistema", () => {
    const clock = new SystemClock();
    const before = Date.now();

    const now = clock.now();

    const after = Date.now();

    expect(now).toBeInstanceOf(Date);
    expect(now.getTime()).toBeGreaterThanOrEqual(before);
    expect(now.getTime()).toBeLessThanOrEqual(after);
  });

  it("devuelve una nueva instancia en cada llamado", () => {
    const clock = new SystemClock();

    const a = clock.now();
    const b = clock.now();

    expect(a).not.toBe(b);
  });
});
