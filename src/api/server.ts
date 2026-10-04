import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { AppError, isAppError } from "../core/errors.js";
import type { BayerPattern, MosaicInput } from "../core/types.js";
import { ImageService } from "../services/imageService.js";

export interface ApiOptions {
  port?: number;
  host?: string;
}

export function createApi(service: ImageService, options: ApiOptions = {}): Promise<{ server: Server; port: number }> {
  const server = createServer((request, response) => {
    handleRequest(service, request, response).catch(error => sendError(response, error));
  });
  return new Promise(resolve => {
    const port = options.port ?? 0;
    server.listen(port, options.host ?? "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("无法确定监听端口");
      resolve({ server, port: address.port });
    });
  });
}

async function handleRequest(service: ImageService, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const pathParts = url.pathname.split("/").filter(Boolean);
  const method = request.method ?? "GET";

  if (method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { ok: true });
    return;
  }
  if (method === "POST" && url.pathname === "/api/mosaics") {
    sendJson(response, 201, service.importMosaic((await readBody(request)) as MosaicInput));
    return;
  }
  if (method === "POST" && url.pathname === "/api/compare-patterns") {
    const body = await readBody(request) as MosaicInput & { patterns?: BayerPattern[] };
    sendJson(response, 200, { comparisons: service.comparePatterns(body, body.patterns) });
    return;
  }

  const imageId = pathParts[2];
  if (pathParts[0] !== "api" || pathParts[1] !== "mosaics" || !imageId) {
    throw new AppError("NOT_FOUND", "路径不存在", 404);
  }

  let version: number | undefined;
  const versionParam = url.searchParams.get("version");
  if (versionParam !== null) {
    if (!/^\d+$/.test(versionParam)) throw new AppError("INVALID_VERSION", "version 必须是正整数");
    version = Number(versionParam);
  }

  if (method === "GET" && pathParts.length === 4 && pathParts[3] === "versions") {
    sendJson(response, 200, { versions: service.listVersions(imageId) });
    return;
  }
  if (method === "POST" && pathParts.length === 4 && pathParts[3] === "pattern") {
    const body = await readBody(request) as { pattern?: unknown };
    sendJson(response, 201, service.changePattern(imageId, body.pattern));
    return;
  }
  if (method === "POST" && pathParts.length === 4 && pathParts[3] === "reconstruct") {
    sendJson(response, 200, service.result(imageId, version));
    return;
  }
  if (method === "GET" && pathParts.length === 4 && pathParts[3] === "validate") {
    sendJson(response, 200, service.validate(imageId, version));
    return;
  }
  if (method === "GET" && pathParts.length === 6 && pathParts[3] === "phase") {
    sendJson(response, 200, service.phase(imageId, numberPath(pathParts[4]), numberPath(pathParts[5]), version));
    return;
  }
  if (method === "GET" && pathParts.length === 6 && pathParts[3] === "pixels") {
    sendJson(response, 200, service.provenance(imageId, numberPath(pathParts[4]), numberPath(pathParts[5]), version));
    return;
  }
  if (method === "GET" && pathParts.length === 4 && pathParts[3] === "provenance") {
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const limit = Number(url.searchParams.get("limit") ?? 64);
    sendJson(response, 200, service.listProvenance(imageId, offset, limit, version));
    return;
  }
  throw new AppError("NOT_FOUND", "路径不存在", 404);
}

function numberPath(value: string | undefined): number {
  if (value === undefined || !/^-?\d+$/.test(value)) throw new AppError("INVALID_COORDINATE", "坐标必须是整数");
  return Number(value);
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 32 * 1024 * 1024) throw new AppError("PAYLOAD_TOO_LARGE", "请求体超过 32 MiB", 413);
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AppError("INVALID_JSON", "请求体不是有效 JSON");
  }
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function sendError(response: ServerResponse, error: unknown): void {
  const appError = isAppError(error)
    ? error
    : new AppError("INTERNAL_ERROR", error instanceof Error ? error.message : "未知错误", 500);
  sendJson(response, appError.status, {
    error: { code: appError.code, message: appError.message, details: appError.details }
  });
}
