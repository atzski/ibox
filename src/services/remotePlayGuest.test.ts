import { describe, expect, it } from "vitest";
import { contentRect, decodeHost, encode, fingerprintOf, MAX_HELD_KEYS, normalizePoint, packSdp, padWire, SCANCODES, unpackSdp, verificationCode, wheelUnits } from "./remotePlayGuest";

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join(" ");

describe("protocole v1 (octets identiques à protocol.rs)", () => {
  it("souris, touches, molette", () => {
    expect(hex(encode.mouseAbs(7, 100, 65535))).toBe("10 07 00 00 00 64 00 ff ff");
    expect(hex(encode.mouseButton(1, true))).toBe("12 01 01");
    expect(hex(encode.wheel(-120, 240))).toBe("13 88 ff f0 00");
    expect(hex(encode.key(0xe048, true))).toBe("20 48 e0 01");
    expect(hex(encode.keyState(2, [0x1e, 0xe01d]))).toBe("21 02 00 00 00 02 1e 00 1d e0");
  });

  it("KeyState borné à 16 touches, valeurs bornées", () => {
    const many = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(encode.keyState(1, many).length).toBe(1 + 5 + MAX_HELD_KEYS * 2);
    expect(hex(encode.mouseAbs(0, -5, 70000))).toBe("10 00 00 00 00 00 00 ff ff");
    expect(hex(encode.wheel(1e9, -1e9))).toBe("13 ff 7f 00 80");
  });

  it("manette (18 octets) et ping", () => {
    const g = encode.gamepad(1, 3, { buttons: 0x1000, lt: 255, rt: 0, lx: -32768, ly: 32767, rx: 0, ry: 1 });
    expect(g.length).toBe(18);
    expect(hex(g)).toBe("30 01 03 00 00 00 00 10 ff 00 00 80 ff 7f 00 00 01 00");
    expect(hex(encode.ping(42, 123456))).toBe("50 2a 00 00 00 40 e2 01 00 00 00 00 00");
  });

  it("messages de l'hôte : pong et vibration, le reste ignoré", () => {
    const pong = encode.ping(9, 77);
    pong[0] = 0x51;
    expect(decodeHost(pong.buffer)).toEqual({ type: "pong", id: 9, micros: 77 });
    expect(decodeHost(new Uint8Array([0x31, 0, 200, 10]).buffer)).toEqual({ type: "rumble", pad: 0, large: 200, small: 10 });
    expect(decodeHost(new Uint8Array([0x31, 7, 1, 1]).buffer)).toBeNull();
    expect(decodeHost(new Uint8Array([0x40, 0, 0]).buffer)).toBeNull();
  });
});

describe("conversions", () => {
  it("codes de balayage indépendants de la disposition", () => {
    expect(SCANCODES.KeyQ).toBe(0x10); // A sur un clavier AZERTY : même touche physique
    expect(SCANCODES.KeyA).toBe(0x1e);
    expect(SCANCODES.KeyM).toBe(0x32);
    expect(SCANCODES.Digit0).toBe(0x0b);
    expect(SCANCODES.F10).toBe(0x44);
    expect(SCANCODES.F12).toBe(0x58);
    expect(SCANCODES.ArrowUp).toBe(0xe048);
    expect(SCANCODES.NumpadEnter).toBe(0xe01c);
  });

  it("manette standard → XInput", () => {
    const btn = (on: number[]) => Array.from({ length: 17 }, (_, i) => ({ pressed: on.includes(i), value: on.includes(i) ? 1 : 0 }));
    const w = padWire(btn([0, 3, 9, 12, 7]), [1, 1, -1, 0]);
    expect(w.buttons).toBe(0x1000 | 0x8000 | 0x0010 | 0x0001);
    expect(w.rt).toBe(255);
    expect(w.lt).toBe(0);
    expect([w.lx, w.ly, w.rx, w.ry]).toEqual([32767, -32767, -32767, 0]); // Y inversé
  });

  it("souris sur l'image (bandes noires exclues)", () => {
    // image 16:9 dans un cadre 4:3 → bandes en haut et en bas
    const r = contentRect(1920, 1080, { left: 0, top: 0, width: 800, height: 600 });
    expect(r).toEqual({ left: 0, top: 75, width: 800, height: 450 });
    expect(normalizePoint(400, 300, r)).toEqual([32768, 32768]);
    expect(normalizePoint(800, 525, r)).toEqual([65535, 65535]);
    expect(normalizePoint(400, 50, r)).toBeNull();
  });

  it("molette en unités Windows", () => {
    expect(wheelUnits(0, 100, 0)).toEqual([0, -120]); // vers le bas
    expect(wheelUnits(0, -3, 1)).toEqual([0, 120]); // 3 lignes vers le haut
    expect(wheelUnits(50, 0, 0)).toEqual([60, 0]);
  });
});

describe("échange manuel", () => {
  it("offre empaquetée puis relue", () => {
    const sdp = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=é\r\n";
    const blob = packSdp("offer", sdp);
    expect(blob.startsWith("IBOX-RP1-OFFRE:")).toBe(true);
    expect(unpackSdp("offer", `  ${blob.slice(0, 20)}\n${blob.slice(20)} `)).toBe(sdp);
    expect(() => unpackSdp("answer", blob)).toThrow(/réponse/);
  });

  it("empreinte normalisée et code identique au Rust", async () => {
    const fp = "ab:cd:" + Array(30).fill("0f").join(":");
    expect(fingerprintOf(`v=0\r\na=fingerprint:sha-256 ${fp}\r\n`)).toBe(`sha-256 ${fp.toUpperCase()}`);
    expect(fingerprintOf("a=fingerprint:sha-1 00:11")).toBeNull();
    // même valeur que transport::sdp::tests (Rust)
    expect(await verificationCode("A", "B")).toBe("0351 4052 4831");
  });
});
