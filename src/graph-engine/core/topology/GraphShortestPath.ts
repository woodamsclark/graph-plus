export function shortestPathToAnyV1(
  startId: string,
  targetIds: ReadonlySet<string>,
  relationships: ReadonlyMap<string, ReadonlySet<string>>,
): readonly string[] | undefined {
  if (targetIds.has(startId)) return [startId];
  const previous = new Map<string, string | undefined>([[startId, undefined]]);
  const queue = [startId];
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    for (const neighbor of [...(relationships.get(current) ?? [])].sort()) {
      if (previous.has(neighbor)) continue;
      previous.set(neighbor, current);
      if (targetIds.has(neighbor)) return reconstructPath(neighbor, previous);
      queue.push(neighbor);
    }
  }
  return undefined;
}

function reconstructPath(
  targetId: string,
  previous: ReadonlyMap<string, string | undefined>,
): readonly string[] {
  const path: string[] = [];
  let current: string | undefined = targetId;
  while (current !== undefined) {
    path.push(current);
    current = previous.get(current);
  }
  return path.reverse();
}
