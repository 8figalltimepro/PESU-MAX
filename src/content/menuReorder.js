import { load, save } from "../utils/storage.js";
import theme from "../../frontend/Themes/theme.jsx";

const STORAGE_KEY = "sideMenuOrder";
const LOG_PREFIX = "PESU-MAX:";
const MENU_LIST_ID = "studentProfilePESUHomeMenu";
const HOME_URL_MARKER = "/Home/";
const STYLE_ID = "pesu-max-menu-reorder-style";
const BAR_ID = "pesu-max-menu-edit-bar";
const CLASS = "pesu-max-menu";
const EDITING = `${CLASS}-editing`;
const HOME_LOCKED = `${CLASS}-home-locked`;
const DRAGGING = `${CLASS}-dragging`;
const DROP_ABOVE = `${CLASS}-drop-above`;
const DROP_BELOW = `${CLASS}-drop-below`;

let savedOrder = [];
let naturalOrder = [];
let editing = false;
const wiredLists = new WeakSet();

const menuItems = (list) =>
  [...list.children].filter((el) => el.tagName === "LI" && el.id.startsWith("menuTab_"));

const menuList = () => document.getElementById(MENU_LIST_ID);

// Home stays pinned first, so it is never draggable nor droppable-on-top-of.
const isHome = (item) => !!item && (item.getAttribute("data-url") || "").includes(HOME_URL_MARKER);

// saved order first, then anything the user has not touched in the order the page rendered it
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

function reorderDom(list, ids) {
  const byId = new Map(menuItems(list).map((item) => [item.id, item]));
  ids.forEach((id) => {
    if (byId.has(id)) list.appendChild(byId.get(id));
  });
}

function makeDraggable(list) {
  menuItems(list).forEach((item) => {
    const home = isHome(item);
    item.draggable = editing && !home;
    item.classList.toggle(HOME_LOCKED, editing && home);
    const link = item.querySelector("a");
    // otherwise the browser starts a native link drag instead of ours
    if (link) link.draggable = false;
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
    #${MENU_LIST_ID}.${EDITING} {
      outline: 2px dashed ${theme.colors.primary};
      outline-offset: -2px;
      border-radius: 8px;
    }
    #${MENU_LIST_ID}.${EDITING} > li[id^="menuTab_"] { cursor: grab; }
    #${MENU_LIST_ID} > li.${HOME_LOCKED} { cursor: not-allowed; opacity: 0.65; }
    #${MENU_LIST_ID} > li.${DRAGGING} { cursor: grabbing; opacity: 0.5; }
    #${MENU_LIST_ID} > li.${DROP_ABOVE} { box-shadow: inset 0 3px 0 0 ${theme.colors.secondary}; }
    #${MENU_LIST_ID} > li.${DROP_BELOW} { box-shadow: inset 0 -3px 0 0 ${theme.colors.secondary}; }
    #${BAR_ID} {
      position: fixed;
      left: 16px;
      bottom: 16px;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      gap: 12px;
      max-width: 520px;
      padding: 12px 14px;
      box-sizing: border-box;
      border-radius: 14px;
      background: #ffffff;
      box-shadow: 0 8px 28px rgba(0, 0, 0, 0.28);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    #${BAR_ID} .${CLASS}-text { display: flex; flex-direction: column; gap: 2px; }
    #${BAR_ID} .${CLASS}-title { font-size: 14px; font-weight: 700; color: ${theme.colors.secondary}; }
    #${BAR_ID} .${CLASS}-hint { font-size: 12px; color: #666666; }
    #${BAR_ID} button {
      flex: 0 0 auto;
      padding: 8px 14px;
      border-radius: 8px;
      border: 1.5px solid ${theme.colors.secondary};
      background: #ffffff;
      color: ${theme.colors.secondary};
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }
    #${BAR_ID} button.${CLASS}-lock {
      border-color: ${theme.colors.primary};
      background: ${theme.colors.primary};
      color: #ffffff;
    }
    #${BAR_ID} button.${CLASS}-lock:hover { background: ${theme.colors.primaryHover}; }
    #${BAR_ID} button.${CLASS}-reset:hover { background: ${theme.colors.secondaryLight}; }
  `;
  document.head.appendChild(style);
}

function buildEditBar() {
  if (document.getElementById(BAR_ID)) return;
  const bar = document.createElement("div");
  bar.id = BAR_ID;
  bar.innerHTML = `
    <span class="${CLASS}-text">
      <span class="${CLASS}-title">Re-order side menu</span>
      <span class="${CLASS}-hint">Drag a section into place, then lock the order in. Home stays first.</span>
    </span>
    <button type="button" class="${CLASS}-reset">Reset</button>
    <button type="button" class="${CLASS}-lock">&#10003;&nbsp; Lock order</button>
  `;
  bar.querySelector(`.${CLASS}-reset`).addEventListener("click", resetMenuOrder);
  bar.querySelector(`.${CLASS}-lock`).addEventListener("click", lockMenuOrder);
  document.body.appendChild(bar);
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
    if (!editing || !item || isHome(item)) return event.preventDefault();
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
    clearMarks();
  });

  list.addEventListener("dragend", () => {
    if (!dragged) return;
    dragged.classList.remove(DRAGGING);
    dragged = null;
    clearMarks();
  });
}

function sync() {
  const list = menuList();
  if (!list) return;

  if (!wiredLists.has(list)) {
    wiredLists.add(list);
    // the site renders the menu in its own order, capture it before touching anything
    naturalOrder = menuItems(list).map((item) => item.id);
    injectStyle();
    enableReordering(list);
  }

  if (editing) {
    list.classList.add(EDITING);
    buildEditBar();
  }

  makeDraggable(list);
  // while editing the screen is the source of truth; the saved order is only applied after locking
  if (!editing) applyOrder(list);
}

export function canEditMenu() {
  const list = menuList();
  return !!list && menuItems(list).length > 0;
}

export function isMenuEditActive() {
  return editing;
}

export function startMenuEdit() {
  const list = menuList();
  if (!list || !menuItems(list).length) return false;
  editing = true;
  list.classList.add(EDITING);
  buildEditBar();
  sync();
  console.log(`${LOG_PREFIX} menu edit mode started`);
  return true;
}

function exitMenuEdit() {
  editing = false;
  const bar = document.getElementById(BAR_ID);
  if (bar) bar.remove();
  const list = menuList();
  if (list) list.classList.remove(EDITING);
  sync();
}

export function resetMenuOrder() {
  const list = menuList();
  if (!list) return;
  reorderDom(list, naturalOrder);
}

export function lockMenuOrder() {
  const list = menuList();
  if (list) {
    rememberOrder(list);
    persist(savedOrder);
  }
  exitMenuEdit();
  console.log(`${LOG_PREFIX} menu order locked`);
}

export function initMenuReorder() {
  const list = menuList();
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

  // the picker goes up first: an extension reloaded while this page stayed open
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
