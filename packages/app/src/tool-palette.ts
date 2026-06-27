export type ToolMode = "select" | "road" | "bulldoze";

interface ToolOption {
  readonly id: ToolMode;
  readonly label: string;
  readonly shortcut: string;
  readonly title: string;
}

const TOOL_OPTIONS: readonly ToolOption[] = [
  {
    id: "select",
    label: "Select",
    shortcut: "S",
    title: "Select and inspect city tiles",
  },
  {
    id: "road",
    label: "Road",
    shortcut: "R",
    title: "Draw streets by dragging across the map",
  },
  {
    id: "bulldoze",
    label: "Doze",
    shortcut: "B",
    title: "Remove roads by dragging across them",
  },
];

export interface ToolPalette {
  readonly current: () => ToolMode;
  setTool(tool: ToolMode): void;
  destroy(): void;
}

export function createToolPalette(
  host: HTMLElement,
  options: {
    readonly initialTool: ToolMode;
    readonly onSelect: (tool: ToolMode) => void;
  },
): ToolPalette {
  const buttons = new Map<ToolMode, HTMLButtonElement>();
  const listeners: Array<readonly [HTMLButtonElement, () => void]> = [];
  let current = options.initialTool;

  host.replaceChildren();
  host.setAttribute("role", "toolbar");
  host.setAttribute("aria-label", "Tools");

  const updatePressed = (): void => {
    for (const [tool, button] of buttons) {
      button.setAttribute("aria-pressed", String(tool === current));
    }
  };

  for (const tool of TOOL_OPTIONS) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.tool = tool.id;
    button.title = `${tool.title} (${tool.shortcut})`;
    button.setAttribute("aria-label", `${tool.label} tool`);
    const shortcut = document.createElement("span");
    shortcut.className = "tool-palette__key";
    shortcut.textContent = tool.shortcut;
    const label = document.createElement("span");
    label.textContent = tool.label;
    button.append(shortcut, label);
    const onClick = (): void => {
      current = tool.id;
      updatePressed();
      options.onSelect(tool.id);
    };
    button.addEventListener("click", onClick);
    buttons.set(tool.id, button);
    listeners.push([button, onClick]);
    host.appendChild(button);
  }

  updatePressed();

  return {
    current: () => current,
    setTool(tool: ToolMode): void {
      current = tool;
      updatePressed();
    },
    destroy(): void {
      for (const [button, listener] of listeners) {
        button.removeEventListener("click", listener);
      }
      host.replaceChildren();
    },
  };
}
