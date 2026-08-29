import { useEffect, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import {
  Box,
  Card,
  Typography,
  LinearProgress,
  Button,
  CircularProgress
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import { api } from "../api.js";
import type { AdminConfig, UsageResponse } from "@platform/shared";
import { PageHeader } from "../shell/PageHeader.js";
import { StatusChip } from "../shell/AppShell.js";
import { useSnackbar } from "../hooks/useSnackbar.js";

function Stat({
  label,
  value,
  meta,
  progress
}: {
  label: string;
  value: string;
  meta?: string;
  progress?: number;
}) {
  return (
    <Card sx={{ p: 2.5 }}>
      <Typography color="text.secondary" fontSize={12.5} fontWeight={600}>
        {label}
      </Typography>
      <Typography fontSize={30} fontWeight={800} sx={{ mt: 0.5, letterSpacing: "-0.03em" }}>
        {value}
      </Typography>
      {progress !== undefined && (
        <LinearProgress
          variant="determinate"
          value={Math.min(100, progress)}
          sx={{ mt: 1.25, height: 6, borderRadius: 99, bgcolor: "#f4f1fe" }}
        />
      )}
      {meta && (
        <Typography color="text.secondary" fontSize={12} sx={{ mt: 0.75 }}>
          {meta}
        </Typography>
      )}
    </Card>
  );
}

export function OverviewPage({ config }: { config: AdminConfig | null }) {
  const snackbar = useSnackbar();
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    api
      .getUsage()
      .then((u) => {
        if (active) setUsage(u);
      })
      .catch(() => snackbar.error("Couldn't load usage stats."))
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [snackbar]);

  const hasKey = config?.hasKey ?? false;
  const steps = [
    { done: (config?.basics?.allowedDomains?.length ?? 0) > 0, t: "Business basics", s: "Add your domains" },
    { done: Boolean(config?.appearance), t: "Appearance", s: "Brand your assistant" },
    { done: Boolean(config?.businessProfile?.trim()), t: "Knowledge", s: "Add FAQs" },
    { done: hasKey, t: "Install", s: "Add the snippet" }
  ];
  const pct = usage ? Math.round((usage.messages / Math.max(1, usage.limit)) * 100) : 0;

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle="Your assistant at a glance."
        actions={<StatusChip live={hasKey} label={hasKey ? "Ready to embed" : "Finish setup"} />}
      />

      {loading ? (
        <Box sx={{ display: "grid", placeItems: "center", py: 6 }}>
          <CircularProgress />
        </Box>
      ) : (
        <>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(3,1fr)" }, gap: 2 }}>
            <Stat
              label="Messages this month"
              value={usage ? usage.messages.toLocaleString() : "—"}
              progress={pct}
              meta={usage ? `${pct}% of your ${usage.limit.toLocaleString()} monthly limit` : undefined}
            />
            <Stat
              label="Conversations"
              value={usage ? usage.sessions.toLocaleString() : "—"}
              meta="Distinct chat sessions"
            />
            <Stat label="Grounded answers" value="—" meta="Coming soon" />
          </Box>

          <Card sx={{ p: 2.5, mt: 2.5 }}>
            <Typography variant="subtitle2" color="text.secondary" fontSize={10} sx={{ mb: 1.5 }}>
              Setup
            </Typography>
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2.5 }}>
              {steps.map((step) => (
                <Box key={step.t} sx={{ display: "flex", alignItems: "center", gap: 1.25, flex: "1 1 200px" }}>
                  {step.done ? (
                    <CheckCircleIcon sx={{ color: "#0b5f5c", fontSize: 24 }} />
                  ) : (
                    <RadioButtonUncheckedIcon sx={{ color: "#b2aec2", fontSize: 24 }} />
                  )}
                  <Box>
                    <Typography fontSize={13} fontWeight={600}>
                      {step.t}
                    </Typography>
                    <Typography color="text.secondary" fontSize={11.5}>
                      {step.s}
                    </Typography>
                  </Box>
                </Box>
              ))}
            </Box>
            {!hasKey && (
              <Button
                component={RouterLink}
                to="/install"
                variant="contained"
                sx={{ mt: 2 }}
              >
                Finish setup → Install
              </Button>
            )}
          </Card>
        </>
      )}
    </>
  );
}
