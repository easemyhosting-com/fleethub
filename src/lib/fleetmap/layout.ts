export type Rect = { x: number; y: number; w: number; h: number };
export type Weighted = { id: string; weight: number };
export type Placed = Rect & { id: string };

/** Squarified treemap (Bruls, Huizing, van Wijk): tiles stay close to square so labels fit. Weights must be positive. */
export function squarify(items: readonly Weighted[], rect: Rect): Placed[] {
  const sorted = items.filter(item => item.weight > 0).sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id));
  if (!sorted.length || rect.w <= 0 || rect.h <= 0) return [];
  const total = sorted.reduce((sum, item) => sum + item.weight, 0);
  const scale = (rect.w * rect.h) / total;
  const areas = sorted.map(item => ({ id: item.id, area: item.weight * scale }));
  const placed: Placed[] = [];
  let free = { ...rect };
  let row: typeof areas = [];

  const worst = (rowAreas: number[], side: number) => {
    const sum = rowAreas.reduce((a, b) => a + b, 0);
    const max = Math.max(...rowAreas), min = Math.min(...rowAreas);
    return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
  };
  const flush = () => {
    if (!row.length) return;
    const sum = row.reduce((a, b) => a + b.area, 0);
    const horizontal = free.w >= free.h; // lay the row along the shorter side
    if (horizontal) {
      const width = sum / free.h; let y = free.y;
      for (const item of row) { const h = item.area / width; placed.push({ id: item.id, x: free.x, y, w: width, h }); y += h; }
      free = { x: free.x + width, y: free.y, w: free.w - width, h: free.h };
    } else {
      const height = sum / free.w; let x = free.x;
      for (const item of row) { const w = item.area / height; placed.push({ id: item.id, x, y: free.y, w, h: height }); x += w; }
      free = { x: free.x, y: free.y + height, w: free.w, h: free.h - height };
    }
    row = [];
  };
  for (const item of areas) {
    const side = Math.min(free.w, free.h);
    if (!row.length || worst([...row.map(r => r.area), item.area], side) <= worst(row.map(r => r.area), side)) row.push(item);
    else { flush(); row.push(item); }
  }
  flush();
  return placed;
}

export type Group<T> = { key: string; label: string; items: T[] };
export type PlacedGroup<T> = { key: string; label: string; rect: Rect; tiles: (Placed & { item: T })[] };

/** Lays out groups by their total weight, then each group's items inside its body, leaving room for a header strip. */
export function layoutGroups<T extends { id: string; weight: number }>(groups: readonly Group<T>[], rect: Rect, headerHeight = 22, gap = 3): PlacedGroup<T>[] {
  const outer = squarify(groups.map(group => ({ id: group.key, weight: group.items.reduce((sum, item) => sum + item.weight, 0) })), rect);
  return outer.flatMap(box => {
    const group = groups.find(candidate => candidate.key === box.id);
    if (!group) return [];
    const body = { x: box.x + gap, y: box.y + headerHeight, w: Math.max(0, box.w - gap * 2), h: Math.max(0, box.h - headerHeight - gap) };
    const byId = new Map(group.items.map(item => [item.id, item]));
    const tiles = squarify(group.items, body).flatMap(tile => { const item = byId.get(tile.id); return item ? [{ ...tile, item }] : []; });
    return [{ key: group.key, label: group.label, rect: { x: box.x, y: box.y, w: box.w, h: box.h }, tiles }];
  });
}
