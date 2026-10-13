import { describe, expect, it } from "vitest";
import { smoothPath } from "./line-chart";

/** The curve's y at many points along each segment (cubic Bézier). */
function samples(d: string): number[] {
  const nums = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
  const ys: number[] = [];
  let py = nums[1];
  for (let i = 2; i + 6 <= nums.length; i += 6) {
    const [, y1, , y2, , y3] = nums.slice(i, i + 6);
    for (let t = 0; t <= 1; t += 0.05) {
      const u = 1 - t;
      ys.push(u * u * u * py + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3);
    }
    py = y3;
  }
  return ys;
}

describe("smoothPath", () => {
  it("curves through the points without going past them", () => {
    // y grows downwards: 100 is the zero line, 20 a peak.
    const pts = [100, 100, 20, 100, 100, 60].map((y, i) => ({ x: i * 50, y }));
    const d = smoothPath(pts);
    expect(d.startsWith("M0.0,100.0C")).toBe(true);
    expect(d).toContain("C");
    const ys = samples(d);
    expect(Math.max(...ys)).toBeLessThanOrEqual(100.01);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(19.99);
  });

  it("draws one or two points as straight lines", () => {
    expect(smoothPath([{ x: 0, y: 5 }])).toBe("M0.0,5.0");
    expect(
      smoothPath([
        { x: 0, y: 5 },
        { x: 10, y: 0 },
      ]),
    ).toBe("M0.0,5.0L10.0,0.0");
  });
});
