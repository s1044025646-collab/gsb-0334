import type { BayerPattern, MosaicInput } from "./types.js";
import { PATTERNS } from "./types.js";

export function constantMosaic(width: number, height: number, pattern: BayerPattern, colors: Record<"R" | "G" | "B", number>): MosaicInput {
  const rows: number[][] = [];
  for (let y = 0; y < height; y += 1) {
    const row: number[] = [];
    for (let x = 0; x < width; x += 1) {
      const channel = PATTERNS[pattern][y % 2]?.[x % 2];
      if (!channel) throw new Error("bad phase");
      row.push(colors[channel]);
    }
    rows.push(row);
  }
  return { width, height, pattern, rows };
}

export function gradientMosaic(width: number, height: number, pattern: BayerPattern): MosaicInput {
  const rows: number[][] = [];
  for (let y = 0; y < height; y += 1) {
    const row: number[] = [];
    for (let x = 0; x < width; x += 1) {
      row.push(((x + 1) / (width + 1) * 0.6 + (y + 1) / (height + 1) * 0.3) % 1);
    }
    rows.push(row);
  }
  return { width, height, pattern, rows };
}
