export const MENU_ICONS_MIRROR_KEY = "pesuMaxMenuIcons";

export function readMenuIconsMirror() {
  try {
    return localStorage.getItem(MENU_ICONS_MIRROR_KEY);
  } catch (error) {
    return null;
  }
}

export function writeMenuIconsMirror(enabled) {
  try {
    localStorage.setItem(MENU_ICONS_MIRROR_KEY, enabled ? "1" : "0");
  } catch (error) {
  }
}
