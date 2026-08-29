import { useEffect, useState } from "react";
import { CircularProgress, Box } from "@mui/material";
import type { AdminConfig, KbEntry } from "@platform/shared";
import { api } from "../api.js";
import { PageHeader } from "../shell/PageHeader.js";
import { BasicsForm } from "../dashboard/BasicsForm.js";
import { KnowledgeSection } from "../dashboard/KnowledgeSection.js";
import { useSnackbar } from "../hooks/useSnackbar.js";

// Business basics + business profile + FAQs all live under "Knowledge": what the
// assistant knows and where it's allowed to run.
export function KnowledgePage({ config }: { config: AdminConfig | null }) {
  const snackbar = useSnackbar();
  const [kb, setKb] = useState<KbEntry[] | null>(null);

  async function reloadKb() {
    setKb(await api.listKb());
  }

  useEffect(() => {
    api
      .listKb()
      .then(setKb)
      .catch(() => snackbar.error("Couldn't load your FAQs."));
  }, [snackbar]);

  return (
    <>
      <PageHeader
        title="Knowledge"
        subtitle="What your assistant knows. It answers only from this — never made up."
      />
      <Box sx={{ display: "grid", gap: 2.5 }}>
        <BasicsForm initial={config?.basics} />
        {kb === null ? (
          <Box sx={{ display: "grid", placeItems: "center", py: 4 }}>
            <CircularProgress />
          </Box>
        ) : (
          <KnowledgeSection
            initialProfile={config?.businessProfile}
            kb={kb}
            onKbChanged={reloadKb}
          />
        )}
      </Box>
    </>
  );
}
