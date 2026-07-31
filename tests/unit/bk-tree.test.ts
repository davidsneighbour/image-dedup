import { describe, expect, it } from "vitest";
import { BKTree } from "../../src/matching/bk-tree.js";

function numberDistance(a: number, b: number): number {
  return Math.abs(a - b);
}

describe("BKTree", () => {
  it("finds every item within the threshold distance of a query", () => {
    const tree = new BKTree<number>(numberDistance);
    for (const value of [10, 12, 15, 40, 42, 100]) {
      tree.insert(value);
    }

    // |10-11|=1, |12-11|=1, |15-11|=4 (all <= 4); |40-11|=29 and beyond are not.
    const results = tree
      .search(11, 4)
      .map((r) => r.item)
      .sort((a, b) => a - b);
    expect(results).toEqual([10, 12, 15]);
  });

  it("returns an empty array for an empty tree", () => {
    const tree = new BKTree<number>(numberDistance);
    expect(tree.search(5, 10)).toEqual([]);
  });

  it("returns no matches when nothing is within threshold", () => {
    const tree = new BKTree<number>(numberDistance);
    tree.insert(0);
    tree.insert(1000);
    expect(tree.search(500, 10)).toEqual([]);
  });

  it("groups items with distance 0 into the same node instead of dropping them", () => {
    const tree = new BKTree<{ id: string; value: number }>((a, b) =>
      numberDistance(a.value, b.value),
    );
    tree.insert({ id: "a", value: 5 });
    tree.insert({ id: "b", value: 5 });
    tree.insert({ id: "c", value: 5 });

    const results = tree.search({ id: "query", value: 5 }, 0);
    expect(results.map((r) => r.item.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("finds matches regardless of insertion order", () => {
    const values = [50, 5, 90, 12, 47, 3, 99, 51, 48];
    const tree = new BKTree<number>(numberDistance);
    for (const value of values) {
      tree.insert(value);
    }

    const results = tree.search(49, 3).sort((a, b) => a.item - b.item);
    expect(results.map((r) => r.item)).toEqual([47, 48, 50, 51]);
  });
});
