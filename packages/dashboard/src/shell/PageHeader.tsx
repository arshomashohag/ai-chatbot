import { Box, Typography } from "@mui/material";
import type { ReactNode } from "react";

export function PageHeader({
  title,
  subtitle,
  actions
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <Box sx={{ display: "flex", alignItems: "flex-start", gap: 2, mb: 3 }}>
      <Box sx={{ flexGrow: 1 }}>
        <Typography variant="h4" fontSize={24}>
          {title}
        </Typography>
        {subtitle && (
          <Typography color="text.secondary" fontSize={13} sx={{ mt: 0.25 }}>
            {subtitle}
          </Typography>
        )}
      </Box>
      {actions && (
        <Box sx={{ display: "flex", gap: 1, alignItems: "center", flex: "none" }}>
          {actions}
        </Box>
      )}
    </Box>
  );
}
