import {AppError} from './errors.js';
import {channelAt, type Channel, type PatternName} from './patterns.js';
import type {MosaicSpec} from './mosaic.js';

export const BOUNDARY_RULE_VERSION = 'edge-existing-only-v1';

export interface SourceRef {
  row: number;
  col: number;
  channel: Channel;
  value: number;
  weight: number;
}

export interface ChannelResult {
  channel: Channel;
  value: number;
  measured: boolean;
  sources: SourceRef[];
}

export interface PixelResult {
  row: number;
  col: number;
  phaseChannel: Channel;
  R: ChannelResult;
  G: ChannelResult;
  B: ChannelResult;
}

type Offset = [number, number];

interface Neighbor {
  row: number;
  col: number;
}

// 只返回落在图内、且在该坐标下确实是所需颜色的邻居；
// 不把越界当零、不环绕、不复制颜色错误的最近像素。
function existingColorNeighbors(
  spec: MosaicSpec,
  row: number,
  col: number,
  wanted: Channel,
  offsets: Offset[],
): Neighbor[] {
  const out: Neighbor[] = [];
  for (const [dr, dc] of offsets) {
    const nr = row + dr;
    const nc = col + dc;
    if (nr < 0 || nr >= spec.height || nc < 0 || nc >= spec.width) continue;
    if (channelAt(spec.pattern, nr, nc) !== wanted) continue;
    out.push({row: nr, col: nc});
  }
  return out;
}

function averageSources(spec: MosaicSpec, neighbors: Neighbor[], wanted: Channel): SourceRef[] {
  if (neighbors.length === 0) {
    // 宽高 >=2 的 Bayer 规则下插值通道总有合法邻居；保留显式报错而非输出 NaN。
    throw new AppError(
      'E_NO_NEIGHBORS',
      `没有可用于插值通道 ${wanted} 的合法邻居`,
      {width: spec.width, height: spec.height, pattern: spec.pattern, wanted},
    );
  }
  const w = 1 / neighbors.length; // 按实际可用邻居归一
  return neighbors.map((n) => ({
    row: n.row,
    col: n.col,
    channel: wanted,
    value: spec.samples[n.row * spec.width + n.col] as number,
    weight: w,
  }));
}

function measuredResult(
  spec: MosaicSpec,
  row: number,
  col: number,
  channel: Channel,
): ChannelResult {
  return {
    channel,
    value: spec.samples[row * spec.width + col] as number,
    measured: true,
    sources: [{row, col, channel, value: spec.samples[row * spec.width + col] as number, weight: 1}],
  };
}

function interpolatedResult(
  spec: MosaicSpec,
  row: number,
  col: number,
  wanted: Channel,
  offsets: Offset[],
): ChannelResult {
  const sources = averageSources(spec, existingColorNeighbors(spec, row, col, wanted, offsets), wanted);
  let value = 0;
  for (const s of sources) value += s.value * s.weight;
  return {channel: wanted, value, measured: false, sources};
}

const ORTHOGONAL: Offset[] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];
const DIAGONAL: Offset[] = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];
const HORIZONTAL: Offset[] = [
  [0, -1],
  [0, 1],
];
const VERTICAL: Offset[] = [
  [-1, 0],
  [1, 0],
];

// 计算单个像素的三通道结果。纯函数，只读取原马赛克，扫描顺序无关。
export function reconstructPixel(spec: MosaicSpec, row: number, col: number): PixelResult {
  const own = channelAt(spec.pattern, row, col);
  const make = (wanted: Channel): ChannelResult => {
    if (wanted === own) return measuredResult(spec, row, col, wanted);
    if (own === 'G') {
      // 绿色位置：在该相位的同一行/列上，红与蓝与绿等间距交替出现。
      // 用“候选邻居里真实是所需颜色”的集合区分水平/垂直，两种绿相位不会混用。
      const horiz = existingColorNeighbors(spec, row, col, wanted, HORIZONTAL);
      if (horiz.length > 0) return interpolatedResult(spec, row, col, wanted, HORIZONTAL);
      return interpolatedResult(spec, row, col, wanted, VERTICAL);
    }
    if (wanted === 'G') {
      // 红/蓝位置缺失绿色：正交相邻绿色
      return interpolatedResult(spec, row, col, wanted, ORTHOGONAL);
    }
    // 红位置取蓝 / 蓝位置取红：对角相邻样本
    return interpolatedResult(spec, row, col, wanted, DIAGONAL);
  };
  return {row, col, phaseChannel: own, R: make('R'), G: make('G'), B: make('B')};
}

export interface Reconstruction {
  width: number;
  height: number;
  pattern: PatternName;
  boundaryRule: typeof BOUNDARY_RULE_VERSION;
  pixels: PixelResult[];
  rgb: {R: Float64Array; G: Float64Array; B: Float64Array};
}

export function reconstruct(spec: MosaicSpec): Reconstruction {
  const n = spec.width * spec.height;
  const rgb = {R: new Float64Array(n), G: new Float64Array(n), B: new Float64Array(n)};
  const pixels: PixelResult[] = [];
  for (let r = 0; r < spec.height; r++) {
    for (let c = 0; c < spec.width; c++) {
      const px = reconstructPixel(spec, r, c);
      const idx = r * spec.width + c;
      rgb.R[idx] = px.R.value;
      rgb.G[idx] = px.G.value;
      rgb.B[idx] = px.B.value;
      pixels.push(px);
    }
  }
  return {
    width: spec.width,
    height: spec.height,
    pattern: spec.pattern,
    boundaryRule: BOUNDARY_RULE_VERSION,
    pixels,
    rgb,
  };
}

export function pixelAt(rec: Reconstruction, row: number, col: number): PixelResult {
  if (row < 0 || row >= rec.height || col < 0 || col >= rec.width) {
    throw new AppError('E_VALIDATION', '像素坐标越界', {row, col});
  }
  return rec.pixels[row * rec.width + col] as PixelResult;
}

// 反向扫描重建：输入完全相同，仅改变像素迭代顺序，结果必须一致。
export function reconstructReverse(spec: MosaicSpec): Reconstruction {
  const n = spec.width * spec.height;
  const rgb = {R: new Float64Array(n), G: new Float64Array(n), B: new Float64Array(n)};
  const pixels = new Array<PixelResult>(n);
  for (let r = spec.height - 1; r >= 0; r--) {
    for (let c = spec.width - 1; c >= 0; c--) {
      const px = reconstructPixel(spec, r, c);
      const idx = r * spec.width + c;
      rgb.R[idx] = px.R.value;
      rgb.G[idx] = px.G.value;
      rgb.B[idx] = px.B.value;
      pixels[idx] = px;
    }
  }
  return {
    width: spec.width,
    height: spec.height,
    pattern: spec.pattern,
    boundaryRule: BOUNDARY_RULE_VERSION,
    pixels,
    rgb,
  };
}
