import {
  ATTENDANCE_THRESHOLD,
  formatPercent,
  marginCopy,
  statusLabel
} from "./summaryData.js";
import { summaryIcon } from "./summaryIcons.js";
import {
  CALENDAR,
  CALENDAR_VISIBLE_COUNT,
  calendarDateParts,
  calendarEventDate,
  calendarEventWeekday,
  calendarRelativeLabel,
  calendarTypeLabel,
  upcomingCalendarEvents
} from "./summaryCalendar.js";
import { createSummaryFit } from "./summaryFit.js";

const SUMMARY_ID = "pesu-max-summary";
const SUMMARY_TITLE_ID = "pesu-max-summary-title";
const COURSE_LIST_ID = "pesu-max-summary-courses";
const CALENDAR_ID = "pesu-max-summary-calendar";
const SKIP_LINK_ID = "pesu-max-summary-skip";

const LEVEL_META = {
  below: { label: `Below ${ATTENDANCE_THRESHOLD}%`, icon: "alert" },
  edge: { label: "No margin", icon: "alertCircle" },
  thin: { label: "Thin margin", icon: "clock" },
  safe: { label: "On track", icon: "check" },
  na: { label: "No data", icon: "minus" }
};

const statusFor = (level) => LEVEL_META[level] || LEVEL_META.na;

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

const addIcon = (node, name) => {
  const icon = summaryIcon(name);
  if (icon) node.appendChild(icon);
  return node;
};

const clear = (node) => node.replaceChildren();

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

function unitName(unit, index) {
  const raw = (unit && unit.name ? unit.name : "").replace(/\s+/g, " ").trim();
  const stripped = raw.replace(/^unit\s*\d+\s*[:.\-–]?\s*/i, "").trim();
  return stripped || raw || `Unit ${index + 1}`;
}

export function createSummaryView(handlers = {}) {
  const root = el("div", "pesu-max-summary");
  root.id = SUMMARY_ID;
  root.hidden = true;
  root.tabIndex = -1;
  root.setAttribute("role", "region");
  root.setAttribute("aria-labelledby", SUMMARY_TITLE_ID);
  root.setAttribute("data-phase", "idle");

  const inner = el("div", "pesu-max-summary-inner");
  const sheet = el("div", "pesu-max-summary-sheet");
  inner.appendChild(sheet);
  root.appendChild(inner);
  document.body.appendChild(root);

  const fit = createSummaryFit({ root, inner, sheet });

  const rows = new Map();
  const unitStates = new Map();
  let courses = new Map();
  let notice = null;
  let refreshing = false;
  let refreshButton = null;
  let noticeSlot = null;
  let calendarExpanded = false;
  let calendarList = null;
  let calendarToggle = null;
  let calendarTotal = 0;

  const skipLink = () => {
    const link = el("a", "pesu-max-summary-skip", "Skip to courses");
    link.id = SKIP_LINK_ID;
    link.href = `#${COURSE_LIST_ID}`;
    link.dataset.action = "skip-courses";
    return link;
  };

  const buildEyebrow = (semesterLabel, count) => {
    const eyebrow = el("div", "pesu-max-summary-eyebrow");
    const mark = el("span", "pesu-max-summary-mark");
    addIcon(mark, "summary");
    eyebrow.appendChild(mark);
    eyebrow.appendChild(el("span", "pesu-max-summary-eyebrow-word", "Summary"));

    const meta = el("span", "pesu-max-summary-eyebrow-meta");
    if (semesterLabel) {
      meta.appendChild(el("span", "pesu-max-summary-dot", "·"));
      meta.appendChild(el("span", null, semesterLabel));
    }
    if (Number.isInteger(count)) {
      meta.appendChild(el("span", "pesu-max-summary-dot", "·"));
      meta.appendChild(el("span", null, plural(count, "course", "courses")));
    }
    if (meta.childNodes.length > 0) eyebrow.appendChild(meta);
    return eyebrow;
  };

  const updateUnits = (course, state) => {
    const row = rows.get(course.key);
    if (!row) return;

    const status = state ? state.status : course.material ? "checking" : "unavailable";
    const units = state && status === "ready" ? state.units || [] : [];
    const unavailable = status === "unavailable";
    const checking = status === "checking";
    const failed = status === "error";

    row.unitLabel.hidden = failed;
    row.unitRetry.hidden = !failed;
    if (failed) {
      row.unitRetry.setAttribute(
        "aria-label",
        `Retry checking unit availability for ${course.name}`
      );
      row.unitRetry.title = "Retry checking unit availability";
    }

    row.unitButtons.forEach((button, index) => {
      const unit = units[index];
      const missing = status === "ready" && !unit;
      const blocked = missing || unavailable;
      const name = unit ? unitName(unit, index) : `Unit ${index + 1}`;
      const label =
        unit && name && !/^unit\s*\d+$/i.test(name)
          ? `Unit ${index + 1}: ${name}`
          : `Unit ${index + 1}`;

      button.textContent = String(index + 1);
      button.classList.toggle("is-missing", missing);
      button.classList.toggle("is-unavailable", unavailable);
      button.classList.toggle("is-checking", checking);
      button.classList.toggle("is-failed", failed);
      button.disabled = blocked;
      button.setAttribute("aria-disabled", blocked ? "true" : "false");

      if (missing) {
        button.title = "Not published for this course.";
        button.setAttribute("aria-label", `Unit ${index + 1} is not published for ${course.name}.`);
      } else if (unavailable) {
        button.title = "Course page not found.";
        button.setAttribute(
          "aria-label",
          `Unit ${index + 1} is unavailable because the course page wasn't found.`
        );
      } else if (checking) {
        button.title = "Availability is still loading.";
        button.setAttribute(
          "aria-label",
          `Open ${label}, ${course.name}. Availability is still loading.`
        );
      } else if (failed) {
        button.title = "Availability couldn't be checked.";
        button.setAttribute(
          "aria-label",
          `Open ${label}, ${course.name}. Availability couldn't be checked.`
        );
      } else {
        button.title = `Open ${label}`;
        button.setAttribute("aria-label", `Open ${label}, ${course.name}.`);
      }
    });

    if (unavailable) {
      row.unitLabel.textContent = "No page";
      row.unitLabel.title = "Course page not found.";
      row.unitLabel.dataset.full = "false";
    } else if (checking) {
      row.unitLabel.textContent = "Loading";
      row.unitLabel.title = "Checking unit availability…";
      row.unitLabel.dataset.full = "false";
    } else if (failed) {
      row.unitLabel.textContent = "Units";
      row.unitLabel.title = "";
      row.unitLabel.dataset.full = "false";
    } else {
      const count = units.length;
      row.unitLabel.textContent =
        count === 0 ? "No units" : count < 4 ? `${count} units` : "Units";
      row.unitLabel.title =
        count === 0
          ? "No units are published for this course."
          : count < 4
            ? `${count} of 4 units are published.`
            : "";
      row.unitLabel.dataset.full = count >= 4 ? "true" : "false";
    }
  };

  const buildUnits = (course) => {
    const wrap = el("div", "pesu-max-summary-units");
    const slot = el("span", "pesu-max-summary-units-slot");
    const label = el("span", "pesu-max-summary-units-label", "Units");
    const retry = el("button", "pesu-max-summary-units-retry", "Retry");
    retry.type = "button";
    retry.hidden = true;
    retry.dataset.action = "retry-units";
    retry.dataset.key = course.key;
    slot.append(label, retry);

    const buttons = [];
    const buttonWrap = el("div", "pesu-max-summary-unit-buttons");

    for (let index = 0; index < 4; index += 1) {
      const button = el("button", "pesu-max-summary-unit", String(index + 1));
      button.type = "button";
      button.dataset.action = "open-unit";
      button.dataset.key = course.key;
      button.dataset.unit = String(index + 1);
      buttons.push(button);
      buttonWrap.appendChild(button);
    }

    wrap.append(slot, buttonWrap);
    return { wrap, buttons, label, retry };
  };

  const buildCalendarEvent = (event, index, now) => {
    const item = el("li", "pesu-max-summary-calendar-event");
    item.dataset.type = event.type;
    if (index >= CALENDAR_VISIBLE_COUNT) item.hidden = true;

    const parts = calendarDateParts(event, now);
    const date = el("div", "pesu-max-summary-calendar-date");
    date.setAttribute("aria-hidden", "true");
    date.append(
      el("span", "pesu-max-summary-calendar-month", parts.month),
      el(
        "span",
        `pesu-max-summary-calendar-day${parts.range ? " is-range" : ""}`,
        parts.day
      )
    );
    if (parts.year) {
      date.appendChild(el("span", "pesu-max-summary-calendar-year", parts.year));
    }

    const body = el("div", "pesu-max-summary-calendar-body");
    body.appendChild(el("h3", "pesu-max-summary-calendar-event-title", event.title));

    const meta = el("div", "pesu-max-summary-calendar-meta");
    const type = el("span", "pesu-max-summary-calendar-type", calendarTypeLabel(event.type));
    type.dataset.type = event.type;
    const weekday = calendarEventWeekday(event);
    const when = el("time", "pesu-max-summary-calendar-when", weekday);
    when.dateTime = event.start;
    when.setAttribute("aria-label", calendarEventDate(event, now));
    if (!weekday) when.classList.add("pesu-max-summary-sr");
    meta.append(type, when);
    const relative = calendarRelativeLabel(event, now);
    if (relative) meta.appendChild(el("span", "pesu-max-summary-calendar-relative", relative));
    body.appendChild(meta);
    item.append(date, body);
    return item;
  };

  const buildCalendarSection = () => {
    const now = new Date();
    const upcoming = upcomingCalendarEvents(now);
    const section = el("section", "pesu-max-summary-calendar");
    section.id = CALENDAR_ID;
    section.setAttribute("aria-labelledby", `${CALENDAR_ID}-title`);

    const head = el("div", "pesu-max-summary-calendar-head");
    const heading = el("div", "pesu-max-summary-calendar-heading");
    const title = el("h2", "pesu-max-summary-calendar-title", "Upcoming");
    title.id = `${CALENDAR_ID}-title`;
    heading.append(
      title,
      el("p", "pesu-max-summary-calendar-meta", `Academic calendar · ${CALENDAR.session.label}`)
    );
    head.appendChild(heading);

    calendarExpanded = false;
    calendarList = null;
    calendarToggle = null;
    calendarTotal = upcoming.length;

    if (upcoming.length > CALENDAR_VISIBLE_COUNT) {
      calendarToggle = el(
        "button",
        "pesu-max-summary-calendar-toggle",
        `Show all ${upcoming.length}`
      );
      calendarToggle.type = "button";
      calendarToggle.dataset.action = "toggle-calendar";
      calendarToggle.setAttribute("aria-expanded", "false");
      calendarToggle.setAttribute("aria-controls", `${CALENDAR_ID}-list`);
      head.appendChild(calendarToggle);
    }
    section.appendChild(head);

    if (!upcoming.length) {
      section.appendChild(
        el("p", "pesu-max-summary-calendar-empty", "No upcoming events in this calendar.")
      );
      return section;
    }

    calendarList = el("ul", "pesu-max-summary-calendar-list");
    calendarList.id = `${CALENDAR_ID}-list`;
    upcoming.forEach((event, index) => {
      calendarList.appendChild(buildCalendarEvent(event, index, now));
    });
    section.appendChild(calendarList);
    return section;
  };

  const buildCourse = (course) => {
    const item = el("li", "pesu-max-summary-course");
    item.dataset.level = course.level;
    item.dataset.key = course.key;
    item.setAttribute("aria-labelledby", `${SUMMARY_ID}-${course.key}-name`);

    const main = el("div", "pesu-max-summary-course-main");
    const heading = el("div", "pesu-max-summary-course-heading");
    const name = el("h3", "pesu-max-summary-course-name");
    name.id = `${SUMMARY_ID}-${course.key}-name`;
    if (course.material) {
      const nameButton = el("button", "pesu-max-summary-course-name-button", course.name);
      nameButton.type = "button";
      nameButton.dataset.action = "open-course";
      nameButton.dataset.key = course.key;
      nameButton.title = `Open ${course.name}'s course page`;
      addIcon(nameButton, "arrow");
      name.appendChild(nameButton);
    } else {
      name.textContent = course.name;
    }
    heading.appendChild(name);

    const status = el("div", "pesu-max-summary-course-status");
    const chip = el("span", "pesu-max-summary-chip");
    chip.dataset.level = course.level;
    addIcon(chip, statusFor(course.level).icon);
    chip.appendChild(el("span", null, statusLabel(course.level)));
    const margin = el("span", "pesu-max-summary-margin", marginCopy(course));
    status.append(chip, margin);
    main.append(heading, status);

    const numbers = el("div", "pesu-max-summary-numbers");
    if (course.level === "na") {
      numbers.appendChild(el("span", "pesu-max-summary-number", "NA"));
    } else {
      numbers.appendChild(
        el("span", "pesu-max-summary-number", `${formatPercent(course.displayPercent)}%`)
      );
      const count = el("span", "pesu-max-summary-count", `${course.attended} / ${course.total}`);
      count.title = `${course.attended} attended of ${course.total} classes`;
      numbers.appendChild(count);
    }

    const actions = el("div", "pesu-max-summary-actions");
    const units = buildUnits(course);
    actions.appendChild(units.wrap);

    item.append(main, numbers, actions);
    rows.set(course.key, {
      element: item,
      unitButtons: units.buttons,
      unitLabel: units.label,
      unitRetry: units.retry
    });
    updateUnits(course, unitStates.get(course.key));
    return item;
  };

  const buildNotice = () => {
    if (!notice) return null;
    const box = el("div", "pesu-max-summary-notice");
    box.dataset.tone = notice.tone || "info";
    addIcon(box, notice.tone === "error" ? "alert" : "info");
    box.appendChild(el("span", "pesu-max-summary-notice-text", notice.text));
    if (notice.reload) {
      const reload = el("button", "pesu-max-summary-link", "Reload");
      reload.type = "button";
      reload.dataset.action = "reload";
      box.appendChild(reload);
    } else if (notice.retry) {
      const retry = el("button", "pesu-max-summary-link", "Retry");
      retry.type = "button";
      retry.dataset.action = "retry";
      box.appendChild(retry);
    }
    return box;
  };

  const buildTopline = (state) => {
    const head = el("header", "pesu-max-summary-head");
    const title = el("h1", "pesu-max-summary-sr", "Summary");
    title.id = SUMMARY_TITLE_ID;
    head.appendChild(title);

    const line = el("div", "pesu-max-summary-topline");
    line.appendChild(buildEyebrow(state.semesterLabel, state.courseCount));

    refreshButton = el("button", "pesu-max-summary-refresh");
    refreshButton.type = "button";
    refreshButton.dataset.action = "refresh";
    refreshButton.setAttribute("aria-label", "Refresh attendance");
    addIcon(refreshButton, "refresh");
    refreshButton.appendChild(el("span", null, "Refresh"));
    refreshButton.title = "Refresh attendance";
    line.appendChild(refreshButton);

    head.appendChild(line);
    return head;
  };

  const renderData = (state) => {
    courses = new Map(state.courses.map((course) => [course.key, course]));
    rows.clear();

    const fragment = document.createDocumentFragment();
    if (state.courses.length > 0) fragment.appendChild(skipLink());
    fragment.appendChild(buildTopline(state));

    noticeSlot = el("div", "pesu-max-summary-notice-slot");
    noticeSlot.setAttribute("role", "status");
    noticeSlot.setAttribute("aria-live", "polite");
    noticeSlot.setAttribute("aria-atomic", "true");
    const noticeBox = buildNotice();
    if (noticeBox) noticeSlot.appendChild(noticeBox);
    fragment.appendChild(noticeSlot);

    if (!state.courses.length) {
      const empty = el("section", "pesu-max-summary-empty");
      const mark = el("span", "pesu-max-summary-empty-mark");
      addIcon(mark, "summary");
      empty.append(mark, el("h2", null, "No courses this semester."));
      empty.appendChild(
        el("p", null, "Once you're enrolled in a semester, your attendance will appear here.")
      );
      const actions = el("div", "pesu-max-summary-empty-actions");
      const coursesButton = el("button", "pesu-max-summary-primary", "Open My Courses");
      coursesButton.type = "button";
      coursesButton.dataset.action = "courses";
      const attendanceButton = el("button", "pesu-max-summary-secondary", "My Attendance");
      attendanceButton.type = "button";
      attendanceButton.dataset.action = "source";
      actions.append(coursesButton, attendanceButton);
      empty.appendChild(actions);
      fragment.appendChild(empty);
    } else {
      const section = el("section", "pesu-max-summary-courses");
      section.id = COURSE_LIST_ID;
      section.tabIndex = -1;
      section.setAttribute("aria-labelledby", `${COURSE_LIST_ID}-title`);

      const heading = el("h2", "pesu-max-summary-sr", "Courses");
      heading.id = `${COURSE_LIST_ID}-title`;
      section.appendChild(heading);

      const columns = el("div", "pesu-max-summary-columns");
      columns.setAttribute("aria-hidden", "true");
      [
        "Course",
        `Attendance · ${ATTENDANCE_THRESHOLD}% min`,
        "Units"
      ].forEach((label) => {
        columns.appendChild(el("span", null, label));
      });
      section.appendChild(columns);

      const list = el("ol", "pesu-max-summary-list");
      state.courses.forEach((course) => {
        list.appendChild(buildCourse(course));
      });
      section.appendChild(list);
      fragment.appendChild(section);
      fragment.appendChild(buildCalendarSection());
    }

    const loaded = el("p", "pesu-max-summary-sr", "Attendance loaded.");
    loaded.setAttribute("role", "status");
    fragment.appendChild(loaded);
    clear(sheet);
    sheet.appendChild(fragment);
    root.dataset.phase = "ready";
    root.setAttribute("aria-busy", "false");
    setRefreshing(refreshing);
    fit.setExpanded(false);
    fit.refresh();
  };

  const renderLoading = () => {
    const fragment = document.createDocumentFragment();
    const hiddenTitle = el("h1", "pesu-max-summary-sr", "Summary");
    hiddenTitle.id = SUMMARY_TITLE_ID;
    fragment.appendChild(hiddenTitle);
    const head = el("header", "pesu-max-summary-head");
    const line = el("div", "pesu-max-summary-topline");
    const eyebrow = el("div", "pesu-max-summary-eyebrow");
    eyebrow.appendChild(el("span", "pesu-max-summary-sk is-short"));
    line.appendChild(eyebrow);
    line.appendChild(el("div", "pesu-max-summary-sk is-refresh"));
    head.appendChild(line);
    fragment.appendChild(head);

    const body = el("div", "pesu-max-summary-skeleton");
    const skeletonHead = el("div", "pesu-max-summary-sk-head");
    skeletonHead.appendChild(el("div", "pesu-max-summary-sk is-columns"));
    body.appendChild(skeletonHead);

    for (let index = 0; index < 6; index += 1) {
      const row = el("div", "pesu-max-summary-sk-row");
      row.appendChild(el("div", "pesu-max-summary-sk is-name"));
      row.appendChild(el("div", "pesu-max-summary-sk is-number"));
      const actions = el("div", "pesu-max-summary-sk-actions");
      actions.appendChild(el("div", "pesu-max-summary-sk is-units"));
      row.appendChild(actions);
      body.appendChild(row);
    }
    fragment.appendChild(body);
    const status = el("p", "pesu-max-summary-sr", "Loading attendance…");
    status.setAttribute("role", "status");
    fragment.appendChild(status);

    clear(sheet);
    sheet.appendChild(fragment);
    root.dataset.phase = "loading";
    root.setAttribute("aria-busy", "true");
    refreshButton = null;
    calendarExpanded = false;
    fit.setExpanded(false);
    fit.refresh();
  };

  const renderError = (state) => {
    const fragment = document.createDocumentFragment();
    const hiddenTitle = el("h1", "pesu-max-summary-sr", "Summary");
    hiddenTitle.id = SUMMARY_TITLE_ID;
    fragment.appendChild(hiddenTitle);
    const head = el("header", "pesu-max-summary-head");
    head.appendChild(buildEyebrow(state.semesterLabel, undefined));
    fragment.appendChild(head);

    const box = el("div", "pesu-max-summary-error");
    box.setAttribute("role", "alert");
    const mark = el("span", "pesu-max-summary-error-mark");
    addIcon(mark, "alert");
    box.appendChild(mark);
    box.appendChild(el("h2", null, state.title || "Couldn't load attendance."));
    box.appendChild(el("p", null, state.message || "Check your connection and try again."));
    const actions = el("div", "pesu-max-summary-error-actions");

    if (state.sessionExpired) {
      const reload = el("button", "pesu-max-summary-primary", "Reload page");
      reload.type = "button";
      reload.dataset.action = "reload";
      actions.appendChild(reload);
    } else {
      const retry = el("button", "pesu-max-summary-primary", "Try again");
      retry.type = "button";
      retry.dataset.action = "retry";
      actions.appendChild(retry);
    }

    const attendance = el("button", "pesu-max-summary-secondary", "My Attendance");
    attendance.type = "button";
    attendance.dataset.action = "source";
    actions.appendChild(attendance);
    box.appendChild(actions);
    fragment.appendChild(box);

    clear(sheet);
    sheet.appendChild(fragment);
    root.dataset.phase = "error";
    root.setAttribute("aria-busy", "false");
    refreshButton = null;
    calendarExpanded = false;
    fit.setExpanded(false);
    fit.refresh();
  };

  root.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action]");
    if (!target || target.getAttribute("aria-disabled") === "true") return;
    const action = target.dataset.action;

    if (action === "skip-courses") {
      event.preventDefault();
      const section = document.getElementById(COURSE_LIST_ID);
      if (section) {
        section.focus({ preventScroll: true });
        section.scrollIntoView({ block: "start" });
      }
      return;
    }
    if (action === "refresh") {
      if (handlers.onRefresh) handlers.onRefresh();
      return;
    }
    if (action === "toggle-calendar") {
      calendarExpanded = !calendarExpanded;
      if (calendarList) {
        [...calendarList.children].forEach((item, index) => {
          item.hidden = !calendarExpanded && index >= CALENDAR_VISIBLE_COUNT;
        });
      }
      if (calendarToggle) {
        calendarToggle.setAttribute("aria-expanded", calendarExpanded ? "true" : "false");
        calendarToggle.textContent = calendarExpanded
          ? "Show less"
          : `Show all ${calendarTotal}`;
      }
      fit.setExpanded(calendarExpanded);
      return;
    }
    if (action === "retry") {
      if (handlers.onRetry) handlers.onRetry();
      return;
    }
    if (action === "reload") {
      window.location.reload();
      return;
    }
    if (action === "source") {
      if (handlers.onOpenAttendance) handlers.onOpenAttendance();
      return;
    }
    if (action === "courses") {
      if (handlers.onOpenCourses) handlers.onOpenCourses();
      return;
    }

    const course = courses.get(target.dataset.key);
    if (!course) return;

    if (action === "open-course") {
      if (handlers.onOpenCourse) handlers.onOpenCourse(course);
      return;
    }
    if (action === "open-unit") {
      if (handlers.onOpenUnit) handlers.onOpenUnit(course, Number(target.dataset.unit));
      return;
    }
    if (action === "retry-units") {
      if (handlers.onRetryUnits) handlers.onRetryUnits(course);
    }
  });

  root.addEventListener("pointerover", (event) => {
    const target = event.target.closest("[data-action='open-course'], [data-action='open-unit']");
    if (!target || !handlers.onIntent) return;
    const course = courses.get(target.dataset.key);
    if (!course) return;
    handlers.onIntent(course, target.dataset.unit ? Number(target.dataset.unit) : null);
  });

  root.addEventListener("focusin", (event) => {
    const target = event.target.closest("[data-action='open-course'], [data-action='open-unit']");
    if (!target || !handlers.onIntent) return;
    const course = courses.get(target.dataset.key);
    if (!course) return;
    handlers.onIntent(course, target.dataset.unit ? Number(target.dataset.unit) : null);
  });

  const setRefreshing = (value) => {
    refreshing = Boolean(value);
    if (!refreshButton) return;
    refreshButton.dataset.busy = refreshing ? "true" : "false";
    refreshButton.setAttribute("aria-disabled", refreshing ? "true" : "false");
    refreshButton.title = refreshing ? "Refreshing attendance…" : "Refresh attendance";
  };

  return {
    element: root,
    show() {
      root.hidden = false;
      root.dataset.open = "true";
      fit.refresh();
    },
    hide() {
      root.hidden = true;
      root.removeAttribute("data-open");
    },
    focus() {
      root.focus({ preventScroll: true });
    },
    scrollToTop() {
      root.scrollTop = 0;
    },
    renderLoading,
    renderData,
    renderError,
    setUnits(key, state) {
      unitStates.set(key, state);
      const course = courses.get(key);
      if (course) updateUnits(course, state);
    },
    setRefreshing,
    setNotice(next) {
      notice = next;
      if (!noticeSlot) return;
      const existing = noticeSlot.querySelector(".pesu-max-summary-notice");
      if (existing) existing.remove();
      const box = buildNotice();
      if (box) noticeSlot.appendChild(box);
      fit.refresh();
    },
    setCourseUnits(states) {
      unitStates.clear();
      states.forEach((state, key) => unitStates.set(key, state));
    },
    destroy() {
      fit.destroy();
      root.remove();
    }
  };
}
