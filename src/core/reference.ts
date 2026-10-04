import type { BayerPattern, Channel, Mosaic } from "./types.js";
import { phaseAt } from "./validation.js";

export function referenceChannel(mosaic: Mosaic, x: number, y: number, channel: Channel): number {
  const measured = phaseAt(mosaic.pattern, x, y);
  if (measured === channel) return value(mosaic, x, y);

  const neighbors: Array<[number, number]> = [];
  if (measured === "R" || measured === "B") {
    if (channel === "G") {
      neighbors.push([x, y - 1], [x - 1, y], [x + 1, y], [x, y + 1]);
    } else {
      neighbors.push([x - 1, y - 1], [x + 1, y - 1], [x - 1, y + 1], [x + 1, y + 1]);
    }
  } else {
    const horizontalCandidates: Array<[number, number]> = [[x - 1, y], [x + 1, y]];
    const horizontalPhase = horizontalCandidates
      .filter(([nx, ny]) => nx >= 0 && ny >= 0 && nx < mosaic.width && ny < mosaic.height)
      .map(([nx, ny]) => phaseAt(mosaic.pattern, nx, ny))
      .find(item => item === "R" || item === "B");
    if (channel === horizontalPhase) {
      neighbors.push([x - 1, y], [x + 1, y]);
    } else {
      neighbors.push([x, y - 1], [x, y + 1]);
    }
  }

  const accepted: number[] = [];
  for (const neighbor of neighbors) {
    const nx = neighbor[0] ?? 0;
    const ny = neighbor[1] ?? 0;
    if (nx < 0 || ny < 0 || nx >= mosaic.width || ny >= mosaic.height) continue;
    if (phaseAt(mosaic.pattern, nx, ny) !== channel) continue;
    accepted.push(value(mosaic, nx, ny));
  }
  if (accepted.length === 0) throw new Error(`reference missing ${channel} at ${x},${y}`);
  return accepted.reduce((sum, item) => sum + item, 0) / accepted.length;
}

function value(mosaic: Mosaic, x: number, y: number): number {
  const item = mosaic.values[y * mosaic.width + x];
  if (item === undefined) throw new Error("missing value");
  return item;
}
