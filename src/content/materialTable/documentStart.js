import { load } from "../../utils/storage.js";
import { MATERIAL_TABLE_KEY } from "../../utils/storageKeys.js";
import { MATERIAL_TABLE_ATTR } from "./materialTableApply.js";
import { readMaterialTableMirror } from "./materialTableMirror.js";

const markEnabled = () => document.documentElement.setAttribute(MATERIAL_TABLE_ATTR, "");

const mirrored = readMaterialTableMirror();

if (mirrored === "1") markEnabled();
else if (mirrored === null) {
  load(MATERIAL_TABLE_KEY)
    .then((enabled) => {
      if (enabled === true) markEnabled();
    })
    .catch(() => {});
}
