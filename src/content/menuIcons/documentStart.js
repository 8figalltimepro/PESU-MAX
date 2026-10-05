import { load } from "../../utils/storage.js";
import { MENU_ICONS_KEY } from "../../utils/storageKeys.js";
import { MENU_ICONS_ATTR } from "./menuIconsApply.js";
import { readMenuIconsMirror } from "./menuIconsMirror.js";

const markEnabled = () => document.documentElement.setAttribute(MENU_ICONS_ATTR, "");

const mirrored = readMenuIconsMirror();

if (mirrored === "1") markEnabled();
else if (mirrored === null) {
  load(MENU_ICONS_KEY)
    .then((enabled) => {
      if (enabled === true) markEnabled();
    })
    .catch(() => {});
}
