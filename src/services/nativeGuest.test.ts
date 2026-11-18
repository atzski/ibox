import { describe, expect, it } from "vitest";
import { annexBToAvc, avcConfig, codecFromKeyframe, HEADER, Kind, parseFrame, splitNals } from "./nativeGuest";

describe("invité natif", () => {
  it("lit la trame binaire envoyée par Rust", () => {
    const buf = new ArrayBuffer(HEADER + 3);
    const v = new DataView(buf);
    v.setUint8(0, 1);
    v.setUint8(1, 1);
    v.setBigUint64(4, 0x010203040506n, true);
    v.setUint32(12, 1234, true);
    new Uint8Array(buf, HEADER).set([7, 8, 9]);
    const f = parseFrame(buf)!;
    expect(f.kind).toBe(Kind.Video);
    expect(f.keyframe).toBe(true);
    expect(f.rtpTime).toBe(0x010203040506);
    expect(f.arrivedUs).toBe(1234);
    expect([...f.data]).toEqual([7, 8, 9]);
    expect(parseFrame(new ArrayBuffer(4))).toBeNull();
  });

  it("déduit le codec WebCodecs du SPS", () => {
    const idr = new Uint8Array([0, 0, 0, 1, 0x67, 0x64, 0x00, 0x29, 0xac, 0, 0, 0, 1, 0x68, 1, 0, 0, 1, 0x65, 2]);
    expect(codecFromKeyframe(idr)).toBe("avc1.640029");
    expect(codecFromKeyframe(new Uint8Array([0, 0, 1, 0x41, 1]))).toBeNull();
  });

  it("convertit Annex B en AVC et construit l'en-tête avcC", () => {
    const sps = [0x67, 0x64, 0x00, 0x20, 0xac];
    const pps = [0x68, 0xeb, 0xe3];
    const idr = [0x65, 0x88, 0x00, 0x01];
    const annexB = new Uint8Array([0, 0, 0, 1, ...sps, 0, 0, 0, 1, ...pps, 0, 0, 1, ...idr]);
    expect(splitNals(annexB).map((u) => [...u])).toEqual([sps, pps, idr]);
    expect([...annexBToAvc(annexB)]).toEqual([0, 0, 0, 5, ...sps, 0, 0, 0, 3, ...pps, 0, 0, 0, 4, ...idr]);
    expect([...avcConfig(annexB)!]).toEqual([1, 0x64, 0x00, 0x20, 0xff, 0xe1, 0, 5, ...sps, 1, 0, 3, ...pps]);
    expect(avcConfig(new Uint8Array([0, 0, 1, ...idr]))).toBeNull();
  });
});
