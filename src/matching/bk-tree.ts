/**
 * BK-tree over a metric distance function (here: Hamming distance between
 * perceptual hashes). Lets `search(query, threshold)` find every item
 * within `threshold` of `query` without comparing against every item in
 * the tree — required so candidate generation can scale to tens of
 * thousands of files without an all-pairs comparison (PLAN.md §10.3).
 *
 * Items whose distance to an existing node is exactly 0 (identical hash)
 * are stored together in that node rather than becoming a child: since
 * Hamming distance is a proper metric, two items with distance 0 between
 * them are equidistant from any third point, so grouping them costs
 * nothing and avoids the tree growing pathologically deep on hash
 * collisions (which are common — many resize/recompress variants of the
 * same source hash identically).
 */

interface BKTreeNode<T> {
  items: T[];
  children: Map<number, BKTreeNode<T>>;
}

export class BKTree<T> {
  private root: BKTreeNode<T> | undefined;

  constructor(private readonly distance: (a: T, b: T) => number) {}

  insert(item: T): void {
    if (!this.root) {
      this.root = { items: [item], children: new Map() };
      return;
    }

    let node = this.root;
    for (;;) {
      const representative = node.items[0];
      if (representative === undefined) {
        node.items.push(item);
        return;
      }
      const d = this.distance(representative, item);
      if (d === 0) {
        node.items.push(item);
        return;
      }
      const child = node.children.get(d);
      if (!child) {
        node.children.set(d, { items: [item], children: new Map() });
        return;
      }
      node = child;
    }
  }

  /** Every item within `threshold` of `query`, including 0-distance (identical hash) matches. */
  search(query: T, threshold: number): Array<{ item: T; distance: number }> {
    const results: Array<{ item: T; distance: number }> = [];
    if (!this.root) {
      return results;
    }

    const stack: BKTreeNode<T>[] = [this.root];
    while (stack.length > 0) {
      const node = stack.pop();
      if (!node) {
        continue;
      }
      const representative = node.items[0];
      if (representative === undefined) {
        continue;
      }
      const d = this.distance(representative, query);
      if (d <= threshold) {
        for (const item of node.items) {
          results.push({ item, distance: d });
        }
      }
      const low = d - threshold;
      const high = d + threshold;
      for (const [childDistance, child] of node.children) {
        if (childDistance >= low && childDistance <= high) {
          stack.push(child);
        }
      }
    }
    return results;
  }
}
