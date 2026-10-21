import { load } from "../../utils/storage.js";
import { SIDE_MENU_DOCK_KEY, SIDE_MENU_DOCK_SECTIONS_KEY } from "../../utils/storageKeys.js";
import { SIDE_MENU_CONTENT_SELECTOR, SIDE_MENU_SELECTOR, menuItems } from "../academyPage.js";
import { MENU_ICON_BY_ID } from "../menuIcons/menuIconsApply.js";
import { clearSummaryHash, createSummary } from "../summary/summary.js";
import { PANEL_ID, buildAllSectionsPanel } from "./allSectionsPanel.js";
import { glyph } from "./dockIcon.js";
import { DOCK_ATTR, writeDockMirror } from "./dockState.js";
import {
  dockSections,
  menuSections,
  readMenuSections,
  sectionLabel,
  storeMenuSections
} from "./sideMenuSections.js";

export const DOCK_ID = "pesu-max-dock";
export const ALL_BUTTON_ID = "pesu-max-dock-all";
export const SUMMARY_BUTTON_ID = "pesu-max-dock-summary";
export const DOCK_ACTIVE_ATTR = "data-pesu-max-dock-active";
export const DOCK_ELSEWHERE_ATTR = "data-pesu-max-dock-elsewhere";

const LIST_SELECTOR = `${SIDE_MENU_SELECTOR} > ul`;
const ACTIVE_CLASS = "active";
const TOP_BAR_SELECTOR = "#pge_menu";
const TOP_BAR_HEIGHT_VAR = "--pesu-max-topbar-h";

let mounted = null;
let sectionsValue = null;
let building = false;
let scheduled = false;
let railObserver = null;
let savedWidths = null;
let topBarObserver = null;

const menuList = () => document.querySelector(LIST_SELECTOR);

export const isDockOn = () => document.documentElement.hasAttribute(DOCK_ATTR);

// Handle Topbar height
function syncTopBarHeight() {
  const topBar = document.querySelector(TOP_BAR_SELECTOR);
  const height = topBar ? Math.round(topBar.getBoundingClientRect().height) : 0;
  document.documentElement.style.setProperty(TOP_BAR_HEIGHT_VAR, `${height}px`);
}

function trackTopBarHeight() {
  syncTopBarHeight();
  const topBar = document.querySelector(TOP_BAR_SELECTOR);
  if (!topBar || topBarObserver) return;
  topBarObserver = new ResizeObserver(syncTopBarHeight);
  topBarObserver.observe(topBar);
}

function dockIconButton(iconName, label) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "pesu-max-dock-item";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.append(glyph(iconName));
  return button;
}

function dockButton(id, label) {
  const button = dockIconButton(MENU_ICON_BY_ID[id] || "Menu", label);
  button.dataset.pesuMaxDockSection = id;
  button.addEventListener("click", () => selectSection(id));
  return button;
}

function summaryButton() {
  const button = dockIconButton("DonutLarge", "Summary");
  button.id = SUMMARY_BUTTON_ID;
  button.setAttribute("aria-controls", "pesu-max-summary");
  button.setAttribute("aria-expanded", "false");

  const text = document.createElement("span");
  text.className = "pesu-max-dock-label";
  text.textContent = "Summary";
  button.appendChild(text);

  button.addEventListener("click", () => {
    if (mounted && mounted.summaryController) mounted.summaryController.toggle();
  });
  return button;
}

function allButton() {
  const button = dockIconButton("GridView", "All");
  button.id = ALL_BUTTON_ID;
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-controls", PANEL_ID);

  const text = document.createElement("span");
  text.className = "pesu-max-dock-label";
  text.textContent = "All";
  button.appendChild(text);
  return button;
}

function selectSection(id, { fromSummary = false } = {}) {
  if (!fromSummary && mounted && mounted.summaryController) {
    mounted.summaryController.closeForNavigation();
  }
  if (mounted) mounted.panel.close();
  const item = document.getElementById(id);
  const link = item && item.querySelector("a");
  if (link) link.click();
}

function syncActive() {
  const list = menuList();
  if (!list || !mounted) return;

  const summaryOpen = Boolean(mounted.summaryController && mounted.summaryController.isOpen());
  const active = menuItems(list).find((item) => item.classList.contains(ACTIVE_CLASS));
  const id = active ? active.id : "";

  mounted.summary.toggleAttribute(DOCK_ACTIVE_ATTR, summaryOpen);
  mounted.summary.setAttribute("aria-current", summaryOpen ? "page" : "false");
  mounted.summary.setAttribute("aria-expanded", summaryOpen ? "true" : "false");

  mounted.items.forEach((button, key) => {
    const isActive = !summaryOpen && key === id;
    button.toggleAttribute(DOCK_ACTIVE_ATTR, isActive);
    button.setAttribute("aria-current", isActive ? "page" : "false");
  });

  mounted.all.toggleAttribute(
    DOCK_ELSEWHERE_ATTR,
    !summaryOpen && Boolean(id) && !mounted.items.has(id)
  );
  mounted.panel.setActive(id);
}

function build(sections) {
  const list = menuList();
  const menu = document.querySelector(SIDE_MENU_SELECTOR);
  if (!list || !menu) return null;

  building = true;
  const available = new Map(menuItems(list).map((item) => [item.id, sectionLabel(item)]));

  const nav = document.createElement("nav");
  nav.id = DOCK_ID;
  nav.setAttribute("aria-label", "Sections");

  const summary = summaryButton();
  nav.appendChild(summary);

  const sectionWrap = document.createElement("div");
  sectionWrap.className = "pesu-max-dock-sections";
  const items = new Map();
  sections
    .filter((id) => available.has(id))
    .forEach((id) => {
      const button = dockButton(id, available.get(id));
      items.set(id, button);
      sectionWrap.appendChild(button);
    });
  nav.appendChild(sectionWrap);

  const all = allButton();
  nav.appendChild(all);

  const panel = buildAllSectionsPanel({ available, trigger: all, onSelect: selectSection });
  all.addEventListener("click", () => panel.toggle());

  menu.appendChild(nav);
  document.body.appendChild(panel.element);
  document.body.appendChild(panel.scrim);

  const listObserver = new MutationObserver(scheduleRefresh);
  listObserver.observe(menu, { childList: true, subtree: true });
  const classObserver = new MutationObserver(syncActive);
  classObserver.observe(list, { attributes: true, attributeFilter: ["class"], subtree: true });

  building = false;
  return { list, nav, items, summary, all, panel, observers: [listObserver, classObserver] };
}

function teardown() {
  releaseRailWidth();
  if (!mounted) return;
  mounted.observers.forEach((observer) => observer.disconnect());
  if (mounted.summaryController) mounted.summaryController.destroy();
  mounted.panel.destroy();
  mounted.nav.remove();
  mounted = null;
}

function mount(sections) {
  const next = build(sections);
  if (!next) return false;
  mounted = next;
  next.summaryController = createSummary({
    trigger: next.summary,
    onActiveChange: () => syncActive(),
    onBeforeOpen: () => next.panel.close(),
    onOpenSection: (id) => selectSection(id, { fromSummary: true })
  });
  return true;
}

function claimRailWidth() {
  const rail = document.querySelector(SIDE_MENU_SELECTOR);
  const content = document.querySelector(SIDE_MENU_CONTENT_SELECTOR);

  if (!savedWidths) {
    savedWidths = {
      rail: rail ? rail.style.width : "",
      content: content ? content.style.width : ""
    };
  }

  const clear = () => {
    if (rail) rail.style.removeProperty("width");
    if (content) content.style.removeProperty("width");
  };

  clear();
  if (!rail || railObserver) return;

  railObserver = new MutationObserver(clear);
  railObserver.observe(rail, { attributes: true, attributeFilter: ["style"] });
  if (content) railObserver.observe(content, { attributes: true, attributeFilter: ["style"] });
}

// Restore the side menu to its previous state. Including expanded or collapsed state.
function releaseRailWidth() {
  if (railObserver) {
    railObserver.disconnect();
    railObserver = null;
  }
  if (!savedWidths) return;

  const rail = document.querySelector(SIDE_MENU_SELECTOR);
  const content = document.querySelector(SIDE_MENU_CONTENT_SELECTOR);
  if (rail && savedWidths.rail) rail.style.width = savedWidths.rail;
  if (content && savedWidths.content) content.style.width = savedWidths.content;
  savedWidths = null;
}

function refresh() {
  if (!mounted) return;
  if (menuList() !== mounted.list) {
    teardown();
    if (mount(sectionsValue)) {
      syncActive();
      mounted.summaryController.openFromRoute();
    }
    return;
  }
  syncActive();
}

function scheduleRefresh() {
  if (building || scheduled || !mounted) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    refresh();
  });
}

function apply(enabled, value) {
  const root = document.documentElement;
  writeDockMirror(enabled);
  teardown();

  if (!enabled) {
    root.removeAttribute(DOCK_ATTR);
    clearSummaryHash();
    return;
  }

  sectionsValue = dockSections(value, menuSections(readMenuSections()));
  claimRailWidth();
  if (!mount(sectionsValue)) {
    root.removeAttribute(DOCK_ATTR);
    clearSummaryHash();
    return;
  }

  root.setAttribute(DOCK_ATTR, "");
  syncActive();
  mounted.summaryController.openFromRoute();
}

// Off by default.
export async function initSideMenuDock() {
  storeMenuSections(readMenuSections()).catch(() => { });
  trackTopBarHeight();
  const [enabled, value] = await Promise.all([
    load(SIDE_MENU_DOCK_KEY),
    load(SIDE_MENU_DOCK_SECTIONS_KEY)
  ]);
  apply(enabled === true, value);

  const clearDisabledRoute = () => {
    if (!isDockOn()) clearSummaryHash();
  };
  window.addEventListener("hashchange", clearDisabledRoute);
  window.addEventListener("load", clearDisabledRoute, { once: true });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (!changes[SIDE_MENU_DOCK_KEY] && !changes[SIDE_MENU_DOCK_SECTIONS_KEY]) return;
    Promise.all([load(SIDE_MENU_DOCK_KEY), load(SIDE_MENU_DOCK_SECTIONS_KEY)])
      .then(([next, sections]) => apply(next === true, sections))
      .catch(() => { });
  });
}
