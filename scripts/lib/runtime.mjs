// Supports the repository's stable >=major.minor.patch <major engine ranges.
export function satisfiesRuntimeRange(version, range) {
  const actual = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  const bounds = /^>=(\d+)\.(\d+)\.(\d+) <(\d+)$/.exec(range);
  if (!actual || !bounds) return false;
  const parts = actual.slice(1).map(Number);
  const minimum = bounds.slice(1, 4).map(Number);
  if (parts[0] >= Number(bounds[4])) return false;
  for (let i = 0; i < 3; i++) {
    if (parts[i] !== minimum[i]) return parts[i] > minimum[i];
  }
  return true;
}
