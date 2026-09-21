import React, { useSyncExternalStore } from "react";
import { useDispatch } from "react-redux";
import { Box, Typography, IconButton, Button } from "@mui/material";
import KeyboardBackspaceIcon from "@mui/icons-material/KeyboardBackspace";
import EditIcon from "@mui/icons-material/Edit";
import { closeSidebar, setCurrentPage } from "../redux/sidebarSlice.js";
import theme from "../Themes/theme.jsx";
import {
  getMenuReorderSnapshot,
  startMenuEdit,
  subscribeToMenuReorder,
} from "../../src/content/menuReorder.js";

const Settings = () => {
  const dispatch = useDispatch();
  const { canReorder, isEditing } = useSyncExternalStore(
    subscribeToMenuReorder,
    getMenuReorderSnapshot,
    getMenuReorderSnapshot
  );
  const [keepSignedIn, setKeepSignedIn] = useState(false);

  useEffect(() => {
    load(SESSION_KEEPER_KEY).then((value) => setKeepSignedIn(value === true));
  }, []);

  const handleBack = () => {
    dispatch(setCurrentPage("home"));
  };

  const handleEdit = () => {
    if (startMenuEdit()) {
      dispatch(closeSidebar());
    }
  };

  return (
    <Box sx={{ padding: "16px" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
        <IconButton
          onClick={handleBack}
          aria-label="Back to home"
          sx={{ color: theme.colors.secondary, padding: "4px" }}
        >
          <KeyboardBackspaceIcon />
        </IconButton>
        <Typography variant="h6" sx={{ color: theme.colors.secondary, fontWeight: "bold" }}>
          Settings
        </Typography>
      </Box>

      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
          padding: "14px",
          border: "1.5px solid rgba(35, 58, 118, 0.2)",
          borderRadius: "12px",
        }}
      >
        <Box sx={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <Typography sx={{ color: theme.colors.secondary, fontWeight: 600, fontSize: "15px" }}>
            Re-order side menu
          </Typography>
          <Typography variant="body2" sx={{ color: "#666666", fontSize: "12.5px" }}>
            Drag the PESU Academy menu into the order you want and lock it in. Home always stays first.
          </Typography>
        </Box>
        <Button
          onClick={handleEdit}
          disabled={!canReorder || isEditing}
          startIcon={<EditIcon sx={{ fontSize: "18px" }} />}
          sx={{
            backgroundColor: theme.colors.primary,
            color: "#ffffff",
            textTransform: "none",
            fontSize: "13px",
            fontWeight: 500,
            padding: "8px 14px",
            minWidth: "auto",
            borderRadius: "8px",
            whiteSpace: "nowrap",
            "&:hover": { backgroundColor: theme.colors.primaryHover },
            "&.Mui-disabled": {
              backgroundColor: theme.colors.primary,
              color: "#ffffff",
              opacity: 0.55,
            },
          }}
        >
          {isEditing ? "Editing..." : "Edit"}
        </Button>
      </Box>

      {isEditing && (
        <Typography variant="body2" sx={{ color: theme.colors.secondary, marginTop: "12px" }}>
          Edit mode is active on the page. Use Reset or the tick to lock the order in.
        </Typography>
      )}

      {!canReorder && (
        <Typography variant="body2" sx={{ color: "#d32f2f", marginTop: "12px" }}>
          Open your PESU Academy profile page to re-order the menu.
        </Typography>
      )}
    </Box>
  );
};

export default Settings;
