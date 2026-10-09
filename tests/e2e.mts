import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { VOCABULARY } from "../data/vocabulary.ts";

const require = createRequire(import.meta.url);
const { chromium } = require("C:/Users/user/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors: string[] = [];
page.on("console", (message: { type(): string; text(): string }) => { if (message.type() === "error") errors.push(message.text()); });
page.on("pageerror", (error: Error) => errors.push(error.message));

await page.goto("http://127.0.0.1:4173/", { waitUntil: "networkidle" });
assert.equal(await page.title(), "Wortladen · 单词小店");
await page.getByRole("button", { name: /开始营业/ }).click();
await page.waitForSelector(".phase-waiting");

const clue = await page.locator(".order-bubble p").innerText();
const target = VOCABULARY.find((word) => [...word.descriptions.zh, ...word.descriptions.de].includes(clue));
assert.ok(target, `No word matched the rendered clue: ${clue}`);
const correctLabel = target.article ? `${target.article} ${target.word}` : target.word;
const cards = page.locator(".word-card");
const count = await cards.count();
let wrongIndex = -1;
for (let index = 0; index < count; index += 1) {
  const label = await cards.nth(index).getAttribute("aria-label");
  if (!label?.includes(`出牌 ${correctLabel}，`)) { wrongIndex = index; break; }
}
assert.ok(wrongIndex >= 0);
await cards.nth(wrongIndex).click();
await page.waitForSelector(".phase-wrong");
await page.waitForSelector(".phase-waiting");
assert.match(await page.locator(".order-bubble small").innerText(), /词性|答案含义/);

await page.getByRole("button", { name: new RegExp(`出牌 ${correctLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}，`) }).click();
await page.waitForSelector(".phase-paying");
assert.equal(await page.locator(".flying-coin").count(), 3);
await page.waitForFunction(() => document.querySelector(".money-bag-on-counter strong")?.textContent === "48");
await page.waitForSelector(".phase-waiting");
assert.equal((await page.locator(".day-progress strong").innerText()).trim(), "2 / 5");
await mkdir("test-results", { recursive: true });
await page.screenshot({ path: "test-results/shop-desktop.png", fullPage: true });

for (let customerNumber = 2; customerNumber <= 5; customerNumber += 1) {
  const nextClue = await page.locator(".order-bubble p").innerText();
  const nextTarget = VOCABULARY.find((word) => [...word.descriptions.zh, ...word.descriptions.de].includes(nextClue));
  assert.ok(nextTarget, `No word matched clue ${nextClue}`);
  const nextLabel = nextTarget.article ? `${nextTarget.article} ${nextTarget.word}` : nextTarget.word;
  await page.getByRole("button", { name: new RegExp(`出牌 ${nextLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}，`) }).click();
  await page.waitForSelector(".phase-paying");
  if (customerNumber < 5) await page.waitForSelector(".phase-waiting");
}
await page.waitForSelector(".ledger-paper");
assert.equal((await page.locator(".ledger-stats strong").first().innerText()).trim(), "5");
await page.getByRole("button", { name: "图鉴", exact: true }).click();
await page.locator('input[type="file"][accept=".json,.csv"]').setInputFiles("tests/fixtures/custom-word.json");
await page.waitForSelector("text=已导入 1 个词汇。");
await page.locator('.filters input').fill("tanzen");
assert.match(await page.locator(".lexicon-card").innerText(), /tanzen[\s\S]*跳舞/);

await page.getByRole("button", { name: "装修" }).click();
const rug = page.locator(".decor-list article").filter({ hasText: "编织地毯" });
await rug.getByRole("button").click();
assert.ok((await page.locator(".shop-preview").getAttribute("class"))?.includes("decor-rug"));
await page.waitForTimeout(350);
await page.reload({ waitUntil: "networkidle" });
await page.getByRole("button", { name: "装修" }).click();
assert.equal(await page.locator(".decor-list article").filter({ hasText: "编织地毯" }).getByRole("button").innerText(), "展示中");

await page.screenshot({ path: "test-results/desktop.png", fullPage: true });

const mobile = await context.newPage();
await mobile.setViewportSize({ width: 390, height: 844 });
await mobile.goto("http://127.0.0.1:4173/", { waitUntil: "networkidle" });
await mobile.getByRole("button", { name: "营业", exact: true }).click();
await mobile.getByRole("button", { name: /开始营业/ }).click();
await mobile.waitForSelector(".phase-waiting");
const widths = await mobile.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
assert.equal(widths.scroll, widths.client);
assert.ok(await mobile.locator(".money-bag-on-counter").isVisible());
assert.ok((await mobile.locator(".word-card").first().boundingBox())!.width >= 100);
await mobile.screenshot({ path: "test-results/mobile.png", fullPage: true });

assert.deepEqual(errors, []);
console.log(JSON.stringify({
  desktop: { clue, correct: correctLabel, wrongCardReturned: true, coinsAnimated: 3, balance: 48, nextCustomer: true },
  persistence: { decoration: "rug", survivedReload: true },
  mobile: { viewport: "390x844", horizontalOverflow: false, bagVisible: true },
}, null, 2));

await browser.close();
