import { load } from "../utils/storage.js";

export const TOP_BAR_KEY = "hideTopBarEnabled";
const STYLE_ID = "pesu-max-hide-top-bar-style";

// The site's own top bar, plus the 52px the layout reserves for it.
const CSS = `
  #pge_menu { display: none !important; }
  body > .content-wrapper { padding-top: 0 !important; }
`;

function apply(enabled) {
  const existing = document.getElementById(STYLE_ID);

  if (!enabled) {
    if (existing) existing.remove();
    return;
  }

  if (existing) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

// Off until it is switched on in Settings.
export async function initHideTopBar() {
  apply((await load(TOP_BAR_KEY)) === true);

  // Take effect as soon as the setting is switched.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[TOP_BAR_KEY]) apply(changes[TOP_BAR_KEY].newValue === true);
  });
}
