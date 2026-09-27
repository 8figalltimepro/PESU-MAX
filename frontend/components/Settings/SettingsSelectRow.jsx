import React, { useEffect, useState } from "react";
import { MenuItem, Select } from "@mui/material";
import SettingsRow from "./SettingsRow.jsx";
import { selectSx } from "../../styles/styles.js";
import theme from "../../Themes/theme.jsx";
import { load, save } from "../../../src/utils/storage.js";

// Select Row
const SettingsSelectRow = ({ storageKey, title, description, options }) => {
  const [value, setValue] = useState(options[0].value);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let stale = false;

    load(storageKey)
      .then((saved) => {
        if (!stale && options.some((option) => option.value === saved)) setValue(saved);
      })
      .catch(() => {})
      .finally(() => {
        if (!stale) setReady(true);
      });

    return () => {
      stale = true;
    };
  }, [storageKey, options]);

  const handleChange = async (event) => {
    const next = event.target.value;
    const previous = value;
    setValue(next);

    try {
      await save(storageKey, next);
    } catch (error) {
      console.warn(`[PESU-MAX] ${storageKey} could not be saved:`, error);
      setValue(previous);
    }
  };

  return (
    <SettingsRow title={title} description={description}>
      <Select
        value={value}
        onChange={handleChange}
        disabled={!ready}
        size="small"
        sx={{
          ...selectSx,
          minWidth: "140px",
          "& .MuiOutlinedInput-notchedOutline": { borderColor: theme.colors.primary },
          "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: theme.colors.primaryHover },
        }}
        slotProps={{ input: { "aria-label": title } }}
      >
        {options.map((option) => (
          <MenuItem key={option.value} value={option.value}>
            {option.label}
          </MenuItem>
        ))}
      </Select>
    </SettingsRow>
  );
};

export default SettingsSelectRow;
