import { Array } from "effect";

import { defaultAppearance } from "../domain/clientSchema";
import { everyBeamImage } from "../render/cellarDark";
import { everyRoomImage } from "../render/room/room";
import { tallCoverOf } from "../render/room/tallCover";
import { CALLINGS } from "../world/heroes/calling";
import { levelFor } from "../world/level/arena";
import { EVERY_LEVEL_SPEC } from "../world/level/plan";
import { playerSprites } from "./appearance";
import { SEAT_LOOKS } from "./seatLooks";

// NOTE: most sprites are built as their modules load, and the atlas
// generator (tools/sprites/build.ts) finds them by loading the modules. These
// are the ones built later, on first use: the starting look's frames in each
// calling's prop, the looks co-op teammates wear by seat in each calling's
// prop, every level's room images, each room with each set of its own
// exits open (the occluders are crops of those images), each level's tall
// furniture, baked on its own to stand in front of whoever is behind it
// (src/render/room/tallCover.ts), and the cellar's flashlight beams, one for
// each direction and pool. A sprite built
// lazily belongs here, or it is encoded at runtime instead of drawn from the
// atlas, and tools/sprites/atlas.test.ts fails.

export const precompileSprites = (): void => {
  Array.forEach(CALLINGS, (calling) =>
    playerSprites(defaultAppearance, calling),
  );
  Array.forEach(SEAT_LOOKS, (look) =>
    Array.forEach(CALLINGS, (calling) => playerSprites(look, calling)),
  );
  Array.forEach(EVERY_LEVEL_SPEC, (spec) => {
    everyRoomImage(spec);
    tallCoverOf(levelFor(spec));
  });
  everyBeamImage();
};
