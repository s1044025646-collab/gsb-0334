import {AppError} from './errors.js';
import {channelAt, isPatternName, type PatternName} from './patterns.js';

export const MAX_PIXELS = 4_000_000;

export interface MosaicSpec {
  width: number;
  height: number;
  pattern: PatternName;
  // 长度 = width*height 的稠密一维数组，索引 = row*width + col
  samples: number[];
}

export function validateDimensions(width: unknown, height: unknown): {width: number; height: number} {
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    throw new AppError('E_DIMENSIONS', '宽高必须是整数', {width, height});
  }
  const w = width as number;
  const h = height as number;
  if (w < 2 || h < 2) {
    throw new AppError('E_DIMENSIONS', '宽高最小均为 2', {width: w, height: h});
  }
  if (w * h > MAX_PIXELS) {
    throw new AppError('E_DIMENSIONS', `像素数超过上限 ${MAX_PIXELS}`, {pixels: w * h});
  }
  return {width: w, height: h};
}

export function validatePattern(pattern: unknown): PatternName {
  if (!isPatternName(pattern)) {
    throw new AppError('E_PATTERN', '排列必须是 RGGB/BGGR/GRBG/GBRG 之一', {pattern});
  }
  return pattern;
}

export function validateSamples(samples: unknown, count: number): number[] {
  if (!Array.isArray(samples)) {
    throw new AppError('E_SAMPLE_COUNT', 'samples 必须是数组');
  }
  if (samples.length !== count) {
    throw new AppError('E_SAMPLE_COUNT', `样本数量必须等于 宽*高=${count}`, {
      expected: count,
      actual: samples.length,
    });
  }
  const out: number[] = new Array<number>(count);
  for (let i = 0; i < count; i++) {
    const raw = samples[i];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      throw new AppError('E_NON_FINITE', `位置 ${i} 的样本不是有限数值`, {index: i, value: raw});
    }
    if (raw < 0 || raw > 1) {
      throw new AppError('E_RANGE', `位置 ${i} 的样本超出 [0,1]`, {index: i, value: raw});
    }
    out[i] = raw;
  }
  return out;
}

export function parseMosaicSpec(input: unknown): MosaicSpec {
  if (typeof input !== 'object' || input === null) {
    throw new AppError('E_PARSE', '请求体必须是对象');
  }
  const obj = input as Record<string, unknown>;
  const {width, height} = validateDimensions(obj.width, obj.height);
  const pattern = validatePattern(obj.pattern);
  const samples = validateSamples(obj.samples, width * height);
  return {width, height, pattern, samples};
}

export function sampleAt(spec: MosaicSpec, row: number, col: number): number {
  const v = spec.samples[row * spec.width + col];
  if (v === undefined) {
    throw new AppError('E_INTERNAL', '样本索引越界', {row, col});
  }
  return v;
}

// 给定每个通道的常量值，合成 Bayer 马赛克
export function makeConstantMosaic(
  width: number,
  height: number,
  pattern: PatternName,
  constants: {R: number; G: number; B: number},
): number[] {
  const samples: number[] = new Array<number>(width * height);
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      samples[r * width + c] = constants[channelAt(pattern, r, c)];
    }
  }
  return samples;
}

// 合成梯度马赛克：值 = 0.1 + 0.8 * ((0.5*c + 0.3*r) 归一)，再按通道取“真 RGB”
export function makeGradientMosaic(
  width: number,
  height: number,
  pattern: PatternName,
): {samples: number[]; rgb: {R: number[][]; G: number[][]; B: number[][]}} {
  const base = (r: number, c: number, ch: 'R' | 'G' | 'B'): number => {
    const bias = ch === 'R' ? 0.0 : ch === 'G' ? 0.1 : 0.2;
    const t = (c / Math.max(1, width - 1)) * 0.5 + (r / Math.max(1, height - 1)) * 0.3;
    return Math.min(1, Math.max(0, bias + t));
  };
  const rgb = {
    R: Array.from({length: height}, (_v, r) =>
      Array.from({length: width}, (_u, c) => base(r, c, 'R')),
    ),
    G: Array.from({length: height}, (_v, r) =>
      Array.from({length: width}, (_u, c) => base(r, c, 'G')),
    ),
    B: Array.from({length: height}, (_v, r) =>
      Array.from({length: width}, (_u, c) => base(r, c, 'B')),
    ),
  };
  const samples = new Array<number>(width * height);
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      samples[r * width + c] = rgb[channelAt(pattern, r, c)][r]![c]!;
    }
  }
  return {samples, rgb};
}
