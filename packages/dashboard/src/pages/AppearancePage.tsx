import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Box, Card, Stack, TextField, Button, MenuItem, Typography } from "@mui/material";
import { Appearance, type Appearance as AppearanceT, type AdminConfig } from "@platform/shared";
import { api } from "../api.js";
import { useSnackbar } from "../hooks/useSnackbar.js";
import { PageHeader } from "../shell/PageHeader.js";
import { LivePreview } from "./LivePreview.js";

const BRAND = "#6d5ae6";
const SWATCHES = ["#6d5ae6", "#0b5f5c", "#c0442c", "#14131a", "#2563eb", "#d9488a"];

export function AppearancePage({ config }: { config: AdminConfig | null }) {
  const snackbar = useSnackbar();
  const initial = config?.appearance;
  const { register, handleSubmit, control, watch, formState } = useForm<AppearanceT>({
    resolver: zodResolver(Appearance),
    mode: "onChange",
    defaultValues: {
      displayName: initial?.displayName ?? "Assistant",
      greeting: initial?.greeting ?? "Hi! How can I help?",
      color: initial?.color ?? BRAND,
      tone: initial?.tone ?? "friendly"
    }
  });

  const live = watch();

  async function onSubmit(values: AppearanceT) {
    try {
      await api.saveAppearance(values);
      snackbar.success("Appearance saved.");
    } catch (e) {
      snackbar.error((e as Error).message);
    }
  }

  return (
    <>
      <PageHeader
        title="Appearance"
        subtitle="Shape how your assistant looks — see it live as you type."
        actions={
          <Button
            type="submit"
            form="appearance-form"
            variant="contained"
            data-testid="save-appearance"
            disabled={!formState.isValid || formState.isSubmitting}
          >
            Save changes
          </Button>
        }
      />
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 380px" }, gap: 2.5, alignItems: "start" }}>
        <Card sx={{ p: 3 }}>
          <form id="appearance-form" onSubmit={handleSubmit(onSubmit)}>
            <Stack spacing={2.5}>
              <TextField
                label="Display name"
                inputProps={{ "data-testid": "a-name" }}
                error={Boolean(formState.errors.displayName)}
                helperText={formState.errors.displayName?.message}
                {...register("displayName")}
              />
              <TextField
                label="Greeting"
                inputProps={{ "data-testid": "a-greet" }}
                error={Boolean(formState.errors.greeting)}
                helperText={formState.errors.greeting?.message}
                {...register("greeting")}
              />
              <Box>
                <Typography color="text.secondary" fontSize={12} fontWeight={600} sx={{ mb: 1 }}>
                  Accent color
                </Typography>
                <Controller
                  control={control}
                  name="color"
                  render={({ field }) => (
                    <Stack direction="row" spacing={1} alignItems="center">
                      {SWATCHES.map((c) => (
                        <Box
                          key={c}
                          role="button"
                          aria-label={`Use ${c}`}
                          onClick={() => field.onChange(c)}
                          sx={{
                            width: 30,
                            height: 30,
                            borderRadius: "8px",
                            bgcolor: c,
                            cursor: "pointer",
                            border: "2px solid #fff",
                            boxShadow: field.value === c ? "0 0 0 2px #6d5ae6" : "0 0 0 1px rgba(20,19,26,.09)"
                          }}
                        />
                      ))}
                      <input
                        type="color"
                        aria-label="Custom color"
                        data-testid="a-color"
                        value={field.value}
                        onChange={field.onChange}
                        style={{ width: 40, height: 32, border: "none", background: "none", cursor: "pointer" }}
                      />
                    </Stack>
                  )}
                />
              </Box>
              <Controller
                control={control}
                name="tone"
                render={({ field }) => (
                  <TextField select label="Tone" inputProps={{ "data-testid": "a-tone" }} value={field.value} onChange={field.onChange} sx={{ maxWidth: 240 }}>
                    <MenuItem value="friendly">friendly</MenuItem>
                    <MenuItem value="professional">professional</MenuItem>
                    <MenuItem value="playful">playful</MenuItem>
                  </TextField>
                )}
              />
            </Stack>
          </form>
        </Card>
        <LivePreview displayName={live.displayName} greeting={live.greeting} color={live.color} />
      </Box>
    </>
  );
}
