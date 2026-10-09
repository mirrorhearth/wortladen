export type PartOfSpeech = "noun" | "verb" | "adjective" | "adverb" | "other";

export type WordEntry = {
  id: string;
  word: string;
  meaning: string;
  partOfSpeech: PartOfSpeech;
  article?: "der" | "die" | "das";
  plural?: string;
  conjugation?: string;
  example: string;
  exampleZh: string;
  theme: string;
  cefr: "A1";
  difficulty: 1 | 2 | 3;
  descriptions: { zh: string[]; de: string[] };
};

export type LearningRecord = {
  wordId: string;
  mastery: number;
  intervalDays: number;
  ease: number;
  dueAt: string;
  correct: number;
  wrong: number;
  lastSeenAt: string | null;
};

export type Settings = {
  sound: boolean;
  reducedMotion: boolean;
  dailyNewWords: number;
  chineseRatio: number;
};

export type DayRecord = {
  date: string;
  customers: number;
  correct: number;
  errors: number;
  income: number;
  weakWords: string[];
};

export type SaveData = {
  version: 1;
  coins: number;
  shopLevel: number;
  ownedDecorations: string[];
  activeDecorations: string[];
  unlockedWordIds: string[];
  customWords: WordEntry[];
  learning: Record<string, LearningRecord>;
  history: DayRecord[];
  settings: Settings;
};

export type Customer = {
  id: "student" | "clerk" | "teacher" | "resident";
  name: string;
  style: string;
  spriteIndex: number;
};
