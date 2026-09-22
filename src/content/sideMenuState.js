import { load, save } from "../utils/storage.js";

export const SIDE_MENU_STATE_KEY = "sideMenuStateEnabled";
const COLLAPSED_KEY = "sideMenuCollapsed";
const MENU_SELECTOR = ".menu-left";
const CONTENT_SELECTOR = ".content-right";
const TOGGLE_SELECTOR = "a.lefttogglemenulink";
const ATTR = "data-name";
const SHOWN = "shown";
const HIDDEN = "hidden";
// the site flips the attribute during the click that triggered it
const CLICK_WINDOW_MS = 1000;

let remembered = false;
let userToggledAt = 0;

const menu = () => document.querySelector(MENU_SELECTOR);
const state = () => (menu() ? menu().getAttribute(ATTR) : null);

// the site's toggle lives in the page's world, so mirror what it does instead
// ponytail: mirrors the site's widths; jQuery tooltips are left alone
function setCollapsed(collapsed) {
  const el = menu();
  const content = document.querySelector(CONTENT_SELECTOR);
  if (!el || !content || state() === (collapsed ? HIDDEN : SHOWN)) return;

  el.style.width = collapsed ? "4%" : "15%";
  content.style.width = collapsed ? "96%" : "85%";
  document.querySelectorAll(".menu-name").forEach((node) => {
    node.style.display = collapsed ? "none" : "inline-block";
  });
  document.querySelectorAll(".dropdown-arrow").forEach((node) => {
    node.style.display = collapsed ? "none" : "block";
  });
  el.setAttribute(ATTR, collapsed ? HIDDEN : SHOWN);
}

// the site resets the menu on load and on resize, so put our state back after it
export async function initSideMenuState() {
  let enabled = (await load(SIDE_MENU_STATE_KEY)) === true;
  remembered = (await load(COLLAPSED_KEY)) === true;
  if (enabled) setCollapsed(remembered);

  // the site clicks its own toggle on narrow screens; only real clicks count
  document.addEventListener(
    "click",
    (event) => {
      const link = event.target && event.target.closest ? event.target.closest(TOGGLE_SELECTOR) : null;
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
        remembered = current === HIDDEN;
        if (enabled) {
          // an orphaned content script throws instead of saving
          Promise.resolve()
            .then(() => save(COLLAPSED_KEY, remembered))
            .catch(() => {});
        }
        return;
      }

      // not the user: the site reset it, put it back
      if (enabled && current !== (remembered ? HIDDEN : SHOWN)) setCollapsed(remembered);
    }).observe(el, { attributes: true, attributeFilter: [ATTR] });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[SIDE_MENU_STATE_KEY]) return;
    enabled = changes[SIDE_MENU_STATE_KEY].newValue === true;
    // switching it on adopts the current state
    if (enabled) {
      remembered = state() === HIDDEN;
      save(COLLAPSED_KEY, remembered).catch(() => {});
    }
  });
}
