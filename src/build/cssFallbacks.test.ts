import { describe, expect, it } from "vitest";
import { addCssFallbacks, mixFallback, parseColor } from "./cssFallbacks";

describe("replis CSS des WebView anciennes", () => {
  it("lit les couleurs littérales", () => {
    expect(parseColor("#fff")).toEqual([255, 255, 255, 1]);
    expect(parseColor("#00000080")?.[3]).toBeCloseTo(0.5, 2);
    expect(parseColor("rgba(10, 20, 30, 0.4)")).toEqual([10, 20, 30, 0.4]);
    expect(parseColor("rgb(10 20 30 / 40%)")).toEqual([10, 20, 30, 0.4]);
    expect(parseColor("var(--tone)")).toBeNull();
  });

  it("garde la couleur qui domine un mélange avec une variable", () => {
    expect(mixFallback("color-mix(in srgb, var(--tone) 12%, var(--ibox-white))")).toBe("var(--ibox-white)");
    expect(mixFallback("color-mix(in srgb, var(--tone) 78%, #ffffff)")).toBe("var(--tone)");
    expect(mixFallback("color-mix(in oklab, var(--accent) 24%, transparent)")).toBe("transparent");
    expect(mixFallback("color-mix(in srgb, var(--a), var(--b))")).toBe("var(--a)");
  });

  it("calcule le mélange de deux couleurs connues", () => {
    expect(mixFallback("color-mix(in srgb, #000 50%, #fff)")).toBe("rgb(128, 128, 128)");
    expect(mixFallback("color-mix(in srgb, #ff0000 40%, transparent)")).toBe("rgba(255, 0, 0, 0.4)");
    expect(mixFallback("linear-gradient(160deg, color-mix(in srgb, var(--tone) 78%, #fff), var(--tone))")).toBe(
      "linear-gradient(160deg, var(--tone), var(--tone))",
    );
    // imbriqué
    expect(mixFallback("color-mix(in srgb, color-mix(in srgb, #000 50%, #fff) 50%, #fff)")).toBe("rgb(192, 192, 192)");
  });

  it("corrige le repli de Tailwind placé devant le @supports", () => {
    const css =
      ".chip{background:var(--tone)}@supports (color:color-mix(in lab, red, red)){.chip{background:color-mix(in srgb, var(--tone) 12%, var(--ibox-white))}}";
    const out = addCssFallbacks(css);
    expect(out).toContain(".chip{background:var(--ibox-white)}");
    expect(out).toContain("color-mix(in srgb, var(--tone) 12%, var(--ibox-white))");
  });

  it("ajoute un repli devant un color-mix non protégé", () => {
    const out = addCssFallbacks("@keyframes p{50%{box-shadow:0 0 0 7px color-mix(in oklab, var(--accent) 24%, transparent)}}");
    expect(out).toContain("box-shadow:0 0 0 7px transparent;box-shadow:0 0 0 7px color-mix(");
  });

  it("traduit translate, scale et rotate en transform sous @supports not", () => {
    const out = addCssFallbacks(".a{translate:var(--x) var(--y)}.b{scale:var(--s) var(--s)}@keyframes k{to{scale:2}}");
    expect(out).toContain("@supports not (translate: 0){.a{--ibox-tf-translate:translate(var(--x), var(--y));transform:");
    expect(out).toContain("--ibox-tf-scale:scale(var(--s), var(--s))");
    expect(out).toContain("@property --ibox-tf-scale");
    expect(out).not.toContain("--ibox-tf-scale:scale(2)");
  });

  it("ne change rien à un CSS sans fonction récente", () => {
    const css = ".a{color:red;background:#fff}";
    expect(addCssFallbacks(css)).toBe(css);
  });
});

describe("couleurs du thème résolues sur :root", () => {
  it("mélange exactement une teinte du thème clair", () => {
    const css =
      ":root{--lightningcss-light:initial;--ibox-ink:var(--lightningcss-light,#000)var(--lightningcss-dark,#fff)}" +
      "html[data-theme=dark]{--ibox-ink:#fff}" +
      ":root,:host{--color-ink:var(--ibox-ink)}" +
      ".b{border-color:var(--color-ink)}@supports (color:color-mix(in lab, red, red)){.b{border-color:color-mix(in oklab, var(--color-ink) 20%, transparent)}}";
    expect(addCssFallbacks(css)).toContain(".b{border-color:rgba(0, 0, 0, 0.2)}");
  });
});

describe("valeurs modernes et parts variables", () => {
  it("résout une variable par sa valeur moderne et une part donnée par variable", () => {
    const css =
      ":root{--tint:#000;--blend:25%;--ibox-white:var(--tint)}" +
      "@supports (color:color-mix(in lab, red, red)){:root{--ibox-white:color-mix(in srgb, var(--tint) 10%, #fff)}}" +
      ".w{background:var(--ibox-white)}@supports (color:color-mix(in lab, red, red)){.w{background:color-mix(in oklab, var(--ibox-white) 50%, transparent)}}" +
      ".t{color:#fff}@supports (color:color-mix(in lab, red, red)){.t{color:color-mix(in oklch, #fff, var(--tint) var(--blend))}}";
    const out = addCssFallbacks(css);
    expect(out).toContain(".w{background:rgba(230, 230, 230, 0.5)}");
    // 25 % de noir en oklch : clarté perceptive 0,75
    expect(out).toContain(".t{color:rgb(174, 174, 174)}");
  });
});

describe("mélange perceptif", () => {
  it("garde les extrémités et le gris en oklab", () => {
    expect(mixFallback("color-mix(in oklab, #ff0000 100%, #0000ff)")).toBe("rgb(255, 0, 0)");
    expect(mixFallback("color-mix(in oklch, #808080 40%, #808080)")).toBe("rgb(128, 128, 128)");
    // oklch : la teinte tourne par l'arc le plus court (orange vers rouge), la chroma reste
    expect(mixFallback("color-mix(in oklch, #c2540a, #2f7fb0 26%)")).toBe("rgb(188, 78, 113)");
  });
});
