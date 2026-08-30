import { Fragment } from "react";
import { Box, Link, Typography } from "@mui/material";
import { parseMarkdown, type Inline, type Block } from "@platform/shared";

// Render the shared Markdown AST as React. React escapes all text by default,
// so there is no raw-HTML sink and no XSS — model output is only ever placed as
// text children or as hrefs on http(s) links (which the parser guarantees).
function renderInlines(inlines: Inline[]) {
  return inlines.map((seg, i) => {
    switch (seg.type) {
      case "bold":
        return <strong key={i}>{seg.value}</strong>;
      case "italic":
        return <em key={i}>{seg.value}</em>;
      case "code":
        return (
          <Box
            key={i}
            component="code"
            sx={{
              fontFamily: "ui-monospace, monospace",
              fontSize: "0.9em",
              bgcolor: "rgba(20,19,26,0.06)",
              px: 0.5,
              borderRadius: 0.75
            }}
          >
            {seg.value}
          </Box>
        );
      case "link":
        return (
          <Link
            key={i}
            href={seg.value}
            target="_blank"
            rel="noopener noreferrer"
          >
            {seg.value}
          </Link>
        );
      default:
        return <Fragment key={i}>{seg.value}</Fragment>;
    }
  });
}

/**
 * Render a Markdown string (an assistant reply) as formatted, safe React.
 * Paragraphs, `#`–`###` headings, bullet/numbered lists, and inline
 * bold/italic/code/links are supported; everything else degrades to text.
 */
export function Markdown({ text }: { text: string }) {
  const blocks: Block[] = parseMarkdown(text);
  return (
    <>
      {blocks.map((block, i) => {
        if (block.type === "heading") {
          return (
            <Typography
              key={i}
              variant={block.level === 1 ? "subtitle1" : "subtitle2"}
              sx={{ fontWeight: 700, mt: i === 0 ? 0 : 1, mb: 0.5 }}
            >
              {renderInlines(block.inlines)}
            </Typography>
          );
        }
        if (block.type === "list") {
          return (
            <Box
              key={i}
              component={block.ordered ? "ol" : "ul"}
              sx={{ pl: 2.5, my: 0.5 }}
            >
              {block.items.map((item, j) => (
                <li key={j}>{renderInlines(item)}</li>
              ))}
            </Box>
          );
        }
        return (
          <Typography
            key={i}
            variant="body2"
            sx={{ mb: i === blocks.length - 1 ? 0 : 1 }}
          >
            {renderInlines(block.inlines)}
          </Typography>
        );
      })}
    </>
  );
}
