import { Option } from "effect";
import { Command, given, message, model, story } from "foldkit/story";
import { modifyFields } from "foldkit/struct";
import { describe, expect, test } from "vitest";

import { KITCHEN_FIRST_WAVE, SHOP_FIRST_WAVE } from "./constants";
import { isPracticeGateHeld } from "./lessons";
import { Message } from "./message";
import {
  BreakClock,
  DifficultyCard,
  Lesson,
  type Model,
  Phase,
  RunMode,
  SOLO_SLOT,
  Tour,
  type TutorialChoice,
  freshLessons,
} from "./model";
import { DISTANT_SPAWN, newPlayerReady } from "./model.fixture";
import { isLearned } from "./onboarding";
import { update } from "./pureApp";
import { decodeSave, encodeSave, restoreSave, saveOf } from "./save";
import { isFirstPlankFree } from "./shop";
import { closeDialog, hintIds, nextFrame, showDialog, tick } from "./testing";
import { isKitchenTourOn } from "./tutorialRules";
import { FocusTutorialReset, WriteSave } from "./update/save";

// NOTE: the first-run card's TUTORIAL or SKIP IT (owner, 2026-11-07). SKIP
// IT starts the run as a returning player's: no practice gate, no move or
// aim hints, no guided first break, no kitchen tour, kept in the save. The
// default still plays the tutorial, and Settings' Reset tutorial brings it
// back.

const firstVisit: Model = modifyFields(newPlayerReady, {
  saveStatus: () => "Read",
});

const chooseTutorial = (choice: TutorialChoice) =>
  message(Message.ClickedTutorialChoiceButton({ choice }));

const pickNormal = message(
  Message.ClickedDifficultyCardButton({ difficulty: "Normal" }),
);

// NOTE: the same player at the break before `wave`, a frame in, so the
// guided first break has had its chance to start.
const atBreakBefore = (current: Model, wave: number): Model =>
  nextFrame(
    modifyFields(current, {
      phase: () =>
        Phase.Preparation({
          wave,
          remainingMs: 20_000,
          durationMs: 20_000,
          spawns: [DISTANT_SPAWN],
          clock: BreakClock.Waiting({ elapsedMs: 0 }),
        }),
    }),
  );

const isGuidedFirstBreakOn = (current: Model): boolean => {
  const firstBreak = atBreakBefore(current, SHOP_FIRST_WAVE);
  return (
    Tour.isAnyOf(["Running"])(firstBreak.firstBreakQuest) ||
    isFirstPlankFree(firstBreak, SOLO_SLOT, "Barricade")
  );
};

const isKitchenTourDue = (current: Model): boolean =>
  isKitchenTourOn(
    modifyFields(current, {
      phase: () =>
        Phase.Preparation({
          wave: KITCHEN_FIRST_WAVE,
          remainingMs: 15_000,
          durationMs: 15_000,
          spawns: [],
        }),
    }),
  );

// NOTE: the save the run wrote, through JSON and back into a fresh Model,
// as the next visit reads it.
const reloaded = (current: Model): Model =>
  restoreSave(
    newPlayerReady,
    Option.getOrThrow(
      Option.flatMap(encodeSave(saveOf(current)), (json) => decodeSave(json)),
    ),
  );

describe("the first-run card", () => {
  test("TUTORIAL is lit by default, and SKIP IT stays lit until a difficulty starts the run", () => {
    story(
      update,
      given(firstVisit),
      message(Message.ClickedCampaignButton()),
      showDialog(),
      model((current) => {
        expect(current.difficultyCard).toEqual(
          DifficultyCard.Asking({
            mode: RunMode.Campaign(),
            tutorial: "Tutorial",
          }),
        );
      }),
      chooseTutorial("Skip"),
      model((current) => {
        expect(current.difficultyCard).toEqual(
          DifficultyCard.Asking({ mode: RunMode.Campaign(), tutorial: "Skip" }),
        );
        expect(current.lessons).toEqual(freshLessons);
      }),
      chooseTutorial("Tutorial"),
      model((current) => {
        expect(current.difficultyCard).toEqual(
          DifficultyCard.Asking({
            mode: RunMode.Campaign(),
            tutorial: "Tutorial",
          }),
        );
      }),
    );
  });

  test("a tutorial pick with no card up does nothing", () => {
    story(
      update,
      given(firstVisit),
      chooseTutorial("Skip"),
      Command.expectNone(),
      model((current) => {
        expect(current.difficultyCard).toEqual(DifficultyCard.Unseen());
        expect(current.lessons).toEqual(freshLessons);
      }),
    );
  });

  test("SKIP IT and a difficulty start a run with no practice gate, no hints, no guided first break, and no kitchen tour, kept in the save", () => {
    story(
      update,
      given(firstVisit),
      message(Message.ClickedCampaignButton()),
      showDialog(),
      chooseTutorial("Skip"),
      pickNormal,
      closeDialog(),
      Command.expectHas(WriteSave),
      model((current) => {
        expect(saveOf(current).onboarding.lessons).toEqual({
          move: "Learned",
          fire: "Learned",
          startWave: "Pending",
          shop: "Pending",
          swap: "Pending",
          pickup: "Pending",
          timedBreaks: "Learned",
          openBreak: "Learned",
        });
      }),
      Command.resolve(WriteSave, Message.CompletedWriteSave()),
      tick(50),
      tick(3000),
      model((current) => {
        expect(Phase.guards.Preparation(current.phase)).toBe(true);
        expect(current.difficulty.chosen).toBe("Normal");
        expect(isPracticeGateHeld(current)).toBe(false);
        expect(hintIds(current)).toEqual([]);
        expect(isGuidedFirstBreakOn(current)).toBe(false);
        expect(isKitchenTourDue(current)).toBe(false);

        const nextVisit = reloaded(current);
        expect(isLearned(nextVisit.lessons.move)).toBe(true);
        expect(isLearned(nextVisit.lessons.fire)).toBe(true);
        expect(isGuidedFirstBreakOn(nextVisit)).toBe(false);
        expect(isKitchenTourDue(nextVisit)).toBe(false);
        expect(nextVisit.introducedKinds).toEqual([]);
      }),
    );
  });

  test("TUTORIAL, the default, starts the tutorial", () => {
    story(
      update,
      given(firstVisit),
      message(Message.ClickedCampaignButton()),
      showDialog(),
      pickNormal,
      closeDialog(),
      Command.resolve(WriteSave, Message.CompletedWriteSave()),
      tick(50),
      tick(3000),
      model((current) => {
        expect(Phase.guards.Preparation(current.phase)).toBe(true);
        expect(isPracticeGateHeld(current)).toBe(true);
        expect(hintIds(current)).toContain("Move");
        expect(isGuidedFirstBreakOn(current)).toBe(true);
        expect(isKitchenTourDue(current)).toBe(true);
        expect(current.lessons.openBreak).toEqual(Lesson.Pending());
      }),
    );
  });

  test("Settings' Reset tutorial brings a skipped tutorial back", () => {
    const skipped = reloaded(
      update(
        update(
          update(firstVisit, Message.ClickedCampaignButton()).model,
          Message.ClickedTutorialChoiceButton({ choice: "Skip" }),
        ).model,
        Message.ClickedDifficultyCardButton({ difficulty: "Normal" }),
      ).model,
    );
    story(
      update,
      given(modifyFields(skipped, { saveStatus: () => "Read" })),
      model((current) => {
        expect(isGuidedFirstBreakOn(current)).toBe(false);
      }),
      message(Message.ClickedSettingsButton()),
      showDialog(),
      message(Message.ClickedResetTutorialButton()),
      Command.resolve(
        FocusTutorialReset,
        Message.CompletedFocusTutorialReset(),
      ),
      message(Message.ClickedConfirmResetTutorialButton()),
      Command.expectHas(WriteSave),
      model((current) => {
        expect(current.lessons).toEqual(freshLessons);
        expect(isGuidedFirstBreakOn(current)).toBe(true);
        expect(isKitchenTourDue(current)).toBe(true);
      }),
      Command.resolve(
        FocusTutorialReset,
        Message.CompletedFocusTutorialReset(),
      ),
      Command.resolve(WriteSave, Message.CompletedWriteSave()),
    );
  });
});
