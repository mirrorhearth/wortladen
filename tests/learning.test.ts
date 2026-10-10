import assert from "node:assert/strict";
import test from "node:test";
import { VOCABULARY } from "../data/vocabulary.ts";
import { isGermanAnswerCorrect, makeCandidates, normalizeGermanAnswer, scheduleReview, selectLearningWord } from "../lib/learning.ts";
import { DEFAULT_SAVE } from "../lib/storage.ts";

test("the MVP ships exactly 50 checked starter words", () => {
  assert.equal(VOCABULARY.length, 50);
  for (const word of VOCABULARY) {
    assert.ok(word.descriptions.zh.length >= 2);
    assert.ok(word.descriptions.de.length >= 2);
    assert.ok(!word.descriptions.zh.some((description) => description.toLowerCase().includes(word.word.toLowerCase())));
    assert.ok(!word.descriptions.de.some((description) => description.toLowerCase().includes(word.word.toLowerCase())));
  }
});

test("candidate generation keeps one unique correct answer", () => {
  const target = VOCABULARY.find((word) => word.id === "besuchen")!;
  const hand = makeCandidates(target, VOCABULARY, 6);
  assert.equal(hand.length, 6);
  assert.equal(hand.filter((word) => word.id === target.id).length, 1);
  assert.equal(new Set(hand.map((word) => word.id)).size, 6);
});

test("wrong answers return soon and correct answers extend review", () => {
  const now = new Date("2026-10-09T00:00:00.000Z");
  const wrong = scheduleReview(undefined, "buch", false, now);
  const firstCorrect = scheduleReview(wrong, "buch", true, now);
  const secondCorrect = scheduleReview(firstCorrect, "buch", true, now);
  assert.equal(wrong.intervalDays, 0);
  assert.equal(firstCorrect.intervalDays, 1);
  assert.equal(secondCorrect.intervalDays, 3);
  assert.ok(secondCorrect.mastery > wrong.mastery);
});

test("a non-food imported word enters the generic order and card pipeline", () => {
  const custom = {
    ...VOCABULARY.find((word) => word.id === "lernen")!,
    id: "tanzen",
    word: "tanzen",
    meaning: "跳舞",
    theme: "活动",
    descriptions: { zh: ["跟随音乐有节奏地移动身体。"], de: ["Man bewegt den Körper im Rhythmus der Musik."] },
  };
  assert.equal(selectLearningWord([custom], { ...DEFAULT_SAVE, customWords: [custom] }).id, "tanzen");
  assert.equal(makeCandidates(custom, [custom, ...VOCABULARY], 5).filter((word) => word.id === "tanzen").length, 1);
});

test("quiz answers ignore surrounding spaces and case but keep German letters strict", () => {
  const punctual = VOCABULARY.find((word) => word.id === "puenktlich")!;
  const street = VOCABULARY.find((word) => word.id === "strasse")!;
  assert.equal(normalizeGermanAnswer("  PÜNKTLICH  "), "pünktlich");
  assert.equal(isGermanAnswerCorrect(punctual, "  PÜNKTLICH  "), true);
  assert.equal(isGermanAnswerCorrect(punctual, "puenktlich"), false);
  assert.equal(isGermanAnswerCorrect(street, "Straße"), true);
  assert.equal(isGermanAnswerCorrect(street, "Strasse"), false);
});

test("quiz accepts the target word and an explicit noun article without changing vocabulary", () => {
  const book = VOCABULARY.find((word) => word.id === "buch")!;
  assert.equal(isGermanAnswerCorrect(book, "Buch"), true);
  assert.equal(isGermanAnswerCorrect(book, "das Buch"), true);
  assert.equal(isGermanAnswerCorrect(book, "der Buch"), false);
});

