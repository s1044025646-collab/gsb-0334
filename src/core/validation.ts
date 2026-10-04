import { AppError } from "./errors.js";
import {
  CHANNELS,
  type BayerPattern,
  type Channel,
  type Mosaic,
  type MosaicInput,
  type Page,
  type PageOptions,
  PATTERNS
} from "./types.js";

export const DEFAULT_MAX_PIXELS = 65_536;

export function isBayerPattern(value: unknown): value is BayerPattern {
  return typeof value === "string" && Object.hasOwn(PATTERNS, value);
}

export function phaseAt(pattern: BayerPattern, x: number, y: number): Channel {
  const value = PATTERNS[pattern]?.[((y % 2) + 2) % 2]?.[((x % 2) + 2) % 2];
  if (!value) throw new AppError("INVALID_PATTERN", "未知 Bayer 排列");
  return value;
}

export function assertCoordinate(x: number, y: number, width: number, height: number): void {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= width || y >= height) {
    throw new AppError("INVALID_COORDINATE", `坐标 (${x}, ${y}) 超出 ${width}×${height} 范围`, 404);
  }
}

export function parseMosaicInput(input: MosaicInput, maxPixels = DEFAULT_MAX_PIXELS): Mosaic {
  if (!input || typeof input !== "object") {
    throw new AppError("INVALID_INPUT", "导入内容必须是 JSON 对象");
  }
  const width: unknown = input.width;
  const height: unknown = input.height;
  if (typeof width !== "number" || typeof height !== "number" ||
      !Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2) {
    throw new AppError("INVALID_DIMENSIONS", "width 与 height 必须是不小于 2 的整数");
  }
  if (width * height > maxPixels) {
    throw new AppError("IMAGE_TOO_LARGE", `像素数超过上限 ${maxPixels}`, 413, { maxPixels });
  }
  if (!isBayerPattern(input.pattern)) {
    throw new AppError("INVALID_PATTERN", "pattern 必须是 RGGB、BGGR、GRBG 或 GBRG");
  }

  let values: number[] = [];
  if (Array.isArray(input.rows)) {
    if (input.rows.length !== height) {
      throw new AppError("INVALID_SAMPLES", "rows 行数必须等于 height");
    }
    for (const row of input.rows) {
      if (!Array.isArray(row) || row.length !== width) {
        throw new AppError("INVALID_SAMPLES", "每一行必须是长度等于 width 的数值数组");
      }
      for (const value of row) values.push(validateValue(value));
    }
  } else if (Array.isArray(input.samples)) {
    values = new Array<number>(width * height).fill(Number.NaN);
    const seen = new Set<number>();
    for (const sample of input.samples) {
      if (!sample || typeof sample !== "object") {
        throw new AppError("INVALID_SAMPLES", "sample 必须包含 x、y、value");
      }
      const candidate = sample as { x?: unknown; y?: unknown; value?: unknown };
      const x: unknown = candidate.x;
      const y: unknown = candidate.y;
      if (typeof x !== "number" || typeof y !== "number" ||
          !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= width || y >= height) {
        throw new AppError("INVALID_SAMPLES", "sample 坐标无效或越界");
      }
      const index = y * width + x;
      if (seen.has(index)) {
        throw new AppError("DUPLICATE_SAMPLE", `位置 (${x}, ${y}) 存在重复样本`);
      }
      seen.add(index);
      values[index] = validateValue(candidate.value);
    }
    if (seen.size !== width * height) {
      throw new AppError("MISSING_SAMPLES", `必须提供全部 ${width * height} 个位置，当前为 ${seen.size} 个`);
    }
  } else {
    throw new AppError("INVALID_SAMPLES", "必须提供 rows 二维数组或 samples 坐标数组");
  }

  return { width, height, pattern: input.pattern, values };
}

function validateValue(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new AppError("INVALID_SAMPLE_VALUE", "采样值必须是有限数值");
  }
  if (value < 0 || value > 1) {
    throw new AppError("SAMPLE_OUT_OF_RANGE", "采样值必须位于 [0, 1]");
  }
  return value;
}

export function paginate<T>(items: readonly T[], options: PageOptions, defaultLimit = 100): Page<T> {
  const offset = Number.isInteger(options.offset) && (options.offset ?? 0) >= 0 ? Number(options.offset) : 0;
  const requestedLimit = options.limit;
  const limit = Number.isInteger(requestedLimit) && (requestedLimit ?? 0) > 0
    ? Math.min(Number(requestedLimit), 1000)
    : defaultLimit;
  if (offset > items.length) {
    throw new AppError("INVALID_PAGE", "分页 offset 超出范围", 404);
  }
  return {
    data: items.slice(offset, offset + limit),
    offset,
    limit,
    total: items.length
  };
}

export function channelName(channel: string): Channel {
  if (!CHANNELS.includes(channel as Channel)) {
    throw new AppError("INVALID_CHANNEL", "channel 必须是 R、G 或 B", 404);
  }
  return channel as Channel;
}
