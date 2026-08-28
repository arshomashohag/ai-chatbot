import { test, expect } from "@playwright/test";

const ALLOWED = "http://localhost:4310";
const FOREIGN = "http://localhost:4311";

test("allowed origin: bubble renders and handshake succeeds", async ({ page }) => {
  await page.goto(ALLOWED);

  const host = page.locator("[data-platform-widget]");
  await expect(host).toBeAttached();

  const bubble = host.locator(".bubble");
  await expect(bubble).toBeVisible();
  await bubble.click();

  const frame = page.frameLocator("[data-platform-widget] iframe.frame");
  await expect(frame.locator("#root")).toHaveAttribute("data-state", "connected");
  // The greeting is rendered as the first assistant message bubble.
  await expect(frame.locator(".msg.bot").first()).toHaveText("Hi there!");
  await expect(frame.locator("#header")).toHaveText("Dev Bot");
});

test("foreign origin: handshake returns 403, chat shows unavailable", async ({ page }) => {
  await page.goto(FOREIGN);

  const bubble = page.locator("[data-platform-widget] .bubble");
  await bubble.click();

  const frame = page.frameLocator("[data-platform-widget] iframe.frame");
  await expect(frame.locator("#root")).toHaveAttribute("data-state", "unavailable");
});
