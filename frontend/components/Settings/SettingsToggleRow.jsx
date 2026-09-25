import React, { useEffect, useState } from "react";
import { Switch } from "@mui/material";
import SettingsRow from "./SettingsRow.jsx";
import { switchSx } from "../../styles/styles.js";
import { load, save } from "../../../src/utils/storage.js";

// A boolean setting in chrome.storage.local. Unset or wrong-typed values read as false.
const SettingsToggleRow = ({ storageKey, title, description, onDisable }) => {
  const [checked, setChecked] = useState(false);
  // Waits for the stored value before accepting clicks.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let stale = false;

    load(storageKey)
      .then((value) => {
        if (!stale) setChecked(value === true);
      })
      .catch(() => {})
      .finally(() => {
        if (!stale) setReady(true);
      });

    return () => {
      stale = true;
    };
  }, [storageKey]);

  const handleChange = async () => {
    const next = !checked;
    setChecked(next);

    try {
      // An orphaned content script throws instead of saving.
      await save(storageKey, next);
    } catch (error) {
      console.warn(`[PESU-MAX] ${storageKey} could not be saved:`, error);
      setChecked(!next);
      return;
    }

    // Switching off also forgets what the setting stored.
    if (!next && onDisable) {
      await Promise.resolve(onDisable()).catch(() => {});
    }
  };

  return (
    <SettingsRow title={title} description={description}>
      <Switch
        checked={checked}
        onChange={handleChange}
        disabled={!ready}
        sx={switchSx}
        slotProps={{ input: { "aria-label": title } }}
      />
    </SettingsRow>
  );
};

export default SettingsToggleRow;
