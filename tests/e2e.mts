import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { VOCABULARY } from "../data/vocabulary.ts";

const require = createRequire(import.meta.url);
const { chromium } = require("C:/Users/user/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
async function instrumentAudio(targetPage: { evaluate: (expression: string) => Promise<unknown> }) {
  await targetPage.evaluate(`(() => {
    window.__audioResumeCount = 0;
    window.__audioStartCount = 0;
    const originalResume = window.AudioContext.prototype.resume;
    window.AudioContext.prototype.resume = new Proxy(originalResume, {
      apply(target, thisArg, args) {
        window.__audioResumeCount += 1;
        return Reflect.apply(target, thisArg, args);
      }
    });
    const originalCreateOscillator = window.AudioContext.prototype.createOscillator;
    window.AudioContext.prototype.createOscillator = new Proxy(originalCreateOscillator, {
      apply(target, thisArg, args) {
        const oscillator = Reflect.apply(target, thisArg, args);
        const originalStart = oscillator.start;
        oscillator.start = new Proxy(originalStart, {
          apply(startTarget, startThisArg, startArgs) {
            window.__audioStartCount += 1;
            return Reflect.apply(startTarget, startThisArg, startArgs);
          }
        });
        return oscillator;
      }
    });
  })()`);
}

const browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
await page.addInitScript(() => { Math.random = () => 0; });
const errors: string[] = [];
page.on("console", (message: { type(): string; text(): string }) => { if (message.type() === "error") errors.push(message.text()); });
page.on("pageerror", (error: Error) => errors.push(error.message));

await page.goto("http://127.0.0.1:4173/", { waitUntil: "networkidle" });
await instrumentAudio(page);
assert.equal(await page.title(), "Wortladen · 单词小店");
await page.getByRole("button", { name: /开始营业/ }).click();
await page.waitForSelector(".phase-waiting");
const audioActivation = await page.evaluate(() => ({
  resumes: (window as typeof window & { __audioResumeCount: number }).__audioResumeCount,
  starts: (window as typeof window & { __audioStartCount: number }).__audioStartCount,
}));
assert.ok(audioActivation.starts >= 3, JSON.stringify(audioActivation));

const clue = await page.locator(".order-bubble p").innerText();
const target = VOCABULARY.find((word) => [...word.descriptions.zh, ...word.descriptions.de].includes(clue));
assert.ok(target, `No word matched the rendered clue: ${clue}`);
const correctLabel = target.article ? `${target.article} ${target.word}` : target.word;
const cards = page.locator(".word-card");
const count = await cards.count();
let wrongIndex = -1;
let correctIndex = -1;
for (let index = 0; index < count; index += 1) {
  const label = await cards.nth(index).getAttribute("aria-label");
  if (label?.startsWith(`${correctLabel}。`) || label?.startsWith(`${correctLabel}，`)) correctIndex = index;
  else if (wrongIndex < 0) wrongIndex = index;
}
assert.ok(wrongIndex >= 0);
assert.ok(correctIndex >= 0);
assert.ok(!(await cards.nth(correctIndex).getAttribute("aria-label"))?.includes(target.meaning));
assert.match(await cards.nth(correctIndex).innerText(), new RegExp(`复数 · ${target.plural}`));
await cards.nth(correctIndex).click();
assert.ok((await cards.nth(correctIndex).getAttribute("class"))?.includes("is-flipped"));
assert.ok((await cards.nth(correctIndex).getAttribute("aria-label"))?.includes(target.meaning));
await cards.nth(correctIndex).click();
assert.ok(!(await cards.nth(correctIndex).getAttribute("class"))?.includes("is-flipped"));

const wrongBox = await cards.nth(wrongIndex).boundingBox();
assert.ok(wrongBox);
await page.mouse.move(wrongBox.x + wrongBox.width / 2, wrongBox.y + wrongBox.height / 2);
await page.mouse.down();
await page.mouse.move(wrongBox.x + wrongBox.width / 2, wrongBox.y - 55, { steps: 5 });
await page.mouse.up();
await page.waitForSelector(".phase-wrong");
await page.waitForSelector(".phase-waiting");
assert.match(await page.locator(".order-bubble small").innerText(), /词性|答案含义/);
assert.ok(!(await cards.nth(wrongIndex).getAttribute("class"))?.includes("is-flipped"));

await cards.nth(correctIndex).focus();
await cards.nth(correctIndex).press("ArrowUp");
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
  const nextCard = page.getByRole("button", { name: new RegExp(`^${nextLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[。，]`) });
  await nextCard.focus();
  await nextCard.press("ArrowUp");
  await page.waitForSelector(".phase-paying");
  if (customerNumber < 5) await page.waitForSelector(".phase-waiting");
}
await page.waitForSelector(".ledger-paper");
assert.equal((await page.locator(".ledger-stats strong").first().innerText()).trim(), "5");
await page.getByRole("button", { name: "图鉴", exact: true }).click();
await page.locator('.filters input').fill("Büro");
assert.match(await page.locator(".lexicon-card").innerText(), /das Büro[\s\S]*办公室/);
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
await instrumentAudio(page);
await page.getByRole("button", { name: "装修" }).click();
assert.equal(await page.locator(".decor-list article").filter({ hasText: "编织地毯" }).getByRole("button").innerText(), "展示中");

await page.screenshot({ path: "test-results/desktop.png", fullPage: true });

await page.getByRole("button", { name: "设置" }).click();
const audioStartsBeforePreview = await page.evaluate(() => (window as typeof window & { __audioStartCount: number }).__audioStartCount);
await page.getByRole("button", { name: "试听" }).click();
await page.waitForFunction((previous: number) => (window as typeof window & { __audioStartCount: number }).__audioStartCount > previous, audioStartsBeforePreview);
await page.getByRole("radio", { name: /问答模式/ }).click();
assert.equal(await page.evaluate(() => localStorage.getItem("wortladen-learning-mode")), "quiz");
await page.reload({ waitUntil: "networkidle" });
await page.getByRole("button", { name: "设置" }).click();
assert.equal(await page.getByRole("radio", { name: /问答模式/ }).getAttribute("aria-checked"), "true");
await page.getByRole("button", { name: "营业", exact: true }).click();
await page.getByRole("button", { name: /开始营业/ }).click();
await page.waitForSelector(".phase-waiting");
assert.equal(await page.locator(".word-card").count(), 0);
assert.match(await page.locator(".order-bubble .bubble-meta").innerText(), /中文释义[\s\S]*A1/);

const revealButton = page.getByRole("button", { name: "查看答案" });
const deliverButton = page.getByRole("button", { name: "交付订单" });
await revealButton.click();
const revealed = await page.locator(".quiz-feedback").innerText();
const revealedMatch = revealed.match(/正确答案：(.+?)(?:；复数：(.+?))?。/);
assert.ok(revealedMatch);
const quizCorrectAnswer = revealedMatch[1];
const quizCorrectPlural = revealedMatch[2];
assert.ok(quizCorrectPlural);
assert.equal(await deliverButton.isDisabled(), true);

const quizInput = page.locator(".quiz-word-input");
const quizPluralInput = page.getByLabel("德语复数");
const balanceBeforeWrongAnswer = Number(await page.locator(".coin-purse strong").innerText());
const progressBeforeWrongAnswer = (await page.locator(".day-progress strong").innerText()).trim();
await quizInput.fill("definitelywrong");
await quizPluralInput.fill("definitelywrong");
await page.getByRole("button", { name: "提交答案" }).click();
assert.match(await page.locator(".quiz-feedback").innerText(), /还不对/);
assert.equal(await deliverButton.isDisabled(), true);
await page.waitForTimeout(1800);
assert.equal(Number(await page.locator(".coin-purse strong").innerText()), balanceBeforeWrongAnswer);
assert.equal((await page.locator(".day-progress strong").innerText()).trim(), progressBeforeWrongAnswer);
await page.getByRole("button", { name: "提交答案" }).click();
assert.match(await page.locator(".quiz-feedback").innerText(), /已经试过/);
await quizInput.fill(`  ${quizCorrectAnswer.toLocaleUpperCase("de-DE")}  `);
await quizPluralInput.fill("wrongplural");
await quizPluralInput.press("Enter");
assert.match(await page.locator(".quiz-feedback").innerText(), /单数正确，复数还不对/);
assert.equal(await deliverButton.isDisabled(), true);
await quizPluralInput.fill(`  ${quizCorrectPlural.toLocaleUpperCase("de-DE")}  `);
await quizPluralInput.press("Enter");
assert.match(await page.locator(".quiz-feedback").innerText(), /单数和复数都正确/);
assert.equal(await deliverButton.isEnabled(), true);
const balanceBeforeQuizDelivery = Number(await page.locator(".coin-purse strong").innerText());
await deliverButton.click();
await page.waitForSelector(".phase-paying");
await page.waitForFunction((balance: number) => Number(document.querySelector(".coin-purse strong")?.textContent) === balance + 12, balanceBeforeQuizDelivery);
await page.waitForSelector(".phase-waiting");
assert.equal((await page.locator(".day-progress strong").innerText()).trim(), "2 / 5");

await page.locator(".quiz-word-input").fill("temporary");
await page.getByRole("button", { name: "查看答案" }).click();
await page.getByRole("button", { name: "设置" }).click();
await page.getByRole("radio", { name: /翻卡模式/ }).click();
await page.getByRole("button", { name: "营业", exact: true }).click();
assert.equal(await page.locator(".word-card").count(), 5);
assert.equal(await page.locator(".word-card.is-flipped").count(), 0);
await page.getByRole("button", { name: "设置" }).click();
await page.getByRole("radio", { name: /问答模式/ }).click();
await page.getByRole("button", { name: "营业", exact: true }).click();
assert.equal(await page.locator(".quiz-word-input").inputValue(), "");
assert.equal((await page.locator(".day-progress strong").innerText()).trim(), "2 / 5");
await page.screenshot({ path: "test-results/quiz-desktop.png", fullPage: true });

const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
const mobile = await mobileContext.newPage();
await mobile.addInitScript(() => { Math.random = () => 0; });
mobile.on("console", (message: { type(): string; text(): string }) => { if (message.type() === "error") errors.push(message.text()); });
mobile.on("pageerror", (error: Error) => errors.push(error.message));
await mobile.goto("http://127.0.0.1:4173/", { waitUntil: "networkidle" });
await mobile.getByRole("button", { name: "营业", exact: true }).click();
await mobile.getByRole("button", { name: /开始营业/ }).click();
await mobile.waitForSelector(".phase-waiting");
const widths = await mobile.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
assert.equal(widths.scroll, widths.client);
assert.ok(await mobile.locator(".money-bag-on-counter").isVisible());
const cardBoxes: Array<{ left: number; right: number; width: number }> = await mobile.locator(".word-card").evaluateAll((cards: Element[]) => cards.map((card: Element) => {
  const box = card.getBoundingClientRect();
  return { left: box.left, right: box.right, width: box.width };
}));
assert.equal(cardBoxes.length, 5);
assert.ok(cardBoxes.every((box) => box.left >= 0 && box.right <= 390));
assert.ok(cardBoxes.every((box) => box.width >= 60));
await mobile.locator(".word-card").first().click();
assert.ok((await mobile.locator(".word-card").first().getAttribute("class"))?.includes("is-flipped"));
await mobile.getByRole("button", { name: "设置" }).click();
await mobile.getByRole("radio", { name: /问答模式/ }).click();
await mobile.getByRole("button", { name: "营业", exact: true }).click();
const mobileQuizInput = mobile.locator(".quiz-word-input");
const mobileQuizPluralInput = mobile.getByLabel("德语复数");
await mobileQuizInput.focus();
const quizControlBoxes: Array<{ left: number; right: number }> = await mobile.locator(".quiz-input-row input, .quiz-input-row button").evaluateAll((elements: Element[]) => elements.map((element: Element) => {
  const box = element.getBoundingClientRect();
  return { left: box.left, right: box.right };
}));
assert.ok(quizControlBoxes.every((box) => box.left >= 0 && box.right <= 390));
assert.equal(await mobileQuizInput.evaluate((input: Element) => getComputedStyle(input).fontSize), "16px");
assert.equal(await mobileQuizPluralInput.evaluate((input: Element) => getComputedStyle(input).fontSize), "16px");
await mobile.screenshot({ path: "test-results/mobile.png", fullPage: true });
await mobileContext.close();

assert.deepEqual(errors, []);
console.log(JSON.stringify({
  flipMode: { clue, correct: correctLabel, frontHidesChinese: true, flipsBothWays: true, dragDelivers: true },
  quizMode: { revealDoesNotDeliver: true, retryWorks: true, enterSubmits: true, duplicateRewardBlocked: true, persistedAfterReload: true },
  persistence: { decoration: "rug", survivedReload: true },
  mobile: { viewport: "390x844", horizontalOverflow: false, fiveCardsVisible: true, quizControlsVisible: true, inputFontSize: "16px" },
}, null, 2));

await browser.close();

