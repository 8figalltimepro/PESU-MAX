import { load, save } from "../utils/storage.js";
import theme from "../../frontend/Themes/theme.jsx";

const STORAGE_KEY = "sideMenuOrder";
const LOG_PREFIX = "PESU-MAX:";
const MENU_LIST_ID = "studentProfilePESUHomeMenu";
const MENU_ITEM_SELECTOR = `#${MENU_LIST_ID} > li[id^="menuTab_"]`;
const HOME_URL_MARKER = "/Home/";
const STYLE_ID = "pesu-max-menu-reorder-style";
const DRAGGING = "pesu-max-menu-dragging";
const DROP_ABOVE = "pesu-max-menu-drop-above";
const DROP_BELOW = "pesu-max-menu-drop-below";

let savedOrder = [];
const wiredLists = new WeakSet();

const menuItems = (list) =>
  [...list.children].filter((el) => el.tagName === "LI" && el.id.startsWith("menuTab_"));

// Home stays pinned first, so it is never draggable nor droppable-on-top-of.
const isHome = (item) => !!item && (item.getAttribute("data-url") || "").includes(HOME_URL_MARKER);

// savedOrder first, then anything the user has not touched in the order the page rendered it
function computeOrder(itemIds, order, homeId) {
  const present = new Set(itemIds);
  const wanted = [];
  const seen = new Set();

  const push = (id) => {
    if (present.has(id) && !seen.has(id)) {
      wanted.push(id);
      seen.add(id);
    }
  };

  if (homeId) push(homeId);
  (order || []).forEach(push);
  itemIds.forEach(push);

  return wanted;
}

function applyOrder(list) {
  const items = menuItems(list);
  if (!items.length) return;

  const current = items.map((item) => item.id);
  const home = items.find(isHome);
  const wanted = computeOrder(current, savedOrder, home ? home.id : null);
  if (wanted.length === current.length && wanted.every((id, index) => id === current[index])) return;

  const byId = new Map(items.map((item) => [item.id, item]));
  wanted.forEach((id) => list.appendChild(byId.get(id)));
}

function makeDraggable(list) {
  menuItems(list).forEach((item) => {
    item.draggable = !isHome(item);
    const link = item.querySelector("a");
    if (link) link.draggable = false; // otherwise the browser starts a native link drag
  });
}

function rememberOrder(list) {
  savedOrder = menuItems(list).map((item) => item.id);
}

function persist(order) {
  // an orphaned content script (extension reloaded while the page stayed open)
  // throws here instead of saving; the drag itself should still work
  return Promise.resolve()
    .then(() => save(STORAGE_KEY, order))
    .catch((error) => {
      console.warn(`${LOG_PREFIX} menu order could not be saved`, error);
    });
}

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    ${MENU_ITEM_SELECTOR} { cursor: grab; }
    ${MENU_ITEM_SELECTOR}.${DRAGGING} { cursor: grabbing; opacity: 0.5; }
    ${MENU_ITEM_SELECTOR}.${DROP_ABOVE} { box-shadow: inset 0 3px 0 0 ${theme.colors.secondary}; }
    ${MENU_ITEM_SELECTOR}.${DROP_BELOW} { box-shadow: inset 0 -3px 0 0 ${theme.colors.secondary}; }
  `;
  document.head.appendChild(style);
}

function enableReordering(list) {
  let dragged = null;

  const clearMarks = () =>
    menuItems(list).forEach((item) => item.classList.remove(DROP_ABOVE, DROP_BELOW));
  const mark = (item, above) => {
    clearMarks();
    item.classList.add(above ? DROP_ABOVE : DROP_BELOW);
  };
  const targetItem = (event) => {
    const item = event.target.closest("li");
    return item && list.contains(item) ? item : null;
  };

  list.addEventListener("dragstart", (event) => {
    const item = targetItem(event);
    if (!item || isHome(item)) return event.preventDefault();
    dragged = item;
    item.classList.add(DRAGGING);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", item.id);
  });

  list.addEventListener("dragover", (event) => {
    const item = targetItem(event);
    if (!dragged || !item || item === dragged) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (isHome(item)) return mark(item, false);
    const box = item.getBoundingClientRect();
    mark(item, event.clientY < box.top + box.height / 2);
  });

  list.addEventListener("drop", (event) => {
    const item = targetItem(event);
    if (!dragged || !item || item === dragged) return;
    event.preventDefault();
    if (isHome(item) || !item.classList.contains(DROP_ABOVE)) item.after(dragged);
    else item.before(dragged);
    // the move above is a DOM mutation: sync() runs on the next mutation batch and
    // would put the pre-drag order back unless it is told what we just did
    rememberOrder(list);
  });

  // dragend always fires, whether the item was dropped or the drag was cancelled,
  // so the DOM is the single source of truth for what gets persisted.
  list.addEventListener("dragend", () => {
    if (!dragged) return;
    dragged.classList.remove(DRAGGING);
    dragged = null;
    clearMarks();
    rememberOrder(list);
    persist(savedOrder);
  });
}

function sync() {
  const list = document.getElementById(MENU_LIST_ID);
  if (!list) return;
  applyOrder(list);
  makeDraggable(list);
  if (wiredLists.has(list)) return;
  wiredLists.add(list);
  injectStyle();
  enableReordering(list);
}

export function initMenuReorder() {
  const list = document.getElementById(MENU_LIST_ID);
  // the page renders the menu in its natural order, so it is hidden for the
  // split second it takes to read the saved order back out of storage
  const reveal = () => {
    if (list) list.style.visibility = "";
  };
  if (list) list.style.visibility = "hidden";
  // a reloaded extension drops the pending storage callback, so never rely on
  // the promise alone to put the menu back
  const failsafe = setTimeout(reveal, 1000);

  // the menu is server rendered once per page load, but it can still be swapped
  // out later; sync() is idempotent and cheap, so re-run it on DOM changes
  new MutationObserver(sync).observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
  });

  // drag handles go up first: an extension reloaded while this page stayed open
  // leaves this script orphaned, and chrome.storage answers nothing at all then
  sync();
  load(STORAGE_KEY)
    .then((order) => {
      savedOrder = order || [];
      sync();
    })
    .catch((error) => {
      console.warn(`${LOG_PREFIX} saved menu order is not readable, reordering will not persist`, error);
    })
    .finally(() => {
      clearTimeout(failsafe);
      reveal();
    });
}
