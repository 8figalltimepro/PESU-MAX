import {
  coursePageFromCache,
  fetchCoursePage,
  fetchUnitHtml,
  isSummarySessionError,
  unitHtmlFromCache
} from "./summaryApi.js";
import { showSummaryToast } from "./summaryToast.js";

const CONTENT_ID = "StudentProfilePESUContent";
const MENU_ID = "studentProfilePESUHomeMenu";
const COURSES_MENU_ID = "menuTab_653";
const UNITS_TAB_ID = "course_3";
const CONTENT_WAIT_MS = 8000;

let navigation = null;
let navigationId = 0;

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

function waitFor(factory, timeout = CONTENT_WAIT_MS) {
  const started = Date.now();
  return new Promise((resolve) => {
    const poll = () => {
      const value = factory();
      if (value) resolve(value);
      else if (Date.now() - started >= timeout) resolve(null);
      else window.setTimeout(poll, 80);
    };
    poll();
  });
}

function announce(text) {
  let region = document.getElementById("pesu-max-summary-announcer");
  if (!region) {
    region = el("div", "pesu-max-summary-sr");
    region.id = "pesu-max-summary-announcer";
    region.setAttribute("aria-live", "polite");
    region.setAttribute("aria-atomic", "true");
    document.body.appendChild(region);
  }
  region.textContent = "";
  window.setTimeout(() => {
    region.textContent = text;
  }, 40);
}

function activateCoursesMenu() {
  const list = document.getElementById(MENU_ID);
  if (list) {
    [...list.children].forEach((item) => {
      item.classList.toggle("active", item.id === COURSES_MENU_ID);
    });
  }
  document.title = "Profile | MyCourses";
}

async function ensureContent() {
  const existing = document.getElementById(CONTENT_ID);
  if (existing) return existing;

  const link = document.querySelector(`#${COURSES_MENU_ID} > a`);
  if (link) link.click();

  const content = await waitFor(() => document.getElementById(CONTENT_ID));
  if (!content) throw new Error("Course content area was not available.");
  return content;
}

function openMyCourses() {
  const link = document.querySelector(`#${COURSES_MENU_ID} > a`);
  if (link) {
    link.click();
    return true;
  }
  window.location.assign("/Academy/s/studentProfilePESU");
  return false;
}

function sanitize(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, noscript").forEach((node) => node.remove());
  return doc.body.innerHTML;
}

function buildLoading(container, course) {
  const wrap = el("div", "panel panel-default pesu-max-summary-host-loading");
  wrap.setAttribute("aria-busy", "true");

  const crumb = el("div", "pesu-max-summary-host-crumb");
  crumb.append(
    el("span", null, "My Courses"),
    el("span", "pesu-max-summary-host-arrow", "›"),
    el("strong", null, course.name)
  );

  const status = el("p", "pesu-max-summary-sr", `Opening ${course.name}…`);
  status.setAttribute("role", "status");

  wrap.append(crumb, el("div", "pesu-max-summary-host-sk is-title"));
  wrap.appendChild(el("div", "pesu-max-summary-host-sk is-tabs"));

  const panel = el("div", "pesu-max-summary-host-panel");
  for (let index = 0; index < 6; index += 1) {
    panel.appendChild(el("div", "pesu-max-summary-host-sk is-row"));
  }
  wrap.append(panel, status);
  container.replaceChildren(wrap);
}

function renderHostError(container, { title, message, session = false }) {
  const wrap = el("div", "panel panel-default pesu-max-summary-host-error");
  wrap.setAttribute("role", "alert");

  const heading = el("h4", null, title);
  const copy = el("p", null, message);
  const actions = el("div", "pesu-max-summary-host-error-actions");

  if (session) {
    const reload = el("button", "pesu-max-summary-host-primary", "Reload page");
    reload.type = "button";
    reload.addEventListener("click", () => window.location.reload());
    actions.appendChild(reload);
  } else {
    const courses = el("button", "pesu-max-summary-host-primary", "Open My Courses");
    courses.type = "button";
    courses.addEventListener("click", openMyCourses);
    actions.appendChild(courses);
  }

  wrap.append(heading, copy, actions);
  container.replaceChildren(wrap);
}

function activateUnitsTab(container) {
  const tabList = container.querySelector("#courseContentCategory");
  const unitsLink = tabList
    ? tabList.querySelector(`a[href="#${UNITS_TAB_ID}"]`)
    : null;

  if (tabList) {
    [...tabList.querySelectorAll("li")].forEach((item) => {
      const active = Boolean(unitsLink && item.contains(unitsLink));
      item.classList.toggle("active", active);
      const anchor = item.querySelector("a");
      if (anchor) anchor.setAttribute("aria-expanded", active ? "true" : "false");
    });
  }

  container.querySelectorAll(".tab-content > .tab-pane").forEach((pane) => {
    const active = pane.id === UNITS_TAB_ID;
    pane.classList.toggle("active", active);
    pane.classList.toggle("in", active);
  });
}

function activateUnit(container, index) {
  [...container.querySelectorAll("#courselistunit li")].forEach((item, itemIndex) => {
    const active = itemIndex === index;
    item.classList.toggle("active", active);
    const anchor = item.querySelector("a");
    if (anchor) anchor.setAttribute("aria-expanded", active ? "true" : "false");
  });
}

function focusCourse(container) {
  const target = container.querySelector(`#courseContentCategory a[href="#${UNITS_TAB_ID}"]`);
  if (target) {
    target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
  }
  window.scrollTo({ top: 0, behavior: "auto" });
}

function renderUnitLoading(target, index) {
  const wrap = el("div", "pesu-max-summary-unit-state");
  wrap.setAttribute("aria-busy", "true");
  wrap.appendChild(el("p", "pesu-max-summary-unit-state-title", `Loading Unit ${index + 1}…`));
  const rows = el("div", "pesu-max-summary-unit-state-rows");
  for (let row = 0; row < 5; row += 1) {
    rows.appendChild(el("div", "pesu-max-summary-host-sk is-row"));
  }
  wrap.appendChild(rows);
  target.replaceChildren(wrap);
}

function renderUnitEmpty(target) {
  const wrap = el("div", "pesu-max-summary-unit-state");
  wrap.appendChild(el("h4", null, "No material listed for this unit."));
  wrap.appendChild(
    el("p", null, "The unit exists, but PESU has not published any material for it.")
  );
  target.replaceChildren(wrap);
}

function renderUnitSessionError(target) {
  const wrap = el("div", "pesu-max-summary-unit-state is-error");
  wrap.setAttribute("role", "alert");
  wrap.appendChild(el("h4", null, "Your session expired"));
  wrap.appendChild(
    el("p", null, "Reload the page and sign in again to load this unit's materials.")
  );
  const reload = el("button", "pesu-max-summary-host-primary", "Reload page");
  reload.type = "button";
  reload.addEventListener("click", () => window.location.reload());
  wrap.appendChild(reload);
  target.replaceChildren(wrap);
}

function renderUnitError(target, unit, index, retry) {
  const wrap = el("div", "pesu-max-summary-unit-state is-error");
  wrap.setAttribute("role", "alert");
  wrap.appendChild(el("h4", null, `Couldn't load Unit ${index + 1} materials.`));
  wrap.appendChild(
    el("p", null, "The rest of the course is still available above. Try again or open another unit.")
  );
  const again = el("button", "pesu-max-summary-host-secondary", "Try again");
  again.type = "button";
  again.addEventListener("click", retry);
  wrap.appendChild(again);
  target.replaceChildren(wrap);
}

function injectUnitHtml(target, html) {
  if (!html || !html.trim()) {
    renderUnitEmpty(target);
    return;
  }
  target.innerHTML = sanitize(html);
}

async function loadUnit({
  container,
  course,
  page,
  unit,
  index,
  controller,
  isCurrent,
  fallbackNote = ""
}) {
  const target = container.querySelector("#CourseContentId");
  if (!target) return;

  const cached = unitHtmlFromCache(course.material.id, unit.id);
  if (cached != null) {
    injectUnitHtml(target, cached);
    if (fallbackNote) showSummaryToast(fallbackNote);
    focusCourse(container);
    announce(`Opened Unit ${index + 1} of ${course.name}.`);
    return;
  }

  renderUnitLoading(target, index);

  const retry = () =>
    void loadUnit({
      container,
      course,
      page,
      unit,
      index,
      controller,
      isCurrent,
      fallbackNote: ""
    });

  try {
    const html = await fetchUnitHtml(course.material.id, unit.id, page.subType);
    if (!isCurrent()) return;
    injectUnitHtml(target, html);
    if (fallbackNote) showSummaryToast(fallbackNote);
    focusCourse(container);
    announce(`Opened Unit ${index + 1} of ${course.name}.`);
  } catch (error) {
    if (controller.signal.aborted || !isCurrent()) return;

    if (isSummarySessionError(error)) {
      showSummaryToast("Your PESU session expired. Reload and sign in.", { tone: "danger" });
      renderUnitSessionError(target);
      return;
    }

    if (index > 0 && page.units[0]) {
      activateUnit(container, 0);
      showSummaryToast(`Couldn't load Unit ${index + 1}. Showing Unit 1 instead.`, {
        tone: "danger"
      });
      await loadUnit({
        container,
        course,
        page,
        unit: page.units[0],
        index: 0,
        controller,
        isCurrent
      });
      return;
    }

    showSummaryToast(`Couldn't load Unit ${index + 1} materials.`, { tone: "danger" });
    renderUnitError(target, unit, index, retry);
  }
}

function handleCourseFailure(container, course, error) {
  const session = isSummarySessionError(error);

  if (session) {
    showSummaryToast("Your PESU session expired. Reload and sign in.", { tone: "danger" });
    if (container && container.isConnected) {
      renderHostError(container, {
        title: "Your session expired",
        message: "Reload the page and sign in again to open course materials.",
        session: true
      });
    }
    return;
  }

  showSummaryToast(`Couldn't open ${course.name}. Showing My Courses.`, { tone: "danger" });
  if (!openMyCourses() && container && container.isConnected) {
    renderHostError(container, {
      title: "Couldn't open this course",
      message: "Open My Courses from the side menu, or reload the page and try again."
    });
  }
}

async function openCourse({ course, unitNumber = 0 }) {
  if (!course || !course.material) {
    showSummaryToast("Course materials aren't available for this course.", { tone: "danger" });
    return;
  }

  if (navigation) navigation.abort();
  const controller = new AbortController();
  navigation = controller;
  const id = (navigationId += 1);
  const isCurrent = () => navigationId === id && !controller.signal.aborted;
  let container = null;

  try {
    activateCoursesMenu();
    container = await ensureContent();
    if (!isCurrent()) return;

    if (!coursePageFromCache(course.material.id)) {
      buildLoading(container, course);
    }

    let page;
    try {
      page = await fetchCoursePage(course.material.id);
    } catch (error) {
      if (controller.signal.aborted || !isCurrent()) return;
      handleCourseFailure(container, course, error);
      return;
    }
    if (!isCurrent() || !container.isConnected) return;

    container.innerHTML = sanitize(page.html);
    activateUnitsTab(container);

    const units = page.units || [];
    const requested = Number(unitNumber) > 0 ? Number(unitNumber) : 0;
    if (requested === 0) {
      focusCourse(container);
      return;
    }

    let targetIndex = requested - 1;
    let target = units[targetIndex] || null;
    let fallbackNote = "";

    if (!target) {
      fallbackNote = `Unit ${requested} isn't published for ${course.name}.`;
      targetIndex = 0;
      target = units[0] || null;
    }

    if (!target) {
      showSummaryToast(fallbackNote || `Unit ${requested} isn't published for ${course.name}.`);
      focusCourse(container);
      return;
    }

    activateUnit(container, targetIndex);
    await loadUnit({
      container,
      course,
      page,
      unit: target,
      index: targetIndex,
      controller,
      isCurrent,
      fallbackNote
    });
  } catch (error) {
    if (controller.signal.aborted || !isCurrent()) return;
    if (container && container.isConnected) {
      handleCourseFailure(container, course, error);
    } else {
      showSummaryToast(`Couldn't open ${course.name}.`, { tone: "danger" });
    }
  } finally {
    if (navigation === controller) navigation = null;
  }
}

export function openCourseTarget(course, unitNumber) {
  return openCourse({ course, unitNumber });
}

export function prefetchCoursePage(course) {
  if (!course || !course.material) return Promise.resolve(null);
  return fetchCoursePage(course.material.id).catch(() => null);
}

export function prefetchUnitMaterials(course, unitNumber) {
  if (!course || !course.material || !Number.isInteger(unitNumber)) return Promise.resolve(null);

  return fetchCoursePage(course.material.id)
    .then((page) => {
      const unit = (page.units || [])[unitNumber - 1];
      if (!unit) return null;
      return fetchUnitHtml(course.material.id, unit.id, page.subType).catch(() => null);
    })
    .catch(() => null);
}

export function cancelCourseNavigation() {
  if (navigation) navigation.abort();
  navigation = null;
}
