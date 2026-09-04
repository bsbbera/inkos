import { describe, expect, it } from "vitest";
import { seamDrag } from "../workflow";

const sum = (a: readonly number[]) => a.reduce((n, w) => n + w, 0);

describe("seamDrag", () => {
  it("keeps the shares summing to the column count, so equal is 1,1,1", () => {
    const out = seamDrag([600, 600, 600], 0, 0, 220)!;
    expect(sum(out)).toBeCloseTo(3);
    expect(out).toEqual([1, 1, 1]);
  });

  it("moves width between the pair either side of the seam only", () => {
    const out = seamDrag([600, 600, 600], 0, 120, 220)!;
    // 720 / 480 / 600 of 1800 -> 1.2 / 0.8 / 1.0
    expect(out[0]).toBeCloseTo(1.2);
    expect(out[1]).toBeCloseTo(0.8);
    expect(out[2]).toBeCloseTo(1);
  });

  it("is the same answer at any window width, which pixels were not", () => {
    // The same one-fifth-of-a-column drag on a narrow and a wide monitor.
    const narrow = seamDrag([300, 300, 300], 0, 60, 100)!;
    const wide = seamDrag([900, 900, 900], 0, 180, 100)!;
    narrow.forEach((s, i) => expect(s).toBeCloseTo(wide[i]!));
  });

  it("will not crush a column below the minimum", () => {
    const out = seamDrag([600, 600, 600], 0, 5000, 220)!;
    const px = out.map((s) => (s / 3) * 1800);
    expect(Math.min(...px)).toBeGreaterThanOrEqual(220 - 0.001);
    expect(px[0]).toBeCloseTo(980); // 1200 of room, less the 220 the neighbour keeps
  });

  it("refuses a seam with no room to move", () => {
    expect(seamDrag([200, 200], 0, 40, 220)).toBeNull();
    expect(seamDrag([600, 600], 1, 40, 220)).toBeNull(); // no column after the last
  });
});
