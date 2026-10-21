import { summaryIcon } from "./summaryIcons.js";

let active = null;
let timer = 0;

export function closeSummaryToast() {
  if (timer) window.clearTimeout(timer);
  timer = 0;
  if (active) active.remove();
  active = null;
}

export function showSummaryToast(text, { tone = "info", timeout = 8000 } = {}) {
  if (!text) return;
  closeSummaryToast();

  const toast = document.createElement("div");
  toast.id = "pesu-max-summary-toast";
  toast.dataset.tone = tone;
  toast.setAttribute("role", tone === "danger" ? "alert" : "status");

  const icon = document.createElement("span");
  icon.className = "pesu-max-summary-toast-icon";
  const glyph = summaryIcon(tone === "danger" ? "alert" : "info");
  if (glyph) icon.appendChild(glyph);

  const message = document.createElement("span");
  message.className = "pesu-max-summary-toast-text";
  message.textContent = text;

  const close = document.createElement("button");
  close.type = "button";
  close.className = "pesu-max-summary-toast-close";
  close.setAttribute("aria-label", "Dismiss message");
  const closeIcon = summaryIcon("close");
  if (closeIcon) close.appendChild(closeIcon);
  close.addEventListener("click", closeSummaryToast);

  toast.append(icon, message, close);
  document.body.appendChild(toast);
  active = toast;
  timer = window.setTimeout(closeSummaryToast, timeout);
}
