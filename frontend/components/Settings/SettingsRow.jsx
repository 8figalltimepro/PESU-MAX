import React from "react";
import { Box, Typography } from "@mui/material";
import {
  settingsRowSx,
  settingsRowTextSx,
  settingsRowTitleSx,
  settingsRowDescriptionSx,
} from "../../styles/styles.js";

// One settings card: title + description on the left, any control as children on the right.
const SettingsRow = ({ title, description, children }) => (
  <Box sx={settingsRowSx}>
    <Box sx={settingsRowTextSx}>
      <Typography sx={settingsRowTitleSx}>{title}</Typography>
      <Typography variant="body2" sx={settingsRowDescriptionSx}>
        {description}
      </Typography>
    </Box>
    {children}
  </Box>
);

export default SettingsRow;
