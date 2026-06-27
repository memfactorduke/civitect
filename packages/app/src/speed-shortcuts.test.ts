import { describe, expect, it } from "vitest";
import {
  createSpeedShortcutController,
  type SimSpeed,
  type SpeedShortcutEvent,
} from "./speed-shortcuts";

function key(event: SpeedShortcutEvent): SpeedShortcutEvent {
  return event;
}

describe("speed shortcut controller", () => {
  it("maps desktop number keys to the GDD speed tiers", () => {
    const dispatched: SimSpeed[] = [];
    const controller = createSpeedShortcutController(
      (speed) => dispatched.push(speed),
      () => 1,
    );

    expect(controller.handleKey(key({ key: "0", code: "Digit0" }))).toBe(true);
    expect(controller.handleKey(key({ key: "1", code: "Digit1" }))).toBe(true);
    expect(controller.handleKey(key({ key: "2", code: "Digit2" }))).toBe(true);
    expect(controller.handleKey(key({ key: "3", code: "Digit3" }))).toBe(true);

    expect(dispatched).toEqual([0, 1, 3, 9]);
  });

  it("toggles pause with Space and resumes the last running speed", () => {
    const dispatched: SimSpeed[] = [];
    const controller = createSpeedShortcutController(
      (speed) => dispatched.push(speed),
      () => 3,
    );

    expect(controller.handleKey(key({ key: " ", code: "Space" }))).toBe(true);
    expect(controller.handleKey(key({ key: " ", code: "Space" }))).toBe(true);

    expect(dispatched).toEqual([0, 3]);
  });

  it("keeps rapid shortcuts coherent before the worker snapshot catches up", () => {
    const dispatched: SimSpeed[] = [];
    const controller = createSpeedShortcutController(
      (speed) => dispatched.push(speed),
      () => 1,
    );

    controller.handleKey(key({ key: "2", code: "Digit2" }));
    expect(controller.currentPendingSpeed()).toBe(3);
    controller.handleKey(key({ key: " ", code: "Space" }));
    controller.handleKey(key({ key: " ", code: "Space" }));

    expect(dispatched).toEqual([3, 0, 3]);
    expect(controller.currentLastRunningSpeed()).toBe(3);
  });

  it("clears a pending request when the matching snapshot arrives", () => {
    const dispatched: SimSpeed[] = [];
    const controller = createSpeedShortcutController(
      (speed) => dispatched.push(speed),
      () => 1,
    );

    controller.handleKey(key({ key: "3", code: "Digit3" }));
    expect(controller.currentPendingSpeed()).toBe(9);

    controller.noteSnapshotSpeed(1);
    expect(controller.currentPendingSpeed()).toBe(9);

    controller.noteSnapshotSpeed(9);
    expect(controller.currentPendingSpeed()).toBeNull();
  });

  it("ignores browser chords, shifted digits, and focused controls", () => {
    const dispatched: SimSpeed[] = [];
    const controller = createSpeedShortcutController(
      (speed) => dispatched.push(speed),
      () => 1,
    );
    const button = { tagName: "button" } as unknown as EventTarget;
    const input = { tagName: "input" } as unknown as EventTarget;
    const textbox = {
      getAttribute: (name: string) => (name === "role" ? "textbox" : null),
    } as unknown as EventTarget;

    expect(controller.handleKey(key({ key: "1", code: "Digit1", ctrlKey: true }))).toBe(false);
    expect(controller.handleKey(key({ key: "1", code: "Digit1", metaKey: true }))).toBe(false);
    expect(controller.handleKey(key({ key: "!", code: "Digit1", shiftKey: true }))).toBe(false);
    expect(controller.handleKey(key({ key: " ", code: "Space", target: button }))).toBe(false);
    expect(controller.handleKey(key({ key: "2", code: "Digit2", target: input }))).toBe(false);
    expect(controller.handleKey(key({ key: "3", code: "Digit3", target: textbox }))).toBe(false);

    expect(dispatched).toEqual([]);
  });
});
