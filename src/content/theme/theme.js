import { load } from "../../utils/storage.js";
import { THEME_FONT_KEY, THEME_PALETTE_KEY } from "../../utils/storageKeys.js";
import { applyTheme, themeValues } from "./themeApply.js";
import { writeThemeMirror } from "./themeMirror.js";

const THEME_KEYS = [THEME_PALETTE_KEY, THEME_FONT_KEY];

const loadValues = () =>
  Promise.all(THEME_KEYS.map((key) => load(key))).then(([theme, font]) => ({ theme, font }));

const apply = (values) => {
  const normalized = themeValues(values);
  applyTheme(normalized);
  writeThemeMirror(normalized);
};

// Off by default
export async function initTheme() {
  apply(await loadValues());

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !THEME_KEYS.some((key) => changes[key])) return;
    loadValues().then(apply).catch(() => {});
  });
}
