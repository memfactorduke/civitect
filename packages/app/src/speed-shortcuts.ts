export type SimSpeed = 0 | 1 | 3 | 9;

export interface SpeedShortcutEvent {
  readonly key: string;
  readonly code?: string;
  readonly target?: EventTarget | null;
  readonly altKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly shiftKey?: boolean;
}

export interface SpeedShortcutController {
  handleKey(event: SpeedShortcutEvent): boolean;
  noteSnapshotSpeed(speed: number): void;
  currentPendingSpeed(): SimSpeed | null;
  currentLastRunningSpeed(): SimSpeed;
}

function normalizeSpeed(speed: number): SimSpeed | null {
  if (speed === 0 || speed === 1 || speed === 3 || speed === 9) {
    return speed;
  }
  return null;
}

function normalizeRunningSpeed(speed: number): Exclude<SimSpeed, 0> {
  return speed === 3 || speed === 9 ? speed : 1;
}

function isInteractiveTarget(target: EventTarget | null | undefined): boolean {
  if (target === null || target === undefined) {
    return false;
  }
  const node = target as {
    readonly tagName?: unknown;
    readonly isContentEditable?: unknown;
    getAttribute?: (name: string) => string | null;
  };
  if (node.isContentEditable === true) {
    return true;
  }
  const tagName = typeof node.tagName === "string" ? node.tagName.toLowerCase() : "";
  if (
    tagName === "a" ||
    tagName === "button" ||
    tagName === "input" ||
    tagName === "select" ||
    tagName === "textarea"
  ) {
    return true;
  }
  const role = node.getAttribute?.("role");
  return (
    role === "button" ||
    role === "combobox" ||
    role === "slider" ||
    role === "spinbutton" ||
    role === "textbox" ||
    node.getAttribute?.("contenteditable") === "true"
  );
}

function isSpace(event: SpeedShortcutEvent): boolean {
  return event.code === "Space" || event.key === " " || event.key === "Spacebar";
}

function digitShortcut(event: SpeedShortcutEvent): SimSpeed | null {
  const code = event.code ?? "";
  if (event.key === "0" || code === "Digit0" || code === "Numpad0") {
    return 0;
  }
  if (event.key === "1" || code === "Digit1" || code === "Numpad1") {
    return 1;
  }
  if (event.key === "2" || code === "Digit2" || code === "Numpad2") {
    return 3;
  }
  if (event.key === "3" || code === "Digit3" || code === "Numpad3") {
    return 9;
  }
  return null;
}

function speedFromShortcut(
  event: SpeedShortcutEvent,
  currentSpeed: SimSpeed,
  lastRunningSpeed: SimSpeed,
): SimSpeed | null {
  if (event.altKey === true || event.ctrlKey === true || event.metaKey === true) {
    return null;
  }
  if (isInteractiveTarget(event.target)) {
    return null;
  }
  if (isSpace(event)) {
    return currentSpeed === 0 ? normalizeRunningSpeed(lastRunningSpeed) : 0;
  }
  if (event.shiftKey === true) {
    return null;
  }
  return digitShortcut(event);
}

export function createSpeedShortcutController(
  dispatchSpeed: (speed: SimSpeed) => void,
  getCurrentSpeed: () => number,
): SpeedShortcutController {
  let pendingSpeed: SimSpeed | null = null;
  let lastRunningSpeed: SimSpeed = 1;

  const observedSpeed = (): SimSpeed => pendingSpeed ?? normalizeSpeed(getCurrentSpeed()) ?? 1;

  const rememberRunningSpeed = (speed: number): void => {
    const normalized = normalizeSpeed(speed);
    if (normalized !== null && normalized !== 0) {
      lastRunningSpeed = normalized;
    }
  };

  return {
    handleKey(event) {
      const currentSpeed = observedSpeed();
      const nextSpeed = speedFromShortcut(event, currentSpeed, lastRunningSpeed);
      if (nextSpeed === null) {
        return false;
      }
      rememberRunningSpeed(currentSpeed);
      rememberRunningSpeed(nextSpeed);
      pendingSpeed = nextSpeed;
      dispatchSpeed(nextSpeed);
      return true;
    },

    noteSnapshotSpeed(speed) {
      const normalized = normalizeSpeed(speed);
      if (normalized === null) {
        return;
      }
      rememberRunningSpeed(normalized);
      if (pendingSpeed === normalized) {
        pendingSpeed = null;
      }
    },

    currentPendingSpeed() {
      return pendingSpeed;
    },

    currentLastRunningSpeed() {
      return lastRunningSpeed;
    },
  };
}
