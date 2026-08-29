import { test, expect } from "@playwright/test";

const PORTAL = "http://localhost:4510";
const MERCHANT = "http://localhost:4511";

test("money path: setup → key → embed → FAQ-grounded answer → transcript", async ({
  page
}) => {
  // Seed the E2E auth token so the portal treats us as logged in.
  await page.goto(PORTAL);
  await page.evaluate(() => localStorage.setItem("e2e_token", "test-token"));
  await page.reload();

  // The portal is an app shell with a sidebar. Basics + profile + FAQs live on
  // the Knowledge section; the key on Install; transcripts on Conversations.
  await page.getByRole("link", { name: "Knowledge" }).click();

  // 1. Business basics (one allowed domain).
  await page.getByTestId("b-name").fill("Hat Shop");
  await page.getByTestId("b-url").fill("https://shop.example.com");
  await page.getByTestId("b-dom").fill("http://localhost:4511");
  await page.getByTestId("save-basics").click();

  // 2. Business profile.
  await page.getByTestId("k-profile").fill("We are a boutique hat retailer.");
  await page.getByTestId("save-profile").click();

  // 3. One FAQ entry the answer will be grounded on.
  await page.getByTestId("k-title").fill("Returns");
  await page
    .getByTestId("k-body")
    .fill("You can return any hat within 30 days for a full refund.");
  await page.getByTestId("add-kb").click();
  await expect(page.getByTestId("kb-item")).toHaveText(/Returns/);

  // 4. Issue the key on the Install section; plaintext shown once.
  await page.getByRole("link", { name: "Install" }).click();
  await page.getByTestId("issue-key").click();
  const siteKey = await page.getByTestId("site-key").textContent();
  expect(siteKey).toMatch(/^pk_live_/);
  await expect(page.getByTestId("snippet")).toContainText("data-site-key");

  // 5. Embed on the merchant page and ask a question answered from the FAQ.
  const merchant = await page.context().newPage();
  await merchant.goto(MERCHANT);
  await merchant.locator("[data-platform-widget] .bubble").click();
  const frame = merchant.frameLocator("[data-platform-widget] iframe.frame");
  await expect(frame.locator("#root")).toHaveAttribute("data-state", "connected");
  await frame.locator("#input").fill("What is your return policy?");
  await frame.locator("#send").click();
  await expect(frame.locator(".msg.bot").last()).toContainText(
    "within 30 days"
  );
  await merchant.close();

  // 6. Transcript is visible in the portal (Conversations section), tenant-scoped.
  await page.getByRole("link", { name: "Conversations" }).click();
  await page.getByTestId("sess-open").first().click();
  await expect(page.getByTestId("transcript-msg").first()).toContainText(
    "return policy"
  );
});
