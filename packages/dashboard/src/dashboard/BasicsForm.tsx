import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Stack, TextField, Button, IconButton, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/DeleteOutline";
import { BusinessBasics, type BusinessBasics as Basics } from "@platform/shared";
import { api } from "../api.js";
import { useSnackbar } from "../hooks/useSnackbar.js";
import { Section } from "./Section.js";

export function BasicsForm({ initial }: { initial?: Basics }) {
  const snackbar = useSnackbar();
  const { register, handleSubmit, control, formState } = useForm<Basics>({
    resolver: zodResolver(BusinessBasics),
    mode: "onChange",
    defaultValues: {
      name: initial?.name ?? "",
      websiteUrl: initial?.websiteUrl ?? "",
      allowedDomains: initial?.allowedDomains?.length
        ? initial.allowedDomains
        : [""]
    }
  });

  async function onSubmit(values: Basics) {
    try {
      await api.saveBasics(values);
      snackbar.success("Business basics saved.");
    } catch (e) {
      snackbar.error((e as Error).message);
    }
  }

  return (
    <Section title="1. Business basics">
      <form onSubmit={handleSubmit(onSubmit)}>
        <Stack spacing={2}>
          <TextField
            label="Business name"
            inputProps={{ "data-testid": "b-name" }}
            error={Boolean(formState.errors.name)}
            helperText={formState.errors.name?.message}
            {...register("name")}
          />
          <TextField
            label="Website URL"
            type="url"
            inputProps={{ "data-testid": "b-url" }}
            error={Boolean(formState.errors.websiteUrl)}
            helperText={formState.errors.websiteUrl?.message}
            {...register("websiteUrl")}
          />
          <Typography variant="body2" color="text.secondary">
            The widget only runs on these domains.
          </Typography>
          <Controller
            control={control}
            name="allowedDomains"
            render={({ field }) => (
              <Stack spacing={1}>
                {field.value.map((domain, i) => (
                  <Stack direction="row" spacing={1} key={i} alignItems="flex-start">
                    <TextField
                      label={`Allowed domain ${i + 1}`}
                      type="url"
                      value={domain}
                      onChange={(e) => {
                        const next = [...field.value];
                        next[i] = e.target.value;
                        field.onChange(next);
                      }}
                      inputProps={i === 0 ? { "data-testid": "b-dom" } : undefined}
                      error={Boolean(formState.errors.allowedDomains?.[i])}
                      helperText={formState.errors.allowedDomains?.[i]?.message}
                    />
                    {field.value.length > 1 && (
                      <IconButton
                        aria-label="Remove domain"
                        onClick={() =>
                          field.onChange(field.value.filter((_, j) => j !== i))
                        }
                      >
                        <DeleteIcon />
                      </IconButton>
                    )}
                  </Stack>
                ))}
                <Button
                  startIcon={<AddIcon />}
                  onClick={() => field.onChange([...field.value, ""])}
                  sx={{ alignSelf: "flex-start" }}
                >
                  Add domain
                </Button>
              </Stack>
            )}
          />
          <Button
            type="submit"
            variant="contained"
            data-testid="save-basics"
            disabled={!formState.isValid || formState.isSubmitting}
            sx={{ alignSelf: "flex-start" }}
          >
            Save basics
          </Button>
        </Stack>
      </form>
    </Section>
  );
}
