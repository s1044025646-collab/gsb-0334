export type Channel = "R" | "G" | "B";
export type BayerPattern = "RGGB" | "BGGR" | "GRBG" | "GBRG";

export interface Point {
  x: number;
  y: number;
}

export interface RawSample extends Point {
  value: number;
}

export interface SourceSample extends RawSample {
  channel: Channel;
  weight: number;
}

export interface PixelProvenance {
  x: number;
  y: number;
  channels: Record<Channel, ChannelResult>;
}

export interface ChannelResult {
  value: number;
  measured: boolean;
  sources: SourceSample[];
}

export interface RGBPixel {
  x: number;
  y: number;
  rgb: [number, number, number];
}

export interface Reconstruction {
  width: number;
  height: number;
  pattern: BayerPattern;
  boundaryRuleVersion: "bayer-bilinear-neighbor-v1";
  rgb: number[][][];
  provenance: PixelProvenance[];
}

export interface Mosaic {
  width: number;
  height: number;
  pattern: BayerPattern;
  values: number[];
}

export interface MosaicInput {
  width?: number;
  height?: number;
  pattern?: unknown;
  rows?: unknown;
  samples?: unknown;
}

export interface PageOptions {
  offset?: number;
  limit?: number;
}

export interface Page<T> {
  data: T[];
  offset: number;
  limit: number;
  total: number;
}

export const PATTERNS: Record<BayerPattern, Channel[][]> = {
  RGGB: [
    ["R", "G"],
    ["G", "B"]
  ],
  BGGR: [
    ["B", "G"],
    ["G", "R"]
  ],
  GRBG: [
    ["G", "R"],
    ["B", "G"]
  ],
  GBRG: [
    ["G", "B"],
    ["R", "G"]
  ]
};

export const CHANNELS: Channel[] = ["R", "G", "B"];
