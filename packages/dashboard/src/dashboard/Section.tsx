import { Paper, Typography, Box, type SxProps } from "@mui/material";
import type { ReactNode } from "react";

export function Section({
  title,
  children,
  sx
}: {
  title: string;
  children: ReactNode;
  sx?: SxProps;
}) {
  return (
    <Paper
      elevation={0}
      sx={{ p: 3, border: "1px solid", borderColor: "divider", borderRadius: 4, ...sx }}
    >
      <Typography variant="h6" fontWeight={700} sx={{ mb: 2 }}>
        {title}
      </Typography>
      <Box>{children}</Box>
    </Paper>
  );
}
