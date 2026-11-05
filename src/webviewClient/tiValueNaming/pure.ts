export function groupByProcess<T extends { process: string }>(
  list: T[]
): Array<{ process: string; vars: T[] }> {
  const order: string[] = [];
  const map = new Map<string, T[]>();
  for (const item of list) {
    let arr = map.get(item.process);
    if (!arr) {
      arr = [];
      map.set(item.process, arr);
      order.push(item.process);
    }
    arr.push(item);
  }
  return order.map(process => ({ process, vars: map.get(process)! }));
}
