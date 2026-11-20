import { beforeEach, describe, expect, it } from "vitest";

import { MIN_SEPARATION, movers, PERSONAL_SPACE, stepMovers, type Mover } from "@/world/movement";

const mover = (x: number, z: number, path: Array<{ x: number; z: number }>, startedAt: number): Mover => ({
  x,
  z,
  heading: 0,
  path,
  node: "office-in" as Mover["node"],
  slot: null,
  spread: { x: 0, z: 0 },
  startedAt,
});

function simulate(seconds: number) {
  let minDist = Infinity;
  for (let t = 0; t < seconds; t += 1 / 60) {
    stepMovers(1 / 60);
    const [a, b] = [...movers.values()];
    minDist = Math.min(minDist, Math.hypot(a.x - b.x, a.z - b.z));
  }
  return minDist;
}

describe("agents keep their distance", () => {
  beforeEach(() => movers.clear());

  it("two agents on the same route at the same time don't walk into each other", () => {
    movers.set("kai", mover(0, 0, [{ x: 0, z: 10 }], 1));
    movers.set("rita", mover(0, 0.7, [{ x: 0, z: 11.2 }], 2)); // starts right ahead, same direction
    const minDist = simulate(8);
    expect(movers.get("kai")!.path).toHaveLength(0);
    expect(movers.get("rita")!.path).toHaveLength(0);
    expect(minDist).toBeGreaterThan(MIN_SEPARATION * 0.85); // never overlapping (bodies ~0.5 m wide)
  });

  it("head-on: one waits or steps aside, both arrive", () => {
    movers.set("a", mover(0, 0, [{ x: 0, z: 8 }], 1));
    movers.set("b", mover(0, 8, [{ x: 0, z: 0 }], 2));
    const minDist = simulate(12);
    expect(movers.get("a")!.path).toHaveLength(0);
    expect(movers.get("b")!.path).toHaveLength(0);
    expect(minDist).toBeGreaterThan(PERSONAL_SPACE * 0.5);
  });

  it("passes someone standing beside the route with distance", () => {
    movers.set("walker", mover(0, 0, [{ x: 0, z: 6 }], 1));
    movers.set("stander", mover(0.3, 3, [], 0)); // slightly off the line
    const minDist = simulate(8);
    expect(movers.get("walker")!.path).toHaveLength(0);
    expect(minDist).toBeGreaterThan(MIN_SEPARATION * 0.85);
  });

  it("walks around someone standing in the way", () => {
    movers.set("walker", mover(0, 0, [{ x: 0, z: 6 }], 1));
    movers.set("stander", mover(0, 3, [], 0));
    const minDist = simulate(8);
    expect(movers.get("walker")!.path).toHaveLength(0);
    expect(minDist).toBeGreaterThan(PERSONAL_SPACE * 0.5);
  });
});
