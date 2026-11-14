import { describe, expect, it } from "vitest";
import { parseRiotCatalog, riotImage } from "./avatarProviders";

describe("Data Dragon", () => {
  it("reads only valid catalog entries and sorts by id", () => {
    expect(parseRiotCatalog("16.1.1", { data: {
      50: { id: 50, image: { full: "50.png" } },
      0: { id: 0, image: { full: "0.png" } },
      12: { id: 13, image: { full: "13.png" } },
    } })).toEqual({ version: "16.1.1", ids: [0, 50] });
  });
  it("rejects invalid catalogs and arbitrary image paths", () => {
    expect(() => parseRiotCatalog("16.1.1", { data: {} })).toThrow();
    expect(riotImage({ type: "riot", version: "../bad", id: 12 })).toBeUndefined();
    expect(riotImage({ type: "riot", version: "16.1.1", id: 0 })).toBe(
      "https://ddragon.leagueoflegends.com/cdn/16.1.1/img/profileicon/0.png",
    );
  });
});
