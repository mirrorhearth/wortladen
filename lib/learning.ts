import type { LearningRecord, SaveData, WordEntry } from "./game-types";

const DAY = 86_400_000;

export function createLearningRecord(wordId: string): LearningRecord {
  return {
    wordId,
    mastery: 0,
    intervalDays: 0,
    ease: 2.3,
    dueAt: new Date().toISOString(),
    correct: 0,
    wrong: 0,
    lastSeenAt: null,
  };
}

export function scheduleReview(
  current: LearningRecord | undefined,
  wordId: string,
  correct: boolean,
  now = new Date(),
): LearningRecord {
  const record = current ?? createLearningRecord(wordId);
  const nextCorrect = record.correct + (correct ? 1 : 0);
  const nextWrong = record.wrong + (correct ? 0 : 1);
  const previousInterval = record.intervalDays;
  const intervalDays = correct
    ? previousInterval === 0
      ? 1
      : previousInterval === 1
        ? 3
        : Math.min(60, Math.round(previousInterval * record.ease))
    : 0;
  const dueOffset = correct ? intervalDays * DAY : 10 * 60_000;
  const attempts = nextCorrect + nextWrong;
  const accuracy = attempts ? nextCorrect / attempts : 0;

  return {
    ...record,
    correct: nextCorrect,
    wrong: nextWrong,
    mastery: Math.max(0, Math.min(100, Math.round(accuracy * 70 + Math.min(intervalDays, 30)))),
    intervalDays,
    ease: Math.max(1.3, Math.min(2.7, record.ease + (correct ? 0.08 : -0.2))),
    dueAt: new Date(now.getTime() + dueOffset).toISOString(),
    lastSeenAt: now.toISOString(),
  };
}

export function selectLearningWord(words: WordEntry[], save: SaveData, now = new Date()): WordEntry {
  const due = words.filter((word) => {
    const record = save.learning[word.id];
    return record && new Date(record.dueAt) <= now;
  });
  if (due.length) {
    return due.sort((a, b) => (save.learning[a.id]?.mastery ?? 0) - (save.learning[b.id]?.mastery ?? 0))[0];
  }
  const unseen = words.filter((word) => !save.learning[word.id]?.lastSeenAt);
  if (unseen.length) return unseen[Math.floor(Math.random() * unseen.length)];
  return [...words].sort(
    (a, b) => new Date(save.learning[a.id].dueAt).getTime() - new Date(save.learning[b.id].dueAt).getTime(),
  )[0];
}

export function makeCandidates(target: WordEntry, words: WordEntry[], count = 5): WordEntry[] {
  const sameType = words.filter((word) => word.id !== target.id && word.partOfSpeech === target.partOfSpeech);
  const sameTheme = words.filter(
    (word) => word.id !== target.id && word.theme === target.theme && !sameType.some((item) => item.id === word.id),
  );
  const others = words.filter(
    (word) => word.id !== target.id && !sameType.some((item) => item.id === word.id) && !sameTheme.some((item) => item.id === word.id),
  );
  const shuffle = <T,>(items: T[]) => [...items].sort(() => Math.random() - 0.5);
  const distractors = [...shuffle(sameType), ...shuffle(sameTheme), ...shuffle(others)].slice(0, count - 1);
  return shuffle([target, ...distractors]);
}

export function chooseDescription(word: WordEntry, chineseRatio: number, mastery: number) {
  const adjustedRatio = Math.max(0.15, Math.min(0.95, chineseRatio - mastery / 250));
  const lang = Math.random() < adjustedRatio ? "zh" : "de";
  const choices = word.descriptions[lang];
  return { lang, text: choices[Math.floor(Math.random() * choices.length)] };
}

