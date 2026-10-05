import { MATERIAL_COLUMN_ATTR } from "../materialColumns/materialColumnsStyle.js";
import {
  MATERIAL_ICON_SELECTOR,
  MATERIAL_LEGEND_SELECTOR,
  MATERIAL_NOTE_SELECTOR,
  materialTables,
} from "../academyPage.js";
import { MATERIAL_ICON_PATHS } from "./materialIconPaths.js";

export const MATERIAL_TABLE_ATTR = "data-pesu-max-material-table";

// Column id to icon name mapping
export const MATERIAL_ICON_BY_COLUMN = {
  1: "VideoLibraryOutlined",
  10: "VideocamOutlined",
  2: "CoPresentOutlined",
  3: "StickyNote2Outlined",
  5: "AssignmentTurnedInOutlined",
  6: "AssignmentOutlined",
  7: "LiveHelpOutlined",
  19: "HelpOutlined",
  8: "RuleOutlined",
  9: "DescriptionOutlined",
};

const PILL_ATTR = "data-pesu-max-material-pill";
const FLAG_ATTR = "data-pesu-max-material-flag";
const LEGEND_ATTR = "data-pesu-max-material-legend";
const LEGEND_TEXT_ATTR = "data-pesu-max-material-legend-text";
const ICON_ATTR = "data-pesu-max-material-icon";
const ICON_CLASS = "pesu-max-material-icon";
const SVG_NS = "http://www.w3.org/2000/svg";

function buildIcon(name) {
  const paths = MATERIAL_ICON_PATHS[name];
  if (!paths) return null;

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  paths.forEach((d) => {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  });

  return svg;
}

const columnIds = (table) => {
  const head = table.tHead && table.tHead.rows[0];
  return head ? [...head.cells].map((cell) => cell.id) : [];
};

const columnIdAt = (headIds, cell, index) =>
  cell.getAttribute(MATERIAL_COLUMN_ATTR) || headIds[index] || null;

function setIcon(holder, name) {
  if (holder.getAttribute(ICON_ATTR) === name) return;

  const svg = buildIcon(name);
  if (!svg) return;

  const old = holder.querySelector("svg");
  if (old) old.remove();

  holder.classList.add(ICON_CLASS);
  holder.setAttribute(ICON_ATTR, name);
  holder.appendChild(svg);
}

function clearIcon(holder) {
  const svg = holder.querySelector("svg");
  if (svg) svg.remove();

  holder.classList.remove(ICON_CLASS);
  holder.removeAttribute(ICON_ATTR);
}

function applyCell(cell, columnId, enabled) {
  const link = cell.querySelector("a");
  const name = MATERIAL_ICON_BY_COLUMN[columnId];
  if (!link || !name) return;

  if (!enabled) {
    link.removeAttribute(PILL_ATTR);
    link.removeAttribute(FLAG_ATTR);
    const holder = link.querySelector(`.${ICON_CLASS}`);
    if (holder) clearIcon(holder);
    return;
  }

  link.setAttribute(PILL_ATTR, "");
  if (link.querySelector(MATERIAL_NOTE_SELECTOR)) link.setAttribute(FLAG_ATTR, "");
  else link.removeAttribute(FLAG_ATTR);

  const holder = link.querySelector(MATERIAL_ICON_SELECTOR);
  if (holder) setIcon(holder, name);
}

function applyLegend(enabled) {
  const legend = document.querySelector(MATERIAL_LEGEND_SELECTOR);
  if (!legend) return;

  if (!enabled) {
    legend.removeAttribute(LEGEND_ATTR);
    const original = legend.getAttribute(LEGEND_TEXT_ATTR);
    if (original !== null) {
      legend.textContent = original;
      legend.removeAttribute(LEGEND_TEXT_ATTR);
    }
    return;
  }

  legend.setAttribute(LEGEND_ATTR, "");
  if (legend.querySelector("sup")) return;

  const stored = legend.getAttribute(LEGEND_TEXT_ATTR);
  const text = stored === null ? legend.textContent : stored;
  if (!/^\s*\*/.test(text)) return;

  const cleaned = text.replace(/^\s*\*\s*/, "");
  if (stored === null) legend.setAttribute(LEGEND_TEXT_ATTR, text);
  if (legend.textContent !== cleaned) legend.textContent = cleaned;
}

export function applyMaterialTable(enabled) {
  materialTables().forEach((table) => {
    const headIds = columnIds(table);

    [...table.tBodies].forEach((body) => {
      [...body.rows].forEach((row) => {
        [...row.cells].forEach((cell, index) => {
          applyCell(cell, columnIdAt(headIds, cell, index), enabled);
        });
      });
    });
  });

  applyLegend(enabled);
}
