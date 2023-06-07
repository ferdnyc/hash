import { Components, Theme } from "@mui/material";

export const MuiTooltipThemeOptions: Components<Theme>["MuiTooltip"] = {
  defaultProps: {
    placement: "right",
    PopperProps: {
      modifiers: [
        {
          name: "offset",
          options: {
            offset: [0, -8],
          },
        },
      ],
    },
  },
  styleOverrides: {
    tooltip: ({ theme }) => ({
      backgroundColor: theme.palette.gray[90],
      padding: "6px 12px",
      color: theme.palette.common.white,
      fontSize: 13,
      lineHeight: "18px",
      fontWeight: 500,
    }),
  },
};
