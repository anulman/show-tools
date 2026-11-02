const modelNames = {
  "box-mount": "Arcade button",
  "disco-bar": "Disco ball",
  "all-controls": "All controls",
};
type Model = keyof typeof modelNames;

function modelFromAttribute(value: string | undefined): Model {
  if (value === "box-mount" || value === "disco-bar" || value === "all-controls") return value;
  throw new Error("Unknown CAD workstream");
}

function element<T extends Element>(selector: string): T {
  const result = document.querySelector<T>(selector);
  if (!result) throw new Error(`Missing CAD desk element: ${selector}`);
  return result;
}

const panel = element<HTMLElement>("#model-panel");
const statusMessage = element<HTMLParagraphElement>("#status");
const overlay = element<HTMLDivElement>("#busy");
const viewer = element<HTMLIFrameElement>("#viewer");
const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-model]"));
let selected = modelFromAttribute(document.body.dataset.selected);
let building = false;

function markSelected(model: Model): void {
  for (const tab of tabs) {
    const active = modelFromAttribute(tab.dataset.model) === model;
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
    if (active) panel.setAttribute("aria-labelledby", tab.id);
  }
}

async function select(model: Model): Promise<void> {
  if (building) return;
  building = true;
  const name = modelNames[model];
  statusMessage.textContent = `Building ${name} preview…`;
  overlay.hidden = false;
  panel.setAttribute("aria-busy", "true");
  for (const tab of tabs) tab.disabled = true;
  try {
    const response = await fetch(`/select/${model}`, { method: "POST" });
    if (!response.ok) throw new Error(await response.text());
    selected = model;
    markSelected(model);
    statusMessage.textContent = `${name} · Ready to inspect`;
  } catch (error) {
    statusMessage.textContent = error instanceof Error ? error.message : "Preview unavailable. Try again.";
  } finally {
    building = false;
    panel.setAttribute("aria-busy", "false");
    overlay.hidden = true;
    for (const tab of tabs) tab.disabled = false;
  }
}

markSelected(selected);
for (const [index, tab] of tabs.entries()) {
  tab.addEventListener("click", () => void select(modelFromAttribute(tab.dataset.model)));
  tab.addEventListener("keydown", (event) => {
    const target = event.key === "ArrowRight" ? tabs[(index + 1) % tabs.length]
      : event.key === "ArrowLeft" ? tabs[(index + tabs.length - 1) % tabs.length]
      : event.key === "Home" ? tabs[0] : event.key === "End" ? tabs.at(-1) : undefined;
    if (target) {
      event.preventDefault();
      target.focus();
    }
  });
}
// Publish after the embedded viewer has loaded, including on a page refresh.
viewer.addEventListener("load", () => void select(selected));

viewer.src = "http://127.0.0.1:3939/viewer";

export {};
