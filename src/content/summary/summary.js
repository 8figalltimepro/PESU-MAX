import {
  coursePageFromCache,
  fetchCoursePage,
  isSummarySessionError,
  loadSummary
} from "./summaryApi.js";
import { buildCourses, formatSemesterLabel } from "./summaryData.js";
import { createSummaryView } from "./summaryView.js";
import {
  openCourseTarget,
  prefetchUnitMaterials
} from "./summaryNavigation.js";
import { showSummaryToast } from "./summaryToast.js";
import { SIDE_MENU_CONTENT_SELECTOR } from "../academyPage.js";

export const SUMMARY_HASH = "#summary";
const SUMMARY_STATE_KEY = "pesuMaxSummaryView";
const STALE_AFTER_MS = 2 * 60 * 1000;
const PREFETCH_DELAY_MS = 120;
const INTENT_DELAY_MS = 120;

const baseUrl = (hash) => {
  const url = `${location.pathname}${location.search}`;
  return `${url}${hash && hash !== SUMMARY_HASH ? hash : ""}`;
};

export function clearSummaryHash() {
  if (location.hash !== SUMMARY_HASH) return false;
  const state = history.state && history.state[SUMMARY_STATE_KEY] ? null : history.state;
  history.replaceState(state, "", baseUrl(""));
  return true;
}

export function createSummary({ trigger, onActiveChange, onBeforeOpen, onOpenSection } = {}) {
  let open = false;
  let destroyed = false;
  let pushed = false;
  let saved = { state: null, hash: "", title: "" };
  let cache = null;
  let units = new Map();
  let fetchController = null;
  let dataId = 0;
  let prefetchController = null;
  let contentState = null;
  const intentTimers = new Map();

  const view = createSummaryView({
    onRefresh: () => void loadData({ refresh: true }),
    onRetry: () => void loadData({ refresh: true }),
    onOpenCourse: (course) => openMaterial(course, 0),
    onOpenUnit: (course, unitNumber) => openMaterial(course, unitNumber),
    onOpenAttendance: () => openSection("menuTab_660"),
    onOpenCourses: () => openSection("menuTab_653"),
    onRetryUnits: (course) => void retryUnits(course),
    onIntent: (course, unitNumber) => queueIntent(course, unitNumber)
  });

  const setActive = (value) => {
    if (typeof onActiveChange === "function") onActiveChange(value);
  };

  const setHostHidden = (hidden) => {
    const content = document.querySelector(SIDE_MENU_CONTENT_SELECTOR);
    if (!content) return;

    if (hidden) {
      contentState = {
        element: content,
        ariaHidden: content.getAttribute("aria-hidden"),
        inert: content.hasAttribute("inert"),
        hiddenClass: content.classList.contains("pesu-max-summary-host-hidden")
      };
      content.setAttribute("aria-hidden", "true");
      content.setAttribute("inert", "");
      content.classList.add("pesu-max-summary-host-hidden");
    } else if (contentState) {
      const element = contentState.element;
      if (contentState.ariaHidden == null) element.removeAttribute("aria-hidden");
      else element.setAttribute("aria-hidden", contentState.ariaHidden);
      if (!contentState.inert) element.removeAttribute("inert");
      if (!contentState.hiddenClass) element.classList.remove("pesu-max-summary-host-hidden");
      contentState = null;
    }
  };

  const setTitle = (next) => {
    document.title = next;
  };

  const restoreTitle = () => {
    if (document.title === "Summary | PESU Academy" && saved.title) {
      document.title = saved.title;
    }
  };

  const readRoute = () => {
    const marker = history.state && history.state[SUMMARY_STATE_KEY];
    if (marker && typeof marker === "object") {
      saved = {
        state: marker.state || null,
        hash: typeof marker.hash === "string" ? marker.hash : "",
        title: document.title
      };
      pushed = true;
      return true;
    }

    saved = {
      state: history.state,
      hash: "",
      title: document.title
    };
    pushed = false;
    return false;
  };

  const focusAfterRender = (descriptor) => {
    if (!descriptor) return;

    if (descriptor.action === "refresh") {
      const button = view.element.querySelector('[data-action="refresh"]');
      if (button) button.focus({ preventScroll: true });
      return;
    }

    const target = [...view.element.querySelectorAll("[data-action][data-key]")].find(
      (node) =>
        node.dataset.action === descriptor.action &&
        node.dataset.key === descriptor.key &&
        node.dataset.unit === descriptor.unit
    );
    if (target) target.focus({ preventScroll: true });
  };

  const focusDescriptor = () => {
    const active = document.activeElement;
    if (!active || !view.element.contains(active)) return null;
    if (!active.dataset || !active.dataset.action) return null;
    return {
      action: active.dataset.action,
      key: active.dataset.key || "",
      unit: active.dataset.unit || ""
    };
  };

  const renderCache = () => {
    if (!cache) return;
    const descriptor = focusDescriptor();
    view.setCourseUnits(units);
    view.renderData({
      semesterLabel: cache.semesterLabel,
      courseCount: cache.courses.length,
      courses: cache.courses
    });
    view.setNotice(
      cache.warning
        ? { tone: "warning", text: cache.warning, retry: true }
        : null
    );
    view.setRefreshing(false);
    focusAfterRender(descriptor);
  };

  const setUnitsState = (key, state) => {
    units.set(key, state);
    view.setUnits(key, state);
  };

  const retryUnits = async (course) => {
    if (destroyed || !course || !course.material) return;
    setUnitsState(course.key, { status: "checking" });
    try {
      const page = await fetchCoursePage(course.material.id, { force: true });
      if (destroyed) return;
      setUnitsState(course.key, {
        status: "ready",
        units: page.units || [],
        subType: page.subType
      });
    } catch (error) {
      if (destroyed) return;
      setUnitsState(course.key, { status: "error" });
      if (isSummarySessionError(error)) {
        view.setNotice({
          tone: "warning",
          text: "Your PESU session expired. Reload to check units.",
          reload: true
        });
        showSummaryToast("Your PESU session expired. Reload and sign in.", { tone: "danger" });
      } else {
        showSummaryToast(`Couldn't check units for ${course.name}.`, { tone: "danger" });
      }
    }
  };

  const prefetchUnits = async () => {
    if (prefetchController) prefetchController.abort();
    const controller = new AbortController();
    prefetchController = controller;
    const runId = dataId;

    const queue = (cache ? cache.courses : []).filter((course) => {
      const state = units.get(course.key);
      return course.material && (!state || state.status === "checking");
    });
    if (!queue.length) return;

    await new Promise((resolve) => window.setTimeout(resolve, PREFETCH_DELAY_MS));
    if (controller.signal.aborted || runId !== dataId) return;

    let cursor = 0;
    const worker = async () => {
      while (cursor < queue.length && !controller.signal.aborted && runId === dataId) {
        const course = queue[cursor];
        cursor += 1;
        try {
          const page = await fetchCoursePage(course.material.id);
          if (controller.signal.aborted || runId !== dataId) return;
          setUnitsState(course.key, {
            status: "ready",
            units: page.units || [],
            subType: page.subType
          });
        } catch (error) {
          if (controller.signal.aborted || runId !== dataId) return;
          setUnitsState(course.key, { status: "error" });
        }
      }
    };

    await Promise.all([worker(), worker(), worker()]);
  };

  const queueIntent = (course, unitNumber) => {
    if (!course || !course.material) return;
    const key = `${course.key}:${unitNumber == null ? "course" : unitNumber}`;
    const existing = intentTimers.get(key);
    if (existing) window.clearTimeout(existing);

    intentTimers.set(
      key,
      window.setTimeout(() => {
        intentTimers.delete(key);
        if (destroyed) return;

        const state = units.get(course.key);
        if (!state || state.status === "error" || state.status === "checking") {
          fetchCoursePage(course.material.id)
            .then((page) => {
              if (destroyed) return;
              setUnitsState(course.key, {
                status: "ready",
                units: page.units || [],
                subType: page.subType
              });
            })
            .catch(() => {});
        }

        if (Number.isInteger(unitNumber)) {
          prefetchUnitMaterials(course, unitNumber);
        }
      }, INTENT_DELAY_MS)
    );
  };

  const loadData = async ({ refresh = false } = {}) => {
    if (destroyed) return;
    if (fetchController) fetchController.abort();
    const controller = new AbortController();
    fetchController = controller;
    const id = (dataId += 1);
    const hadCache = Boolean(cache);

    if (!hadCache) view.renderLoading();
    else view.setRefreshing(true);

    try {
      const result = await loadSummary({ signal: controller.signal });
      if (controller.signal.aborted || id !== dataId || destroyed) return;

      const courses = buildCourses(result.attendance, result.materials);
      cache = {
        ...result,
        courses,
        semesterLabel: formatSemesterLabel(result.semester.label),
        warning: result.warning || ""
      };

      units = new Map();
      courses.forEach((course) => {
        if (!course.material) {
          units.set(course.key, { status: "unavailable" });
          return;
        }
        const page = coursePageFromCache(course.material.id);
        units.set(
          course.key,
          page
            ? { status: "ready", units: page.units || [], subType: page.subType }
            : { status: "checking" }
        );
      });

      renderCache();
      prefetchUnits();
    } catch (error) {
      if (controller.signal.aborted || id !== dataId || destroyed) return;
      const session = isSummarySessionError(error);

      if (hadCache) {
        view.setRefreshing(false);
        view.setNotice({
          tone: "warning",
          text: session
            ? "Your PESU session expired. Reload to refresh attendance."
            : "Couldn't refresh attendance. Showing the last update.",
          retry: !session,
          reload: session
        });
      } else {
        view.renderError({
          sessionExpired: session,
          title: session ? "Your session expired" : "Couldn't load attendance.",
          message: session
            ? "Reload the page and sign in again to see your attendance."
            : "PESU didn't respond. Check your connection and try again."
        });
      }
    } finally {
      if (fetchController === controller) fetchController = null;
    }
  };

  const onKeyDown = (event) => {
    if (!open || event.key !== "Escape") return;
    if (
      event.target instanceof Element &&
      event.target.closest("#pesu-max-root, #pesu-max-all-sections, #pesu-max-summary-toast")
    ) {
      return;
    }
    event.preventDefault();
    closeSummary();
  };

  const showOpenView = ({ fromRoute = false, focus = true } = {}) => {
    if (open || destroyed) {
      if (open && focus) view.focus();
      return;
    }

    if (typeof onBeforeOpen === "function") onBeforeOpen();

    if (fromRoute || location.hash === SUMMARY_HASH) {
      readRoute();
    } else {
      saved = { state: history.state, hash: location.hash, title: document.title };
      history.pushState({ [SUMMARY_STATE_KEY]: saved }, "", SUMMARY_HASH);
      pushed = true;
    }

    open = true;
    view.show();
    view.scrollToTop();
    setHostHidden(true);
    setTitle("Summary | PESU Academy");
    setActive(true);
    document.addEventListener("keydown", onKeyDown);

    if (cache) {
      renderCache();
      if (Date.now() - cache.fetchedAt > STALE_AFTER_MS) {
        void loadData({ refresh: true });
      } else {
        prefetchUnits();
      }
    } else {
      view.renderLoading();
      void loadData();
    }

    if (focus) view.focus();
  };

  const hideView = () => {
    open = false;
    view.hide();
    setHostHidden(false);
    restoreTitle();
    setActive(false);
    document.removeEventListener("keydown", onKeyDown);
    intentTimers.forEach((timer) => window.clearTimeout(timer));
    intentTimers.clear();
  };

  const closeSummary = ({ navigate = false } = {}) => {
    if (!open) return;

    if (!navigate && pushed) {
      hideView();
      pushed = false;
      history.back();
      if (trigger) trigger.focus({ preventScroll: true });
      return;
    }

    hideView();
    if (navigate) {
      if (location.hash === SUMMARY_HASH) {
        history.pushState(saved.state, "", baseUrl(saved.hash));
      }
      pushed = false;
      return;
    }
    if (location.hash === SUMMARY_HASH) {
      history.replaceState(saved.state, "", baseUrl(saved.hash));
    }
    pushed = false;

    if (trigger) trigger.focus({ preventScroll: true });
  };

  const openSection = (id) => {
    if (open) closeSummary({ navigate: true });
    if (typeof onOpenSection === "function") onOpenSection(id);
  };

  const openMaterial = (course, unitNumber) => {
    if (!course || !course.material) {
      showSummaryToast("Course materials aren't available for this course.", { tone: "danger" });
      return;
    }
    if (open) closeSummary({ navigate: true });
    void openCourseTarget(course, unitNumber);
  };

  const onPopState = () => {
    if (location.hash === SUMMARY_HASH) {
      if (!open) showOpenView({ fromRoute: true });
    } else if (open) {
      hideView();
      pushed = false;
      if (trigger) trigger.focus({ preventScroll: true });
    }
  };

  const onHashChange = () => {
    if (location.hash === SUMMARY_HASH) {
      if (!open) showOpenView({ fromRoute: true });
    } else if (open) {
      hideView();
      pushed = false;
    }
  };

  window.addEventListener("popstate", onPopState);
  window.addEventListener("hashchange", onHashChange);

  return {
    isOpen: () => open,
    openFromRoute() {
      if (location.hash === SUMMARY_HASH) showOpenView({ fromRoute: true });
    },
    toggle() {
      if (open) closeSummary();
      else if (location.hash === SUMMARY_HASH) showOpenView({ fromRoute: true });
      else showOpenView();
    },
    closeForNavigation() {
      if (open) closeSummary({ navigate: true });
      else if (location.hash === SUMMARY_HASH) {
        const state =
          history.state && history.state[SUMMARY_STATE_KEY] ? null : history.state;
        history.replaceState(state, "", baseUrl(""));
      }
    },
    destroy() {
      if (destroyed) return;
      if (open) hideView();
      destroyed = true;
      if (fetchController) fetchController.abort();
      if (prefetchController) prefetchController.abort();
      intentTimers.forEach((timer) => window.clearTimeout(timer));
      intentTimers.clear();
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("hashchange", onHashChange);
      view.destroy();
    },
    refresh() {
      if (open) void loadData({ refresh: true });
    }
  };
}
