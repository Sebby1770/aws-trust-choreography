/**
 * Automatic layout — a layered ("Sugiyama-style") arrangement.
 *
 * 1. Break cycles so the graph is a DAG (reversing back edges found by DFS).
 * 2. Assign each vertex a layer by longest path from the sources, so traffic
 *    reads left to right (or top to bottom) from entry points to data.
 * 3. Order vertices within each layer by the barycentre of their neighbours
 *    over several sweeps, which removes most crossings.
 * 4. Place layers using real vertex sizes, centring each layer on the others.
 *
 * Containers are laid out as single blocks: their contents move with them.
 */

/**
 * @param {Array<{id: string, w: number, h: number}>} items
 * @param {Array<{from: string, to: string}>} links between item ids
 * @param {{direction?: "LR"|"TB", layerGap?: number, nodeGap?: number, origin?: {x: number, y: number}}} options
 * @returns {Map<string, {x: number, y: number}>} new top-left per item
 */
export function layeredLayout(items, links, options = {}) {
  const direction = options.direction === "TB" ? "TB" : "LR";
  const layerGap = options.layerGap ?? 110;
  const nodeGap = options.nodeGap ?? 56;
  const origin = options.origin || { x: 0, y: 0 };
  const ids = items.map((item) => item.id);
  const known = new Set(ids);
  const edges = [];
  const seenEdges = new Set();
  for (const link of links) {
    if (!known.has(link.from) || !known.has(link.to) || link.from === link.to) continue;
    const key = `${link.from}>${link.to}`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    edges.push({ from: link.from, to: link.to });
  }

  // 1. Cycle breaking.
  const outgoing = new Map(ids.map((id) => [id, []]));
  edges.forEach((edge) => outgoing.get(edge.from).push(edge));
  const state = new Map();
  const reversed = new Set();
  const visit = (id) => {
    state.set(id, 1);
    for (const edge of outgoing.get(id)) {
      const next = state.get(edge.to);
      if (next === 1) reversed.add(edge);
      else if (!next) visit(edge.to);
    }
    state.set(id, 2);
  };
  ids.forEach((id) => {
    if (!state.get(id)) visit(id);
  });
  const dag = edges.map((edge) => (reversed.has(edge) ? { from: edge.to, to: edge.from } : edge));

  // 2. Longest-path layering.
  const incoming = new Map(ids.map((id) => [id, []]));
  const forward = new Map(ids.map((id) => [id, []]));
  dag.forEach((edge) => {
    incoming.get(edge.to).push(edge.from);
    forward.get(edge.from).push(edge.to);
  });
  const layer = new Map();
  const indegree = new Map(ids.map((id) => [id, incoming.get(id).length]));
  const queue = ids.filter((id) => indegree.get(id) === 0);
  queue.forEach((id) => layer.set(id, 0));
  while (queue.length) {
    const id = queue.shift();
    for (const next of forward.get(id)) {
      layer.set(next, Math.max(layer.get(next) ?? 0, layer.get(id) + 1));
      indegree.set(next, indegree.get(next) - 1);
      if (indegree.get(next) === 0) queue.push(next);
    }
  }
  ids.forEach((id) => {
    if (!layer.has(id)) layer.set(id, 0);
  });
  // Pull pure sinks toward their sources so leaves do not drift right.
  for (const id of ids) {
    if (forward.get(id).length || !incoming.get(id).length) continue;
    const minimum = Math.max(...incoming.get(id).map((source) => layer.get(source))) + 1;
    layer.set(id, minimum);
  }

  const layerCount = Math.max(0, ...layer.values()) + 1;
  const layers = Array.from({ length: layerCount }, () => []);
  ids.forEach((id) => layers[layer.get(id)].push(id));

  // 3. Barycentre ordering.
  const position = new Map();
  const reindex = () =>
    layers.forEach((list) => list.forEach((id, index) => position.set(id, index)));
  reindex();
  const neighbours = (id, upward) => (upward ? incoming.get(id) : forward.get(id));
  for (let sweep = 0; sweep < 6; sweep += 1) {
    const upward = sweep % 2 === 0;
    const range = upward ? layers.keys() : [...layers.keys()].reverse();
    for (const index of range) {
      const list = layers[index];
      const scored = list.map((id, current) => {
        const around = neighbours(id, upward).map((other) => position.get(other));
        const score = around.length
          ? around.reduce((sum, value) => sum + value, 0) / around.length
          : current;
        return { id, score, current };
      });
      scored.sort((a, b) => a.score - b.score || a.current - b.current);
      layers[index] = scored.map((entry) => entry.id);
      reindex();
    }
  }

  // 4. Coordinates.
  const size = new Map(items.map((item) => [item.id, item]));
  const along = (id) => (direction === "LR" ? size.get(id).w : size.get(id).h);
  const across = (id) => (direction === "LR" ? size.get(id).h : size.get(id).w);
  const layerThickness = layers.map((list) => Math.max(0, ...list.map(along)));
  const layerSpan = layers.map(
    (list) => list.reduce((sum, id) => sum + across(id), 0) + nodeGap * Math.max(0, list.length - 1)
  );
  const widest = Math.max(0, ...layerSpan);
  const result = new Map();
  let cursor = 0;
  layers.forEach((list, index) => {
    let offset = (widest - layerSpan[index]) / 2;
    for (const id of list) {
      const inLayer = cursor + (layerThickness[index] - along(id)) / 2;
      const point = direction === "LR" ? { x: inLayer, y: offset } : { x: offset, y: inLayer };
      result.set(id, { x: Math.round(origin.x + point.x), y: Math.round(origin.y + point.y) });
      offset += across(id) + nodeGap;
    }
    cursor += layerThickness[index] + layerGap;
  });
  return result;
}
