import { load } from "../../utils/storage.js";
import { MENU_ICONS_KEY } from "../../utils/storageKeys.js";
import { MENU_ICONS_ATTR, applyMenuIcons } from "./menuIconsApply.js";
import { writeMenuIconsMirror } from "./menuIconsMirror.js";

function setEnabled(enabled) {
  applyMenuIcons(enabled);
  writeMenuIconsMirror(enabled);
  if (enabled) document.documentElement.setAttribute(MENU_ICONS_ATTR, "");
  else document.documentElement.removeAttribute(MENU_ICONS_ATTR);
}

// Off by default
export async function initMenuIcons() {
  setEnabled((await load(MENU_ICONS_KEY)) === true);

  new MutationObserver(() => {
    applyMenuIcons(document.documentElement.hasAttribute(MENU_ICONS_ATTR));
  }).observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[MENU_ICONS_KEY]) return;
    setEnabled(changes[MENU_ICONS_KEY].newValue === true);
  });
}
