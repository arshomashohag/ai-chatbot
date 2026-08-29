import { useEffect, useState } from "react";
import { CircularProgress, Box } from "@mui/material";
import type { SessionSummary } from "@platform/shared";
import { api } from "../api.js";
import { PageHeader } from "../shell/PageHeader.js";
import { SessionsSection } from "../dashboard/SessionsSection.js";

export function ConversationsPage() {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);

  useEffect(() => {
    api
      .listSessions()
      .then(setSessions)
      .catch(() => setSessions([]));
  }, []);

  return (
    <>
      <PageHeader
        title="Conversations"
        subtitle="See what people are actually asking your assistant."
      />
      {sessions === null ? (
        <Box sx={{ display: "grid", placeItems: "center", py: 4 }}>
          <CircularProgress />
        </Box>
      ) : (
        <SessionsSection sessions={sessions} />
      )}
    </>
  );
}
