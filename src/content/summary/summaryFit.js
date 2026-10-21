// The collapsed sheet is uniformly zoomed when it would not fit the window, so the
// whole card stays visible without scrolling; expanding the calendar restores scrolling.
const MIN_FIT_SCALE = 0.4;
const FIT_SAFETY_PX = 1;

export function createSummaryFit({ root, inner, sheet }) {
  let frame = 0;
  let expanded = false;
  let destroyed = false;

  const clearFrame = () => {
    if (frame) window.cancelAnimationFrame(frame);
    frame = 0;
  };

  const availableHeight = () => {
    const style = window.getComputedStyle(inner);
    const top = Number.parseFloat(style.paddingTop) || 0;
    const bottom = Number.parseFloat(style.paddingBottom) || 0;
    return root.clientHeight - top - bottom - FIT_SAFETY_PX;
  };

  const apply = () => {
    clearFrame();
    if (destroyed || root.hidden) return;

    root.dataset.calendarScroll = expanded ? "true" : "false";
    if (expanded) return;

    sheet.style.zoom = "";
    const natural = sheet.offsetHeight;
    const available = availableHeight();
    if (natural <= 0 || available <= 0) return;

    const ratio = available / natural;
    if (ratio >= 0.999) return;

    sheet.style.zoom = String(Math.max(MIN_FIT_SCALE, Math.floor(ratio * 1000) / 1000));
    if (ratio < MIN_FIT_SCALE) root.dataset.calendarScroll = "true";
  };

  const schedule = () => {
    if (destroyed || frame) return;
    frame = window.requestAnimationFrame(apply);
  };

  window.addEventListener("resize", schedule);
  const observer =
    typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
  if (observer) observer.observe(root);
  if (document.fonts && typeof document.fonts.addEventListener === "function") {
    document.fonts.addEventListener("loadingdone", schedule);
  }

  return {
    refresh: apply,
    setExpanded(value) {
      const next = Boolean(value);
      if (next === expanded) return;
      expanded = next;
      if (!expanded) root.scrollTop = 0;
      apply();
    },
    destroy() {
      destroyed = true;
      clearFrame();
      if (observer) observer.disconnect();
      window.removeEventListener("resize", schedule);
      if (document.fonts && typeof document.fonts.removeEventListener === "function") {
        document.fonts.removeEventListener("loadingdone", schedule);
      }
    }
  };
}
