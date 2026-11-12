import { Array, Option } from "effect";
import { modifyFields } from "foldkit/struct";
import { describe, expect, test } from "vitest";

import type { Model } from "../../app/model";
import { quietWave, withPlayerAt } from "../../test/model.fixture";
import { CELLAR_SPOT, zombieAt } from "../../test/testing";
import { openExitIn } from "../../world/level/arena";
import { modifyFocus } from "../../world/party/party";
import { EAST_EXIT, FAR_EXIT } from "../../world/level/plan";
import { TOOL_RULES } from "../../world/stations/toolRules";
import type { Camera } from "../camera";
import { cellarDarkOf } from "../cellarDark";

// The cellar's dark (src/render/cellarDark.ts): a mask over the part of
// the cellar on the camera, lit round each player, each shot, and the bulb.
// A zombie in it is not drawn at all (no eyes, bar, or shadow) unless it is
// close to the viewing player, fading in over the last tile, or in their
// flashlight's beam the way they face; a lit cellar draws every zombie.

const CELLAR_CAMERA: Camera = {
  x: 680,
  y: 0,
  width: 320,
  height: 180,
  scale: 1,
  left: 0,
  top: 0,
};

const DINING_CAMERA: Camera = { ...CELLAR_CAMERA, x: 20 };

const inCellar = (model: Model): Model =>
  withPlayerAt(
    modifyFields(model, {
      level: (state) => openExitIn(openExitIn(state, EAST_EXIT), FAR_EXIT),
    }),
    CELLAR_SPOT.x,
    CELLAR_SPOT.y,
  );

const NEAR = zombieAt(1, CELLAR_SPOT.x + 12, CELLAR_SPOT.y);
const FAR_OFF = zombieAt(2, 960, 30);

const darkOf = (model: Model, camera: Camera) => cellarDarkOf(model, camera);

describe("the cellar dark", () => {
  test("is only over the cellar, once it is open and on the camera", () => {
    expect(Option.isNone(darkOf(quietWave(4), CELLAR_CAMERA))).toBe(true);
    expect(Option.isSome(darkOf(inCellar(quietWave(4)), CELLAR_CAMERA))).toBe(
      true,
    );
    expect(Option.isNone(darkOf(inCellar(quietWave(4)), DINING_CAMERA))).toBe(
      true,
    );
  });

  test("costs a few shapes, the pools drawn as crops of baked images", () => {
    const dark = Option.getOrThrow(
      darkOf(inCellar(quietWave(4)), CELLAR_CAMERA),
    );
    expect(dark.maskShapes.length).toBeLessThanOrEqual(30);
    expect(
      Array.filter(dark.maskShapes, ({ _tag }) => _tag === "Image").length,
    ).toBeGreaterThan(0);
  });

  test("draws nothing of a zombie far in the dark, and all of a near one", () => {
    const dark = Option.getOrThrow(
      darkOf(inCellar(quietWave(4)), CELLAR_CAMERA),
    );
    expect(dark.fadeOf(NEAR)).toBe(1);
    expect(dark.fadeOf(FAR_OFF)).toBe(0);
  });

  test("fades a zombie in over the last tile, by the viewing player", () => {
    const fading = zombieAt(3, CELLAR_SPOT.x - 25, CELLAR_SPOT.y);
    const dark = Option.getOrThrow(
      darkOf(inCellar(quietWave(4)), CELLAR_CAMERA),
    );
    expect(dark.fadeOf(fading)).toBeGreaterThan(0);
    expect(dark.fadeOf(fading)).toBeLessThan(1);
  });

  test("shows a zombie far off in the beam the way the player faces", () => {
    const ahead = zombieAt(5, CELLAR_SPOT.x + 60, CELLAR_SPOT.y);
    const behind = zombieAt(6, CELLAR_SPOT.x - 60, CELLAR_SPOT.y);
    const facingRight = inCellar(quietWave(4));
    const facingLeft = modifyFocus(facingRight, {
      player: (player) =>
        modifyFields(player, { facing: () => ({ x: -1, y: 0 }) }),
    });
    const right = Option.getOrThrow(darkOf(facingRight, CELLAR_CAMERA));
    const left = Option.getOrThrow(darkOf(facingLeft, CELLAR_CAMERA));
    expect([right.fadeOf(ahead), right.fadeOf(behind)]).toEqual([1, 0]);
    expect([left.fadeOf(ahead), left.fadeOf(behind)]).toEqual([0, 1]);
  });

  test("draws a zombie outside the cellar as usual", () => {
    const dark = Option.getOrThrow(
      darkOf(inCellar(quietWave(4)), CELLAR_CAMERA),
    );
    expect(dark.fadeOf(zombieAt(4, 40, 60))).toBe(1);
  });

  test("a lit cellar has no dark, so it draws both", () => {
    const lit = modifyFields(inCellar(quietWave(4)), {
      stations: (stations) => ({
        ...stations,
        Bulb: {
          workedMs: 0,
          cooldownMs: TOOL_RULES.Bulb.cooldownMs - 1,
          timesWorked: 1,
        },
      }),
    });
    expect(Option.isNone(darkOf(lit, CELLAR_CAMERA))).toBe(true);
  });
});
