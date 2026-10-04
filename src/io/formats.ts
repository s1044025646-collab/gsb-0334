import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, extname } from "node:path";
import type { Mosaic, MosaicInput, Reconstruction } from "../core/types.js";
import { AppError } from "../core/errors.js";

export function readFixture(path: string): MosaicInput {
  const text = readFileSync(path, "utf8");
  if (extname(path).toLowerCase() === ".csv") return parseCsv(text);
  try {
    return JSON.parse(text) as MosaicInput;
  } catch {
    throw new AppError("INVALID_FIXTURE", "JSON 夹具无法解析");
  }
}

export function parseCsv(text: string): MosaicInput {
  const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length < 3) throw new AppError("INVALID_FIXTURE", "CSV 至少需要 width,height,pattern 与两行数据");
  const header = splitCsvLine(lines[0] ?? "");
  if (header[0] !== "width" || header[1] !== "height" || header[2] !== "pattern") {
    throw new AppError("INVALID_FIXTURE", "CSV 首行必须是 width,height,pattern");
  }
  const first = splitCsvLine(lines[1] ?? "");
  const width = Number(first[0]);
  const height = Number(first[1]);
  const pattern = first[2];
  const rows = lines.slice(2).map(splitCsvLine).map(parts => parts.map(Number));
  return { width, height, pattern, rows };
}

function splitCsvLine(line: string): string[] {
  return line.split(",").map(part => part.trim());
}

export function exportResult(result: Reconstruction, path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  if (extname(path).toLowerCase() === ".csv") {
    const rows = ["x,y,r,g,b"];
    for (let y = 0; y < result.height; y += 1) {
      for (let x = 0; x < result.width; x += 1) {
        const pixel = result.rgb[y]?.[x];
        if (!pixel) throw new AppError("INTERNAL_ERROR", "导出像素缺失", 500);
        rows.push([x, y, ...pixel].join(","));
      }
    }
    writeFileSync(path, rows.join("\n"), "utf8");
    return;
  }
  writeFileSync(path, JSON.stringify(result, null, 2), "utf8");
}

export function mosaicToInput(mosaic: Mosaic): MosaicInput {
  const rows: number[][] = [];
  for (let y = 0; y < mosaic.height; y += 1) {
    const row: number[] = [];
    for (let x = 0; x < mosaic.width; x += 1) {
      const value = mosaic.values[y * mosaic.width + x];
      if (value === undefined) throw new AppError("INTERNAL_ERROR", "样本缺失", 500);
      row.push(value);
    }
    rows.push(row);
  }
  return { width: mosaic.width, height: mosaic.height, pattern: mosaic.pattern, rows };
}
