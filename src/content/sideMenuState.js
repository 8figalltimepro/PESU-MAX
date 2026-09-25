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

// Widths the site uses for its own toggle.
const MENU_WIDTHS = {
  collapsed: { menu: "4%", content: "96%" },
  expanded: { menu: "15%", content: "85%" }
};
// The site flips the attribute during the click that triggered it.
const CLICK_WINDOW_MS = 1000;

let enabled = false;
let remembered = false;
let userToggledAt = 0;
let siteToggledAt = 0;
let observedMenu = null;

const menu = () => document.querySelector(SIDE_MENU_SELECTOR);
const state = () => (menu() ? menu().getAttribute(SIDE_MENU_STATE_ATTR) : null);

// The site's toggle lives in the page's world, so mirror what it does instead.
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

function saveCollapsed() {
  // An orphaned content script throws instead of saving.
  Promise.resolve()
    .then(() => save(SIDE_MENU_COLLAPSED_KEY, remembered))
    .catch(() => {});
}

// Put our state back after the site resets the menu.
function observeMenu(el) {
  if (!el || el === observedMenu) return;
  observedMenu = el;

  new MutationObserver(() => {
    const current = state();
    if (!current) return;

    // The user's own change.
    if (Date.now() - userToggledAt < CLICK_WINDOW_MS) {
      remembered = current === SIDE_MENU_HIDDEN;
      if (enabled) saveCollapsed();
      return;
    }

    // The site's own narrow-screen collapse stands.
    if (current === SIDE_MENU_HIDDEN && Date.now() - siteToggledAt < CLICK_WINDOW_MS) return;

    // Not the user: the site reset it, put it back.
    if (enabled && current !== (remembered ? SIDE_MENU_HIDDEN : SIDE_MENU_SHOWN)) {
      setCollapsed(remembered);
    }
  }).observe(el, { attributes: true, attributeFilter: [SIDE_MENU_STATE_ATTR] });
}

// The site resets the menu on load and on resize, so put our state back after it.
export async function initSideMenuState() {
  enabled = (await load(SIDE_MENU_STATE_KEY)) === true;
  remembered = (await load(SIDE_MENU_COLLAPSED_KEY)) === true;

  // The site clicks its own toggle on narrow screens, so only real clicks count as the user's.
  document.addEventListener(
    "click",
    (event) => {
      const link = event.target && event.target.closest
        ? event.target.closest(SIDE_MENU_TOGGLE_SELECTOR)
        : null;
      if (!link) return;

      if (event.isTrusted) userToggledAt = Date.now();
      else siteToggledAt = Date.now();
    },
    true
  );

  // The menu is server rendered, but it can show up late or be swapped out later.
  const wire = () => {
    const el = menu();
    if (!el || el === observedMenu) return;

    observeMenu(el);
    // Adopt the saved state once, as soon as the menu shows up.
    if (enabled) setCollapsed(remembered);
  };
  wire();
  new MutationObserver(wire).observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[SIDE_MENU_STATE_KEY]) return;
    enabled = changes[SIDE_MENU_STATE_KEY].newValue === true;
    // Switching it on adopts the current state.
    if (enabled) {
      remembered = state() === SIDE_MENU_HIDDEN;
      saveCollapsed();
    }
  });
}
