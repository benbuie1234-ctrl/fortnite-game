/** Expand a wire u32 timestamp to the epoch nearest a known clock (within 24 days). */
export function unwrapTime(wire: number, reference = Date.now()): number {
  const period = 0x100000000;
  return wire + Math.round((reference - wire) / period) * period;
}
