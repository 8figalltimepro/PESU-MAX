import React, { useEffect, useState } from "react";
import { Switch } from "@mui/material";
import SettingsRow from "./SettingsRow.jsx";
import { switchSx } from "../../styles/styles.js";
import { load, save } from "../../../src/utils/storage.js";

// Settings row backed by a boolean in chrome.storage.local. Unset/wrong-typed keys read as false.
// onDisable runs after the value is persisted as false.
const SettingsToggleRow = ({ storageKey, title, description, onDisable }) => {
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    load(storageKey).then((value) => setChecked(value === true));
  }, [storageKey]);

  const handleChange = () => {
    const next = !checked;
    setChecked(next);
    save(storageKey, next);
    if (!next) onDisable?.();
  };

  return (
    <SettingsRow title={title} description={description}>
      <Switch
        checked={checked}
        onChange={handleChange}
        sx={switchSx}
        slotProps={{ input: { "aria-label": title } }}
      />
    </SettingsRow>
  );
};

export default SettingsToggleRow;
