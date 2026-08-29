import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Stack,
  TextField,
  Button,
  MenuItem,
  Box,
  Typography
} from "@mui/material";
import { Appearance, type Appearance as AppearanceT } from "@platform/shared";
import { api } from "../api.js";
import { useSnackbar } from "../hooks/useSnackbar.js";
import { Section } from "./Section.js";

const BRAND = "#6d5ae6";

export function AppearanceForm({ initial }: { initial?: AppearanceT }) {
  const snackbar = useSnackbar();
  const { register, handleSubmit, control, formState } = useForm<AppearanceT>({
    resolver: zodResolver(Appearance),
    mode: "onChange",
    defaultValues: {
      displayName: initial?.displayName ?? "Assistant",
      greeting: initial?.greeting ?? "Hi! How can I help?",
      color: initial?.color ?? BRAND,
      tone: initial?.tone ?? "friendly"
    }
  });

  async function onSubmit(values: AppearanceT) {
    try {
      await api.saveAppearance(values);
      snackbar.success("Appearance saved.");
    } catch (e) {
      snackbar.error((e as Error).message);
    }
  }

  return (
    <Section title="2. Appearance">
      <form onSubmit={handleSubmit(onSubmit)}>
        <Stack spacing={2}>
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
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Accent color
            </Typography>
            <Controller
              control={control}
              name="color"
              render={({ field }) => (
                <input
                  type="color"
                  aria-label="Accent color"
                  data-testid="a-color"
                  value={field.value}
                  onChange={field.onChange}
                  style={{ width: 56, height: 40, border: "none", background: "none" }}
                />
              )}
            />
          </Box>
          <Controller
            control={control}
            name="tone"
            render={({ field }) => (
              <TextField
                select
                label="Tone"
                inputProps={{ "data-testid": "a-tone" }}
                value={field.value}
                onChange={field.onChange}
              >
                <MenuItem value="friendly">friendly</MenuItem>
                <MenuItem value="professional">professional</MenuItem>
                <MenuItem value="playful">playful</MenuItem>
              </TextField>
            )}
          />
          <Button
            type="submit"
            variant="contained"
            data-testid="save-appearance"
            disabled={!formState.isValid || formState.isSubmitting}
            sx={{ alignSelf: "flex-start" }}
          >
            Save appearance
          </Button>
        </Stack>
      </form>
    </Section>
  );
}
