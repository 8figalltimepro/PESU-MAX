import React, { useEffect, useState } from "react";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Switch,
  Typography
} from "@mui/material";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import LockIcon from "@mui/icons-material/Lock";
import ClassIcon from "@mui/icons-material/Class";
import PodcastsIcon from "@mui/icons-material/Podcasts";
import VideocamIcon from "@mui/icons-material/Videocam";
import SlideshowIcon from "@mui/icons-material/Slideshow";
import StickyNoteIcon from "@mui/icons-material/StickyNote2";
import AssignmentIcon from "@mui/icons-material/Assignment";
import LibraryBooksIcon from "@mui/icons-material/LibraryBooks";
import QuizIcon from "@mui/icons-material/Quiz";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import ChecklistIcon from "@mui/icons-material/Checklist";
import LinkIcon from "@mui/icons-material/Link";
import theme from "../../Themes/theme.jsx";
import { dialogPaperSx, dialogTitleSx, primaryButtonSx, switchSx } from "../../styles/styles.js";
import {
  defaultMaterialColumns,
  getMaterialColumnsDraft,
  saveMaterialColumns
} from "../../../src/content/materialColumns";

const COLUMN_ICONS = {
  "class": ClassIcon,
  "1": PodcastsIcon,
  "10": VideocamIcon,
  "2": SlideshowIcon,
  "3": StickyNoteIcon,
  "5": AssignmentIcon,
  "6": LibraryBooksIcon,
  "7": QuizIcon,
  "19": HelpOutlineIcon,
  "8": ChecklistIcon,
  "9": LinkIcon
};

const MaterialColumnsDialog = ({ open, onClose }) => {
  const [columns, setColumns] = useState([]);
  const [dragged, setDragged] = useState(null);

  useEffect(() => {
    if (!open) return undefined;

    let stale = false;
    getMaterialColumnsDraft().then((draft) => {
      if (!stale) setColumns(draft);
    });

    return () => {
      stale = true;
    };
  }, [open]);

  const moveBy = (id, delta) => {
    setColumns((current) => {
      const from = current.findIndex((column) => column.id === id);
      const to = from + delta;
      if (from < 0 || to < 1 || to > current.length - 1) return current;

      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  const moveBefore = (id, targetId) => {
    setColumns((current) => {
      const from = current.findIndex((column) => column.id === id);
      const to = current.findIndex((column) => column.id === targetId);
      if (from < 0 || to < 1 || from === to) return current;

      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to > from ? to - 1 : to, 0, moved);
      return next;
    });
  };

  const toggle = (id) => {
    setColumns((current) =>
      current.map((column) => (column.id === id ? { ...column, hidden: !column.hidden } : column))
    );
  };

  const handleSave = async () => {
    await saveMaterialColumns(columns);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xs"
      fullWidth
      PaperProps={{ sx: dialogPaperSx }}
    >
      <DialogTitle sx={{ ...dialogTitleSx, paddingBottom: "4px" }}>
        Re-order material types
      </DialogTitle>
      <DialogContent>
        <Typography
          variant="body2"
          sx={{ color: theme.colors.textMuted, fontSize: "12px", lineHeight: 1.6 }}
        >
          Drag a row to move the material column, switch it off to hide it. Class always stays first.
        </Typography>

        <Box sx={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "16px" }}>
          {columns.map((column) => {
            const Icon = COLUMN_ICONS[column.id];

            return (
              <Box
                key={column.id}
                draggable={!column.pinned}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", column.id);
                  setDragged(column.id);
                }}
                onDragEnter={() => {
                  if (dragged && !column.pinned) moveBefore(dragged, column.id);
                }}
                onDragOver={(event) => event.preventDefault()}
                onDragEnd={() => setDragged(null)}
                onDrop={(event) => event.preventDefault()}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "4px 8px",
                  borderRadius: "10px",
                  border: `1px solid ${theme.colors.secondaryLight}`,
                  backgroundColor: column.hidden ? "rgba(255, 255, 255, 0.6)" : "#ffffff",
                  cursor: column.pinned ? "default" : "grab",
                  opacity: dragged === column.id ? 0.45 : 1,
                  transition: "opacity 0.15s ease"
                }}
              >
                <IconButton
                  size="small"
                  disabled={column.pinned}
                  aria-label={`Move ${column.label}`}
                  onKeyDown={(event) => {
                    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                    event.preventDefault();
                    moveBy(column.id, event.key === "ArrowUp" ? -1 : 1);
                  }}
                  sx={{ padding: "2px" }}
                >
                  <DragIndicatorIcon
                    sx={{
                      fontSize: "18px",
                      color: column.pinned ? theme.colors.secondaryBorder : theme.colors.textMuted
                    }}
                  />
                </IconButton>
                <Box
                  sx={{
                    width: "46px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center"
                  }}
                >
                  {column.pinned ? (
                    <LockIcon
                      titleAccess="Class always stays first"
                      sx={{ fontSize: "17px", color: theme.colors.textMuted }}
                    />
                  ) : (
                    <Switch
                      size="small"
                      checked={!column.hidden}
                      onChange={() => toggle(column.id)}
                      sx={switchSx}
                      slotProps={{ input: { "aria-label": `${column.label} visibility` } }}
                    />
                  )}
                </Box>
                {Icon && <Icon sx={{ fontSize: "17px", color: theme.colors.secondary }} />}
                <Typography
                  sx={{ fontSize: "13px", fontWeight: 500, color: theme.colors.secondary }}
                >
                  {column.label}
                </Typography>
              </Box>
            );
          })}
        </Box>
      </DialogContent>
      <DialogActions sx={{ padding: "8px 24px 16px", gap: 1 }}>
        <Button onClick={onClose} sx={{ color: theme.colors.textMuted, textTransform: "none" }}>
          Cancel
        </Button>
        <Button
          onClick={() => setColumns(defaultMaterialColumns())}
          sx={{ color: theme.colors.secondary, textTransform: "none" }}
        >
          Reset
        </Button>
        <Button onClick={handleSave} sx={{ ...primaryButtonSx, color: "#ffffff" }}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default MaterialColumnsDialog;
