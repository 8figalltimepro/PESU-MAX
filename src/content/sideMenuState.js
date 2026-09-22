import { load, save } from "../utils/storage.js";
import { SIDE_MENU_COLLAPSED_KEY, SIDE_MENU_STATE_KEY } from "../utils/storageKeys.js";
import {
  SIDE_MENU_ARROW_SELECTOR,
  SIDE_MENU_CONTENT_SELECTOR,
  SIDE_MENU_HIDDEN,
  SIDE_MENU_NAME_SELECTOR,
  SIDE_MENU_SELECTOR,
  SIDE_MENU_SHOWN,
  SIDE_MENU_STATE_ATTR,
  SIDE_MENU_TOGGLE_SELECTOR
} from "./academyPage.js";

// the widths the site uses for its own toggle
const MENU_WIDTHS = {
  collapsed: { menu: "4%", content: "96%" },
  expanded: { menu: "15%", content: "85%" }
};
// the site flips the attribute during the click that triggered it
const CLICK_WINDOW_MS = 1000;

let remembered = false;
let userToggledAt = 0;

const menu = () => document.querySelector(SIDE_MENU_SELECTOR);
const state = () => (menu() ? menu().getAttribute(SIDE_MENU_STATE_ATTR) : null);

// the site's toggle lives in the page's world, so mirror what it does instead
// ponytail: mirrors the site's widths; jQuery tooltips are left alone
function setCollapsed(collapsed) {
  const el = menu();
  const content = document.querySelector(SIDE_MENU_CONTENT_SELECTOR);
  if (!el || !content || state() === (collapsed ? SIDE_MENU_HIDDEN : SIDE_MENU_SHOWN)) return;

  const width = collapsed ? MENU_WIDTHS.collapsed : MENU_WIDTHS.expanded;
  el.style.width = width.menu;
  content.style.width = width.content;
  document.querySelectorAll(SIDE_MENU_NAME_SELECTOR).forEach((node) => {
    node.style.display = collapsed ? "none" : "inline-block";
  });
  document.querySelectorAll(SIDE_MENU_ARROW_SELECTOR).forEach((node) => {
    node.style.display = collapsed ? "none" : "block";
  });
  el.setAttribute(SIDE_MENU_STATE_ATTR, collapsed ? SIDE_MENU_HIDDEN : SIDE_MENU_SHOWN);
}

// the site resets the menu on load and on resize, so put our state back after it
export async function initSideMenuState() {
  let enabled = (await load(SIDE_MENU_STATE_KEY)) === true;
  remembered = (await load(SIDE_MENU_COLLAPSED_KEY)) === true;
  if (enabled) setCollapsed(remembered);

  // the site clicks its own toggle on narrow screens; only real clicks count
  document.addEventListener(
    "click",
    (event) => {
      const link = event.target && event.target.closest ? event.target.closest(SIDE_MENU_TOGGLE_SELECTOR) : null;
      if (link && event.isTrusted) userToggledAt = Date.now();
    },
    true
  );

  const el = menu();
  if (el) {
    new MutationObserver(() => {
      const current = state();
      if (!current) return;

      // the user's own change
      if (Date.now() - userToggledAt < CLICK_WINDOW_MS) {
        remembered = current === SIDE_MENU_HIDDEN;
        if (enabled) {
          // an orphaned content script throws instead of saving
          Promise.resolve()
            .then(() => save(SIDE_MENU_COLLAPSED_KEY, remembered))
            .catch(() => {});
        }
        return;
      }

      // not the user: the site reset it, put it back
      if (enabled && current !== (remembered ? SIDE_MENU_HIDDEN : SIDE_MENU_SHOWN)) setCollapsed(remembered);
    }).observe(el, { attributes: true, attributeFilter: [SIDE_MENU_STATE_ATTR] });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[SIDE_MENU_STATE_KEY]) return;
    enabled = changes[SIDE_MENU_STATE_KEY].newValue === true;
    // switching it on adopts the current state
    if (enabled) {
      remembered = state() === SIDE_MENU_HIDDEN;
      save(SIDE_MENU_COLLAPSED_KEY, remembered).catch(() => {});
    }
  });
}
