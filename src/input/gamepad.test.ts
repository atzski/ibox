import { describe, expect, it } from "vitest";
import { PadProcessor, confirmButton, detectFamily, padLabels, type PadState } from "./gamepad";

const pad = (pressed: number[] = [], axes: number[] = [0, 0, 0, 0]): PadState => {
  const buttons = Array.from({ length: 17 }, (_, i) => pressed.includes(i));
  return { buttons, axes };
};

describe("familles de manettes", () => {
  it("reconnaît les identifiants courants", () => {
    expect(detectFamily("Xbox 360 Controller (XInput STANDARD GAMEPAD)")).toBe("xbox");
    expect(detectFamily("DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c)")).toBe("playstation");
    expect(detectFamily("Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)")).toBe("nintendo");
    expect(detectFamily("8BitDo SN30")).toBe("generic");
  });

  it("valide à droite sur Nintendo, en bas ailleurs, sauf choix de l'utilisateur", () => {
    expect(confirmButton("nintendo", "auto")).toBe("east");
    expect(confirmButton("xbox", "auto")).toBe("south");
    expect(confirmButton("nintendo", "south")).toBe("south");
    expect(padLabels("playstation", "auto")).toMatchObject({ confirm: "✕", back: "○", tabPrev: "L1" });
    expect(padLabels("nintendo", "auto")).toMatchObject({ confirm: "A", back: "B" });
  });
});

describe("PadProcessor", () => {
  it("déclenche une action à l'appui, pas en continu", () => {
    const p = new PadProcessor();
    expect(p.update(pad([0]), "south", 0)).toEqual(["confirm"]);
    expect(p.update(pad([0]), "south", 16)).toEqual([]);
    expect(p.update(pad([]), "south", 32)).toEqual([]);
    expect(p.update(pad([1]), "south", 48)).toEqual(["back"]);
  });

  it("inverse validation et retour en disposition Nintendo", () => {
    const p = new PadProcessor();
    expect(p.update(pad([1]), "east", 0)).toEqual(["confirm"]);
    expect(p.update(pad([0]), "east", 20)).toEqual(["back"]);
  });

  it("répète une direction maintenue après un délai", () => {
    const p = new PadProcessor();
    const seq: string[] = [];
    for (let t = 0; t <= 700; t += 16) seq.push(...p.update(pad([15]), "south", t));
    // 1 appui + répétitions toutes les ~110 ms après 380 ms
    expect(seq[0]).toBe("right");
    expect(seq.length).toBeGreaterThanOrEqual(3);
    expect(seq.length).toBeLessThanOrEqual(5);
  });

  it("stick gauche avec zone morte et gâchettes d'onglets", () => {
    const p = new PadProcessor();
    expect(p.update(pad([], [0.3, 0, 0, 0]), "south", 0)).toEqual([]);
    expect(p.update(pad([], [0, -0.9, 0, 0]), "south", 16)).toEqual(["up"]);
    expect(p.update(pad([4]), "south", 32)).toEqual(["tabPrev"]);
  });
});

import { dropPaging, stickDirection } from "./gamepad";
import { pickInitial } from "./InputController";

describe("navigation à la manette 1.0.31", () => {
  it("reconnaît le Steam Deck et la manette Xbox telle que Linux la nomme", () => {
    expect(detectFamily("Valve Software Steam Deck Controller")).toBe("deck");
    expect(detectFamily("Steam Deck (Vendor: 28de Product: 1205)")).toBe("deck");
    expect(detectFamily("Microsoft X-Box 360 pad")).toBe("xbox");
    expect(padLabels("deck", "auto")).toMatchObject({ confirm: "A", back: "B", tabPrev: "L1", tabNext: "R1" });
  });

  it("stick en diagonale : une seule direction, celle de l'axe le plus poussé", () => {
    const p = new PadProcessor();
    expect(p.update(pad([], [0.8, 0.7, 0, 0]), "south", 0)).toEqual(["right"]);
    expect(stickDirection(0.6, -0.9, null)).toBe("up");
    expect(stickDirection(0.3, 0.3, null)).toBeNull();
  });

  it("stick qui tremble autour du seuil : pas de second appui", () => {
    const p = new PadProcessor();
    const seq: string[] = [];
    [0.6, 0.52, 0.58, 0.5, 0.57, 0.45].forEach((x, i) => seq.push(...p.update(pad([], [x, 0, 0, 0]), "south", i * 16)));
    expect(seq).toEqual(["right"]);
    // relâché pour de bon, puis poussé à nouveau : nouvel appui
    expect(p.update(pad([], [0.2, 0, 0, 0]), "south", 200)).toEqual([]);
    expect(p.update(pad([], [0.7, 0, 0, 0]), "south", 216)).toEqual(["right"]);
  });

  it("l'axe engagé garde la main tant que l'autre ne le dépasse pas nettement", () => {
    expect(stickDirection(0.7, 0.8, "right")).toBe("right");
    expect(stickDirection(0.5, 0.95, "right")).toBe("down");
  });

  it("gâchettes consommées par le zoom du boîtier : pas de saut de page en plus", () => {
    expect(dropPaging(["pageNext", "confirm"], true)).toEqual(["confirm"]);
    expect(dropPaging(["pageNext", "confirm"], false)).toEqual(["pageNext", "confirm"]);
  });

  it("focus initial : autofocus, puis secours, puis hors habillage", () => {
    const item = (autofocus: string | null, chrome = false) => ({ autofocus, chrome });
    // écran sans focus déclaré : pas « Retour » de la barre du haut
    expect(pickInitial([item(null, true), item(null, true), item(null), item(null)])).toBe(2);
    // « Reprendre » désactivé donc absent de la liste : la tuile de secours
    expect(pickInitial([item(null, true), item(null), item("fallback"), item(null)])).toBe(2);
    expect(pickInitial([item(null, true), item("fallback"), item("true")])).toBe(2);
    // seulement de l'habillage (panneau vide) : on le prend quand même
    expect(pickInitial([item(null, true)])).toBe(0);
    expect(pickInitial([])).toBe(-1);
  });
});

import { assignSlots } from "./gamepad";
describe("joueurs", () => {
  it("numérote les manettes et garde les numéros", () => {
    const one = assignSlots([], [{ index: 0, id: "Xbox Controller" }]);
    expect(one.map((p) => p.slot)).toEqual([1]);
    const two = assignSlots(one, [{ index: 0, id: "Xbox Controller" }, { index: 1, id: "Pro Controller" }]);
    expect(two.map((p) => [p.index, p.slot])).toEqual([[0, 1], [1, 2]]);
    // le joueur 1 débranche : le joueur 2 reste joueur 2, une nouvelle manette prend la place 1
    const left = assignSlots(two, [{ index: 1, id: "Pro Controller" }]);
    expect(left.map((p) => p.slot)).toEqual([2]);
    const back = assignSlots(left, [{ index: 1, id: "Pro Controller" }, { index: 2, id: "DualSense" }]);
    expect(back.map((p) => [p.index, p.slot])).toEqual([[2, 1], [1, 2]]);
  });
});

describe("jusqu'à 8 joueurs", () => {
  it("numérote P1 à P8 et ignore une neuvième manette", () => {
    const pads = Array.from({ length: 9 }, (_, i) => ({ index: i, id: `Pad ${i}` }));
    const players = assignSlots([], pads);
    expect(players.map((p) => p.slot)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe("commandes 0.1.65", () => {
  it("gâchettes : défilement rapide par pages, avec répétition", () => {
    const p = new PadProcessor();
    const values = (lt: number, rt: number) => ({ ...pad(), values: Array.from({ length: 17 }, (_, i) => (i === 6 ? lt : i === 7 ? rt : 0)) });
    expect(p.update(values(0.3, 0), "south", 0)).toEqual([]);
    expect(p.update(values(0, 0.8), "south", 16)).toEqual(["pageNext"]);
    const seq: string[] = [];
    for (let t = 32; t <= 1000; t += 16) seq.push(...p.update(values(0, 0.8), "south", t));
    expect(seq.every((a) => a === "pageNext")).toBe(true);
    expect(seq.length).toBeGreaterThanOrEqual(3);
  });

  it("Start, Select, bouton central et clics des sticks", () => {
    const p = new PadProcessor();
    expect(p.update(pad([9]), "south", 0)).toEqual(["menu"]);
    expect(p.update(pad([8]), "south", 16)).toEqual(["search"]);
    expect(p.update(pad([16]), "south", 32)).toEqual(["home"]);
    expect(p.update(pad([10]), "south", 48)).toEqual(["first"]);
    expect(p.update(pad([11]), "south", 64)).toEqual(["last"]);
    // pas de répétition pour ces boutons
    expect(p.update(pad([11]), "south", 900)).toEqual([]);
  });

  it("une direction maintenue longtemps accélère", () => {
    const p = new PadProcessor();
    const count = (from: number, to: number) => {
      let n = 0;
      for (let t = from; t <= to; t += 8) n += p.update(pad([13]), "south", t).length;
      return n;
    };
    const slow = count(0, 1000) - 1; // sans le premier appui
    const fast = count(1400, 2400);
    expect(fast).toBeGreaterThan(slow * 2);
  });
});
