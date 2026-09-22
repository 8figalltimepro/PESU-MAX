const theme = {
  colors: {
    primary: '#F5821F',
    secondary: '#233A76',
    primaryHover: '#D66F1A',
    secondaryHover: '#1D2F5F',
    primaryLight: 'rgba(245, 130, 31, 0.12)',
    secondaryLight: 'rgba(35, 58, 118, 0.08)',
  },
  table: {
    rowEvenBg: 'rgba(245, 130, 31, 0.08)',
    rowOddBg: 'rgba(35, 58, 118, 0.06)',
    headerBg: '#233A76',
    headerText: '#ffffff',
  },
};

export const switchSx = {
  width: 46,
  height: 26,
  padding: 0,
  "& .MuiSwitch-switchBase": {
    padding: "3px",
    transitionDuration: "200ms",
    "&.Mui-checked": {
      transform: "translateX(20px)",
      "& + .MuiSwitch-track": {
        backgroundColor: theme.colors.primary,
        borderColor: theme.colors.primary,
        opacity: 1,
      },
    },
    "&.Mui-focusVisible .MuiSwitch-thumb": {
      boxShadow: `0 0 0 4px ${theme.colors.primaryLight}`,
    },
  },
  "& .MuiSwitch-thumb": {
    width: 20,
    height: 20,
    boxShadow: "none",
    backgroundColor: "rgba(35, 58, 118, 0.35)",
  },
  "& .Mui-checked .MuiSwitch-thumb": {
    backgroundColor: "#ffffff",
  },
  "& .MuiSwitch-track": {
    borderRadius: 999,
    border: "1.5px solid rgba(35, 58, 118, 0.25)",
    backgroundColor: "#ffffff",
    opacity: 1,
  },
};

export default theme;
