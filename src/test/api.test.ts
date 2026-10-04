import assert from "node:assert/strict";
import { test } from "node:test";
import { openDatabase } from "../db/database.js";
import { createApi } from "../api/server.js";
import type { Server } from "node:http";
import { ImageService } from "../services/imageService.js";
import { gradientMosaic } from "../core/fixtures.js";

test("HTTP API 可导入、重建、查询像素来源和验证", async () => {
  const db = openDatabase(":memory:");
  const { server, port } = await createApi(new ImageService(db));
  try {
    const imported = await request(port, "POST", "/api/mosaics", gradientMosaic(2, 3, "GBRG"));
    const imageId = imported.imageId as string;
    const result = await request(port, "POST", `/api/mosaics/${imageId}/reconstruct`);
    assert.equal(result.width, 2);
    const pixel = await request(port, "GET", `/api/mosaics/${imageId}/pixels/0/0`);
    assert.ok(pixel.channels.R || pixel.channels.G || pixel.channels.B);
    const validation = await request(port, "GET", `/api/mosaics/${imageId}/validate`);
    assert.equal(validation.valid, true);
  } finally {
    await close(server);
    db.close();
  }
});

test("HTTP API 返回结构化错误码", async () => {
  const db = openDatabase(":memory:");
  const { server, port } = await createApi(new ImageService(db));
  try {
    await assert.rejects(
      () => request(port, "POST", "/api/mosaics", { width: 1, height: 2, pattern: "RGGB", rows: [[0, 1]] }),
      (error: unknown) => error instanceof ApiRequestError && error.body.error.code === "INVALID_DIMENSIONS"
    );
  } finally {
    await close(server);
    db.close();
  }
});

async function request(port: number, method: string, path: string, body?: unknown): Promise<any> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const response = await fetch(`http://127.0.0.1:${port}${path}`, init);
  const json = await response.json() as any;
  if (!response.ok) throw new ApiRequestError(response.status, json);
  return json;
}

class ApiRequestError extends Error {
  constructor(public readonly status: number, public readonly body: any) {
    super(`HTTP ${status}`);
  }
}

function close(server: Server): Promise<void> {
  return new Promise(resolve => server.close(() => resolve()));
}
