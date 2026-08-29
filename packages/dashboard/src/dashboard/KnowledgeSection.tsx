import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Stack,
  TextField,
  Button,
  List,
  ListItem,
  ListItemText,
  IconButton,
  Typography,
  Divider
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/DeleteOutline";
import { KbEntryInput, ProfileInput, type KbEntry } from "@platform/shared";
import type { ProfileInput as ProfileInputT } from "@platform/shared";
import { api } from "../api.js";
import { useSnackbar } from "../hooks/useSnackbar.js";
import { Section } from "./Section.js";

export function KnowledgeSection({
  initialProfile,
  kb,
  onKbChanged
}: {
  initialProfile?: string;
  kb: KbEntry[];
  onKbChanged: () => Promise<void>;
}) {
  const snackbar = useSnackbar();

  const profileForm = useForm<ProfileInputT>({
    resolver: zodResolver(ProfileInput),
    mode: "onChange",
    defaultValues: { businessProfile: initialProfile ?? "" }
  });

  const faqForm = useForm<{ title: string; body: string }>({
    resolver: zodResolver(
      KbEntryInput.pick({ title: true, body: true })
    ),
    mode: "onChange",
    defaultValues: { title: "", body: "" }
  });

  async function saveProfile(v: ProfileInputT) {
    try {
      await api.saveProfile(v.businessProfile);
      snackbar.success("Business profile saved.");
    } catch (e) {
      snackbar.error((e as Error).message);
    }
  }

  async function addFaq(v: { title: string; body: string }) {
    try {
      await api.addKb({ type: "faq", title: v.title, body: v.body, enabled: true });
      faqForm.reset({ title: "", body: "" });
      await onKbChanged();
      snackbar.success("FAQ added.");
    } catch (e) {
      snackbar.error((e as Error).message);
    }
  }

  async function remove(id: string) {
    try {
      await api.deleteKb(id);
      await onKbChanged();
      snackbar.success("FAQ removed.");
    } catch (e) {
      snackbar.error((e as Error).message);
    }
  }

  return (
    <Section title="3. Knowledge">
      <form onSubmit={profileForm.handleSubmit(saveProfile)}>
        <Stack spacing={2}>
          <TextField
            label="Business profile"
            multiline
            minRows={3}
            inputProps={{ "data-testid": "k-profile" }}
            error={Boolean(profileForm.formState.errors.businessProfile)}
            helperText={profileForm.formState.errors.businessProfile?.message}
            {...profileForm.register("businessProfile")}
          />
          <Button
            type="submit"
            variant="contained"
            data-testid="save-profile"
            disabled={!profileForm.formState.isValid || profileForm.formState.isSubmitting}
            sx={{ alignSelf: "flex-start" }}
          >
            Save profile
          </Button>
        </Stack>
      </form>

      <Divider sx={{ my: 3 }} />

      <form onSubmit={faqForm.handleSubmit(addFaq)}>
        <Stack spacing={2}>
          <TextField
            label="FAQ — title"
            inputProps={{ "data-testid": "k-title" }}
            error={Boolean(faqForm.formState.errors.title)}
            helperText={faqForm.formState.errors.title?.message}
            {...faqForm.register("title")}
          />
          <TextField
            label="FAQ — answer"
            multiline
            minRows={2}
            inputProps={{ "data-testid": "k-body" }}
            error={Boolean(faqForm.formState.errors.body)}
            helperText={faqForm.formState.errors.body?.message}
            {...faqForm.register("body")}
          />
          <Button
            type="submit"
            variant="contained"
            data-testid="add-kb"
            disabled={!faqForm.formState.isValid || faqForm.formState.isSubmitting}
            sx={{ alignSelf: "flex-start" }}
          >
            Add FAQ
          </Button>
        </Stack>
      </form>

      {kb.length === 0 ? (
        <Typography color="text.secondary" sx={{ mt: 2 }}>
          No FAQs yet — add your first question above.
        </Typography>
      ) : (
        <List>
          {kb.map((e) => (
            <ListItem
              key={e.id}
              data-testid="kb-item"
              secondaryAction={
                <IconButton edge="end" aria-label="Delete FAQ" onClick={() => remove(e.id)}>
                  <DeleteIcon />
                </IconButton>
              }
            >
              <ListItemText primary={e.title} />
            </ListItem>
          ))}
        </List>
      )}
    </Section>
  );
}
