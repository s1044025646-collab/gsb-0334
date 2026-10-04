#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { openDatabase } from "../db/database.js";
import { readFixture, exportResult } from "../io/formats.js";
import { createApi } from "../api/server.js";
import { ImageService } from "../services/imageService.js";
import { AppError } from "../core/errors.js";
import { constantMosaic, gradientMosaic } from "../core/fixtures.js";
import type { BayerPattern, MosaicInput } from "../core/types.js";

const root = process.cwd();
const dataDir = join(root, "data");
const dbPath = process.env.BAYER_DB_PATH ?? join(dataDir, "bayer.sqlite");

main().catch(error => {
  if (error instanceof AppError) {
    console.error(`错误 [${error.code}] ${error.message}`);
    if (error.details) console.error(JSON.stringify(error.details, null, 2));
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  const db = openDatabase(dbPath);
  const service = new ImageService(db);
  try {
    switch (command) {
      case "import": await importCommand(service, args); break;
      case "reconstruct": reconstructCommand(service, args); break;
      case "phase": phaseCommand(service, args); break;
      case "pixel": pixelCommand(service, args); break;
      case "compare": compareCommand(args); break;
      case "pattern": patternCommand(service, args); break;
      case "validate": validateCommand(service, args); break;
      case "export": exportCommand(service, args); break;
      case "serve": await serveCommand(service, args); break;
      case "demo": demoCommand(service); break;
      default:
        console.log("命令: import | reconstruct | phase | pixel | compare | validate | export | serve | demo");
    }
  } finally {
    db.close();
  }
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

async function importCommand(service: ImageService, args: string[]): Promise<void> {
  const file = args.find(arg => !arg.startsWith("--"));
  if (!file) throw new AppError("MISSING_ARGUMENT", "用法: bayer-cli import <fixture.json|fixture.csv>");
  const summary = service.importMosaic(readFixture(resolve(file)));
  console.log(JSON.stringify(summary, null, 2));
}

function reconstructCommand(service: ImageService, args: string[]): void {
  const imageId = required(args, "imageId");
  console.log(JSON.stringify(service.result(imageId, optionalVersion(args)), null, 2));
}

function phaseCommand(service: ImageService, args: string[]): void {
  const imageId = required(args, "imageId");
  const x = Number(option(args, "x"));
  const y = Number(option(args, "y"));
  console.log(JSON.stringify(service.phase(imageId, x, y, optionalVersion(args)), null, 2));
}

function pixelCommand(service: ImageService, args: string[]): void {
  const imageId = required(args, "imageId");
  const x = Number(option(args, "x"));
  const y = Number(option(args, "y"));
  const result = service.provenance(imageId, x, y, optionalVersion(args));
  console.log(`像素 (${x}, ${y})`);
  for (const channel of ["R", "G", "B"] as const) {
    const item = result.channels[channel];
    console.log(`${channel}: value=${item.value.toFixed(6)} ${item.measured ? "实测" : "插值"}`);
    for (const source of item.sources) {
      console.log(`  src=(${source.x},${source.y}) ${source.channel} value=${source.value} weight=${source.weight}`);
    }
  }
}

function compareCommand(args: string[]): void {
  const db = openDatabase(":memory:");
  try {
    const service = new ImageService(db);
    const file = args.find(arg => !arg.startsWith("--"));
    const input = file ? readFixture(resolve(file)) : gradientMosaic(3, 3, "RGGB");
    console.log(JSON.stringify(service.comparePatterns(input).map(item => ({
      pattern: item.pattern,
      width: item.result.width,
      height: item.result.height
    })), null, 2));
  } finally {
    db.close();
  }
}

function patternCommand(service: ImageService, args: string[]): void {
  const imageId = required(args, "imageId");
  const pattern = option(args, "pattern");
  if (pattern !== "RGGB" && pattern !== "BGGR" && pattern !== "GRBG" && pattern !== "GBRG") {
    throw new AppError("INVALID_PATTERN", "--pattern 必须是 RGGB、BGGR、GRBG 或 GBRG");
  }
  console.log(JSON.stringify(service.changePattern(imageId, pattern), null, 2));
}

function validateCommand(service: ImageService, args: string[]): void {
  const imageId = required(args, "imageId");
  const report = service.validate(imageId, optionalVersion(args));
  console.log(JSON.stringify(report, null, 2));
  if (!report.valid) process.exitCode = 2;
}

function exportCommand(service: ImageService, args: string[]): void {
  const imageId = required(args, "imageId");
  const output = option(args, "out") ?? join(dataDir, "exports", `${imageId}.json`);
  exportResult(service.result(imageId, optionalVersion(args)), resolve(output));
  console.log(`已导出: ${resolve(output)}`);
}

async function serveCommand(service: ImageService, args: string[]): Promise<void> {
  const portArg = option(args, "port");
  const port = portArg ? Number(portArg) : undefined;
  if (portArg && (!Number.isInteger(port) || (port ?? 0) < 0)) {
    throw new AppError("INVALID_PORT", "--port 必须是非负整数");
  }
  const { server, port: actualPort } = await createApi(service, port === undefined ? {} : { port });
  console.log(`Bayer API: http://127.0.0.1:${actualPort}`);
  process.on("SIGINT", () => server.close());
  process.on("SIGTERM", () => server.close());
}

function demoCommand(service: ImageService): void {
  mkdirSync(join(dataDir, "fixtures"), { recursive: true });
  mkdirSync(join(dataDir, "exports"), { recursive: true });
  const patterns: BayerPattern[] = ["RGGB", "BGGR", "GRBG", "GBRG"];
  const colors = { R: 0.2, G: 0.5, B: 0.8 };
  for (const pattern of patterns) {
    const input = constantMosaic(4, 3, pattern, colors);
    const summary = service.importMosaic(input);
    const report = service.validate(summary.imageId);
    if (!report.valid) throw new AppError("DEMO_FAILED", `${pattern} 常值验证失败`);
  }
  const gradient: MosaicInput = gradientMosaic(3, 3, "GRBG");
  const fixturePath = join(dataDir, "fixtures", "gradient-3x3.json");
  writeFileSync(fixturePath, JSON.stringify(gradient, null, 2), "utf8");
  const imported = service.importMosaic(gradient);
  const result = service.result(imported.imageId);
  const exportPath = join(dataDir, "exports", "gradient-3x3.csv");
  exportResult(result, exportPath);
  const center = service.provenance(imported.imageId, 1, 1);
  console.log("演示完成");
  console.log(`夹具: ${fixturePath}`);
  console.log(`导出: ${exportPath}`);
  console.log("中心 (1,1) 来源:");
  for (const channel of ["R", "G", "B"] as const) {
    const item = center.channels[channel];
    const sources = item.sources.map(source => `(${source.x},${source.y},w=${source.weight})`).join(" ");
    console.log(`  ${channel} ${item.measured ? "实测" : "插值"} <- ${sources}`);
  }
}

function required(args: string[], name: string): string {
  const value = args.find(arg => !arg.startsWith("--"));
  if (!value) throw new AppError("MISSING_ARGUMENT", `缺少 ${name}`);
  return value;
}

function optionalVersion(args: string[]): number | undefined {
  const value = option(args, "version");
  if (!value) return undefined;
  if (!/^\d+$/.test(value)) throw new AppError("INVALID_VERSION", "--version 必须是正整数");
  return Number(value);
}
