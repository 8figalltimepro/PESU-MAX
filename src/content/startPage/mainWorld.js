import { MENU_ITEM_ID_PREFIX, isHome, menuItemFor } from "../academyPage.js";
import { START_PAGE_ATTR, START_PAGE_HOME } from "./startPage.js";

const savedPage = () => {
  const marker = document.documentElement.getAttribute(START_PAGE_ATTR);
  return marker && marker !== START_PAGE_HOME ? marker : null;
};

const isSiteStartClick = (target) =>
  document.readyState === "loading" &&
  target instanceof Element &&
  target.id.startsWith(MENU_ITEM_ID_PREFIX) &&
  isHome(target);

// capturing the click(jQuery) PESUAcademy does and swapping it
const hookTrigger = (jquery) => {
  const trigger = jquery.fn.trigger;
  if (trigger.pesuMaxStartPage) return;

  const hooked = function (type, data) {
    if (type !== "click" || !isSiteStartClick(this[0])) return trigger.apply(this, arguments);

    const page = savedPage();
    const wanted = page ? menuItemFor(page) : null;
    return wanted ? trigger.call(jquery(wanted), "click", data) : trigger.apply(this, arguments);
  };

  hooked.pesuMaxStartPage = true;
  jquery.fn.trigger = hooked;
};


Object.defineProperty(window, "$", {
  configurable: true,
  get: () => undefined,
  set: (value) => {
    Object.defineProperty(window, "$", { configurable: true, writable: true, value });
    if (value && value.fn && typeof value.fn.trigger === "function") hookTrigger(value);
  }
});
