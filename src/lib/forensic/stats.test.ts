import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { luma, scaleToU8, statsF32 } from "./stats.ts";
import { parseJpeg } from "./parse-media.ts";

describe("statsF32", () => {
  it("returns zeros for empty input", () => {
    const s = statsF32([]);
    assert.equal(s.mean, 0);
    assert.equal(s.std, 0);
  });
  it("is exact on a constant field", () => {
    const s = statsF32([4, 4, 4, 4]);
    assert.equal(s.mean, 4);
    assert.equal(s.median, 4);
    assert.ok(s.std < 1e-9);
  });
});

describe("scaleToU8", () => {
  it("clips to 0..255", () => {
    const { gray } = scaleToU8([0, 10, 20], 1, 100);
    assert.equal(gray[0], 0);
    assert.equal(gray[2], 255);
  });
});

describe("luma", () => {
  it("is 0 for black and 255 for white", () => {
    assert.equal(luma(0, 0, 0), 0);
    assert.ok(Math.abs(luma(255, 255, 255) - 255) < 1e-6);
  });
});

describe("parseJpeg", () => {
  it("rejects non-jpeg", () => {
    const info = parseJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    assert.equal(info.isJpeg, false);
  });
  it("sees SOI/EOI", () => {
    const info = parseJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
    assert.equal(info.isJpeg, true);
    assert.ok(info.markers.some((m) => m.name === "SOI"));
  });
});
