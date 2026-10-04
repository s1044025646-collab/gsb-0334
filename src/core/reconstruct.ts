import { AppError } from "./errors.js";
import type {
  BayerPattern,
  Channel,
  ChannelResult,
  Mosaic,
  PixelProvenance,
  Reconstruction,
  SourceSample
} from "./types.js";
import { phaseAt } from "./validation.js";

const BOUNDARY_RULE_VERSION = "bayer-bilinear-neighbor-v1" as const;

type Offset = [number, number];

const ORTHOGONAL: readonly Offset[] = [
  [0, -1],
  [-1, 0],
  [1, 0],
  [0, 1]
];

const DIAGONAL: readonly Offset[] = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1]
];

export function reconstruct(mosaic: Mosaic): Reconstruction {
  const { width, height, pattern, values } = mosaic;
  const rgb: number[][][] = [];
  const provenance: PixelProvenance[] = [];

  for (let y = 0; y < height; y += 1) {
    const row: number[][] = [];
    for (let x = 0; x < width; x += 1) {
      const pixel = reconstructPixel(mosaic, x, y);
      row.push([pixel.channels.R.value, pixel.channels.G.value, pixel.channels.B.value]);
      provenance.push(pixel);
    }
    rgb.push(row);
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const phase = phaseAt(pattern, x, y);
      const raw = values[y * width + x];
      if (raw === undefined) throw new AppError("INTERNAL_ERROR", `缺少原样本 (${x}, ${y})`, 500);
      if (rgb[y]?.[x]?.[channelIndex(phase)] !== raw) {
        throw new AppError("MEASURED_CHANNEL_NOT_PRESERVED", `实测通道未保留 (${x}, ${y})`, 500);
      }
    }
  }

  return { width, height, pattern, boundaryRuleVersion: BOUNDARY_RULE_VERSION, rgb, provenance };
}

export function reconstructPixel(mosaic: Mosaic, x: number, y: number): PixelProvenance {
  const phase = phaseAt(mosaic.pattern, x, y);
  const channels = {} as Record<Channel, ChannelResult>;
  for (const channel of ["R", "G", "B"] as Channel[]) {
    channels[channel] = channel === phase
      ? measuredResult(mosaic, x, y, channel)
      : interpolateChannel(mosaic, x, y, phase, channel);
  }
  return { x, y, channels };
}

function measuredResult(mosaic: Mosaic, x: number, y: number, channel: Channel): ChannelResult {
  const value = sampleValue(mosaic, x, y);
  return {
    value,
    measured: true,
    sources: [{ x, y, channel, value, weight: 1 }]
  };
}

function interpolateChannel(
  mosaic: Mosaic,
  x: number,
  y: number,
  measuredChannel: Channel,
  targetChannel: Channel
): ChannelResult {
  if (measuredChannel === "G") {
    return averageByPhase(mosaic, x, y, targetChannel);
  }
  if (targetChannel === "G") {
    return averageMatching(mosaic, x, y, targetChannel, ORTHOGONAL);
  }
  return averageMatching(mosaic, x, y, targetChannel, DIAGONAL);
}

function averageByPhase(
  mosaic: Mosaic,
  x: number,
  y: number,
  targetChannel: Channel
): ChannelResult {
  const horizontalOffsets: Offset[] = [[-1, 0], [1, 0]];
  const existingHorizontalPhases: Channel[] = [];
  for (const [dx, dy] of horizontalOffsets) {
    if (inside(mosaic, x + dx, y + dy)) {
      existingHorizontalPhases.push(phaseAt(mosaic.pattern, x + dx, y + dy));
    }
  }
  const horizontalPhase = existingHorizontalPhases
    .find(channel => channel === "R" || channel === "B");
  const offsets: readonly Offset[] = targetChannel === horizontalPhase
    ? [[-1, 0], [1, 0]]
    : [[0, -1], [0, 1]];
  return averageMatching(mosaic, x, y, targetChannel, offsets);
}

function averageMatching(
  mosaic: Mosaic,
  x: number,
  y: number,
  channel: Channel,
  offsets: readonly Offset[]
): ChannelResult {
  const sources: SourceSample[] = [];
  for (const [dx, dy] of offsets) {
    const nx = x + dx;
    const ny = y + dy;
    if (!inside(mosaic, nx, ny)) continue;
    if (phaseAt(mosaic.pattern, nx, ny) !== channel) continue;
    const value = sampleValue(mosaic, nx, ny);
    sources.push({ x: nx, y: ny, channel, value, weight: 0 });
  }
  if (sources.length === 0) {
    throw new AppError(
      "NO_REQUIRED_NEIGHBOR",
      `位置 (${x}, ${y}) 的 ${channel} 通道没有真实且颜色匹配的邻居`,
      422,
      { x, y, channel, boundaryRuleVersion: BOUNDARY_RULE_VERSION }
    );
  }
  const weight = 1 / sources.length;
  let value = 0;
  for (const source of sources) {
    source.weight = weight;
    value += source.value * weight;
  }
  return { value, measured: false, sources };
}

function inside(mosaic: Mosaic, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < mosaic.width && y < mosaic.height;
}

function sampleValue(mosaic: Mosaic, x: number, y: number): number {
  const value = mosaic.values[y * mosaic.width + x];
  if (value === undefined) {
    throw new AppError("INTERNAL_ERROR", `源坐标 (${x}, ${y}) 不存在`, 500);
  }
  return value;
}

function channelIndex(channel: Channel): 0 | 1 | 2 {
  if (channel === "R") return 0;
  if (channel === "G") return 1;
  return 2;
}
