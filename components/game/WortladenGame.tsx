"use client";

import {
  BookOpen,
  ChartNoAxesColumnIncreasing,
  Check,
  ChevronLeft,
  CircleHelp,
  Clock3,
  Coins,
  Eye,
  Footprints,
  House,
  Import,
  Keyboard,
  Landmark,
  MessageCircleMore,
  PackageOpen,
  Play,
  RotateCcw,
  Search,
  Send,
  Settings,
  Shuffle,
  Sparkles,
  Store,
  Upload,
  Volume2,
  WalletCards,
  WandSparkles,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { VOCABULARY, WORD_BY_ID } from "@/data/vocabulary";
import { playTone, speakGerman, unlockAudio } from "@/lib/audio";
import type { Customer, DayRecord, LearningMode, SaveData, WordEntry } from "@/lib/game-types";
import { chooseDescription, hasLearnablePlural, isGermanAnswerCorrect, isGermanPluralCorrect, makeCandidates, normalizeGermanAnswer, scheduleReview, selectLearningWord } from "@/lib/learning";
import { DEFAULT_SAVE, exportSave, loadLearningMode, loadSave, readSaveFile, saveGame, saveLearningMode } from "@/lib/storage";

type View = "shop" | "lexicon" | "decorate" | "stats" | "settings" | "ledger";
type Phase = "closed" | "entering" | "waiting" | "wrong" | "success" | "paying" | "leaving" | "finished";
type QuizStatus = "idle" | "wrong" | "correct" | "revealed";
type ModelContextLike = { registerTool: (tool: Record<string, unknown>, options?: { signal?: AbortSignal }) => void | Promise<void> };

const CUSTOMERS: Customer[] = [
  { id: "student", name: "Lukas", style: "直白的学生", spriteIndex: 0 },
  { id: "clerk", name: "Mira", style: "细心的店员", spriteIndex: 1 },
  { id: "teacher", name: "Herr Klein", style: "爱下定义的老师", spriteIndex: 2 },
  { id: "resident", name: "Frau Sommer", style: "亲切的居民", spriteIndex: 3 },
];

const DECORATIONS = [
  { id: "wallpaper", name: "星夜壁纸", price: 28, note: "墙面染上深蓝夜色" },
  { id: "rug", name: "编织地毯", price: 22, note: "柜台前出现绯红纹样" },
  { id: "lamp", name: "黄铜灯光", price: 32, note: "店内增加柔和暖光" },
  { id: "curtain", name: "酒红窗帘", price: 26, note: "门窗两侧垂下帷幔" },
  { id: "counter", name: "月纹柜台布", price: 35, note: "柜台正面换上月纹装饰" },
];

const PART_LABEL: Record<WordEntry["partOfSpeech"], string> = {
  noun: "名词", verb: "动词", adjective: "形容词", adverb: "副词", other: "其他",
};

const ASSET_BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

function wordLabel(word: WordEntry) {
  return word.article ? `${word.article} ${word.word}` : word.word;
}

function WordGlyph({ word }: { word: WordEntry }) {
  const props = { size: 24, strokeWidth: 1.7, "aria-hidden": true };
  if (word.partOfSpeech === "noun") return <PackageOpen {...props} />;
  if (word.partOfSpeech === "verb") return <Footprints {...props} />;
  if (word.partOfSpeech === "adjective") return <Sparkles {...props} />;
  if (word.partOfSpeech === "adverb") return <Clock3 {...props} />;
  return <MessageCircleMore {...props} />;
}

function parseVocabularyFile(text: string, filename: string): WordEntry[] {
  if (filename.toLowerCase().endsWith(".json")) {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error("JSON 必须是词汇数组。");
    return parsed.map(validateImportedWord);
  }
  const rows = text.trim().split(/\r?\n/).map((row) => row.split(",").map((cell) => cell.trim()));
  const headers = rows.shift();
  if (!headers) throw new Error("CSV 为空。");
  return rows.map((row) => {
    const values = Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]));
    return validateImportedWord({
      id: values.id || values.word?.toLowerCase().replace(/[^a-zäöüß]+/gi, "-"),
      word: values.word,
      meaning: values.meaning,
      partOfSpeech: values.partOfSpeech,
      article: values.article || undefined,
      plural: values.plural || undefined,
      conjugation: values.conjugation || undefined,
      example: values.example,
      exampleZh: values.exampleZh,
      theme: values.theme || "自定义",
      cefr: "A1",
      difficulty: Number(values.difficulty || 1),
      descriptions: { zh: [values.zh1, values.zh2].filter(Boolean), de: [values.de1, values.de2].filter(Boolean) },
    });
  });
}

function validateImportedWord(value: unknown): WordEntry {
  if (!value || typeof value !== "object") throw new Error("词汇条目格式错误。");
  const word = value as Partial<WordEntry>;
  if (!word.id || !word.word || !word.meaning || !word.partOfSpeech || !word.example || !word.descriptions) {
    throw new Error("词汇缺少 id、word、meaning、partOfSpeech、example 或 descriptions。");
  }
  if (!["noun", "verb", "adjective", "adverb", "other"].includes(word.partOfSpeech)) throw new Error("词性无效。");
  if (!word.descriptions.zh?.length || !word.descriptions.de?.length) throw new Error("每个词至少需要中德文描述各一条。");
  return {
    id: word.id,
    word: word.word,
    meaning: word.meaning,
    partOfSpeech: word.partOfSpeech,
    article: word.article,
    plural: word.plural,
    conjugation: word.conjugation,
    example: word.example,
    exampleZh: word.exampleZh ?? "",
    theme: word.theme ?? "自定义",
    cefr: "A1",
    difficulty: word.difficulty === 2 || word.difficulty === 3 ? word.difficulty : 1,
    descriptions: word.descriptions,
  };
}

export function WortladenGame() {
  const [save, setSave] = useState<SaveData>(structuredClone(DEFAULT_SAVE));
  const [learningMode, setLearningMode] = useState<LearningMode>("flip");
  const [ready, setReady] = useState(false);
  const [storageMessage, setStorageMessage] = useState("");
  const [view, setView] = useState<View>("shop");
  const [phase, setPhase] = useState<Phase>("closed");
  const [customerIndex, setCustomerIndex] = useState(0);
  const [target, setTarget] = useState<WordEntry>(VOCABULARY[0]);
  const [candidates, setCandidates] = useState<WordEntry[]>([]);
  const [description, setDescription] = useState({ lang: "zh", text: "准备好后，打开店门迎接第一位顾客。" });
  const [playedId, setPlayedId] = useState<string | null>(null);
  const [hintLevel, setHintLevel] = useState(0);
  const [day, setDay] = useState({ correct: 0, errors: 0, income: 0, weakWords: [] as string[] });
  const [showCoins, setShowCoins] = useState(false);
  const [bagPulse, setBagPulse] = useState(false);
  const [search, setSearch] = useState("");
  const [partFilter, setPartFilter] = useState("all");
  const [sort, setSort] = useState<"word" | "mastery">("word");
  const [flippedIds, setFlippedIds] = useState<Set<string>>(() => new Set());
  const [quizAnswer, setQuizAnswer] = useState("");
  const [quizPluralAnswer, setQuizPluralAnswer] = useState("");
  const [quizStatus, setQuizStatus] = useState<QuizStatus>("idle");
  const [quizMessage, setQuizMessage] = useState("");
  const pointerStart = useRef<{ id: string; x: number; y: number } | null>(null);
  const suppressFlip = useRef<{ id: string; until: number } | null>(null);
  const attemptedAnswers = useRef<Set<string>>(new Set());
  const orderSerial = useRef(0);
  const quizAcceptedOrder = useRef<number | null>(null);
  const deliveryLock = useRef(false);
  const importRef = useRef<HTMLInputElement>(null);
  const pluralInputRef = useRef<HTMLInputElement>(null);

  const words = useMemo(() => [...VOCABULARY, ...save.customWords], [save.customWords]);
  const customer = CUSTOMERS[customerIndex % CUSTOMERS.length];
  const reducedMotion = save.settings.reducedMotion;
  const targetNeedsPlural = hasLearnablePlural(target);

  useEffect(() => {
    setLearningMode(loadLearningMode());
    loadSave()
      .then((loaded) => setSave(loaded))
      .catch(() => setStorageMessage("暂时无法读取本地存档，本次进度可能不会保留。"))
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    if (!ready) return;
    void saveGame(save).catch(() => setStorageMessage("自动存档失败，请导出备份。"));
  }, [save, ready]);

  useEffect(() => {
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("./sw.js").catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!ready || !save.settings.sound) return;
    const resumeAudio = () => { void unlockAudio(); };
    document.addEventListener("pointerdown", resumeAudio, { capture: true, passive: true });
    document.addEventListener("touchend", resumeAudio, { capture: true, passive: true });
    document.addEventListener("keydown", resumeAudio, { capture: true });
    return () => {
      document.removeEventListener("pointerdown", resumeAudio, { capture: true });
      document.removeEventListener("touchend", resumeAudio, { capture: true });
      document.removeEventListener("keydown", resumeAudio, { capture: true });
    };
  }, [ready, save.settings.sound]);

  const resetStudyInteraction = useCallback(() => {
    setFlippedIds(new Set());
    setQuizAnswer("");
    setQuizPluralAnswer("");
    setQuizStatus("idle");
    setQuizMessage("");
    attemptedAnswers.current.clear();
    quizAcceptedOrder.current = null;
    pointerStart.current = null;
    suppressFlip.current = null;
  }, []);

  const prepareOrder = useCallback((data: SaveData, nextCustomer: number) => {
    orderSerial.current += 1;
    const nextTarget = selectLearningWord([...VOCABULARY, ...data.customWords], data);
    const mastery = data.learning[nextTarget.id]?.mastery ?? 0;
    setTarget(nextTarget);
    setCandidates(makeCandidates(nextTarget, [...VOCABULARY, ...data.customWords], mastery > 65 ? 6 : 5));
    setDescription(chooseDescription(nextTarget, data.settings.chineseRatio, mastery));
    setCustomerIndex(nextCustomer);
    setHintLevel(0);
    setPlayedId(null);
    deliveryLock.current = false;
    resetStudyInteraction();
  }, [resetStudyInteraction]);

  const startDay = useCallback(() => {
    setDay({ correct: 0, errors: 0, income: 0, weakWords: [] });
    prepareOrder(save, 0);
    setView("shop");
    setPhase("entering");
    playTone("bell", save.settings.sound);
    window.setTimeout(() => setPhase("waiting"), reducedMotion ? 120 : 850);
  }, [prepareOrder, reducedMotion, save]);

  useEffect(() => {
    const context = (document as Document & { modelContext?: ModelContextLike }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    void Promise.resolve(context.registerTool({
      name: "get_learning_summary",
      title: "查看学习概况",
      description: "读取当前金币、营业天数、已学习词汇数和待复习词汇数，不修改游戏。",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute: () => ({
        coins: save.coins,
        businessDays: save.history.length,
        learnedWords: Object.keys(save.learning).length,
        dueWords: Object.values(save.learning).filter((item) => new Date(item.dueAt) <= new Date()).length,
      }),
    }, { signal: lifecycle.signal })).catch(() => undefined);
    void Promise.resolve(context.registerTool({
      name: "start_business_day",
      title: "开始营业",
      description: "打开店门并开始一个包含五位顾客的新营业日。",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: () => {
        startDay();
        return { status: "started", customersPlanned: 5 };
      },
    }, { signal: lifecycle.signal })).catch(() => undefined);
    return () => lifecycle.abort();
  }, [save, startDay]);

  const changeLearningMode = (mode: LearningMode) => {
    if (mode === learningMode) return;
    setLearningMode(mode);
    saveLearningMode(mode);
    resetStudyInteraction();
  };

  const previewSound = () => {
    if (!save.settings.sound) {
      setSave((current) => ({ ...current, settings: { ...current.settings, sound: true } }));
    }
    void unlockAudio().then((unlocked) => {
      if (unlocked) playTone("bell", true);
      else setStorageMessage("浏览器暂时未能播放声音，请关闭手机静音模式后再点一次试听。");
    });
  };

  const toggleCard = (wordId: string) => {
    if (phase !== "waiting" || learningMode !== "flip") return;
    const suppressed = suppressFlip.current;
    if (suppressed?.id === wordId && Date.now() < suppressed.until) return;
    setFlippedIds((current) => {
      const next = new Set(current);
      if (next.has(wordId)) next.delete(wordId);
      else next.add(wordId);
      return next;
    });
    playTone("card", save.settings.sound);
  };

  const submitQuizAnswer = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (phase !== "waiting" || learningMode !== "quiz" || quizStatus === "correct") return;
    quizAcceptedOrder.current = null;
    const normalized = normalizeGermanAnswer(quizAnswer);
    const normalizedPlural = normalizeGermanAnswer(quizPluralAnswer);
    if (!normalized) {
      setQuizStatus("wrong");
      setQuizMessage("请先输入一个德语单词。");
      return;
    }
    if (targetNeedsPlural && !normalizedPlural) {
      setQuizStatus("wrong");
      setQuizMessage("还需要填写这个名词的复数形式。");
      return;
    }
    const singularCorrect = isGermanAnswerCorrect(target, quizAnswer);
    const pluralCorrect = isGermanPluralCorrect(target, quizPluralAnswer);
    if (singularCorrect && pluralCorrect) {
      quizAcceptedOrder.current = orderSerial.current;
      setQuizStatus("correct");
      setQuizMessage(targetNeedsPlural ? "单数和复数都正确！现在可以交付订单。" : "回答正确！现在可以把订单交给顾客。");
      playTone("card", save.settings.sound);
      return;
    }

    const attemptKey = `${normalized}|${normalizedPlural}`;
    const repeated = attemptedAnswers.current.has(attemptKey);
    attemptedAnswers.current.add(attemptKey);
    setQuizStatus("wrong");
    setQuizMessage(repeated
      ? "这组答案已经试过了，请修改后再提交。"
      : singularCorrect && !pluralCorrect
        ? "单数正确，复数还不对，再想一想。"
        : "德语单词还不对，再想一想。可以修改后重新提交。");
    playTone("wrong", save.settings.sound);
    if (repeated) return;
    setDay((current) => ({
      ...current,
      errors: current.errors + 1,
      weakWords: current.weakWords.includes(target.id) ? current.weakWords : [...current.weakWords, target.id],
    }));
    setSave((current) => ({
      ...current,
      unlockedWordIds: Array.from(new Set([...current.unlockedWordIds, target.id])),
      learning: { ...current.learning, [target.id]: scheduleReview(current.learning[target.id], target.id, false) },
    }));
  };

  const revealQuizAnswer = () => {
    if (phase !== "waiting" || quizStatus === "correct") return;
    quizAcceptedOrder.current = null;
    setQuizStatus("revealed");
    setQuizMessage(`正确答案：${wordLabel(target)}${targetNeedsPlural ? `；复数：${target.plural}` : ""}。查看答案不会自动完成订单。`);
  };

  const nextCustomer = (nextSave: SaveData) => {
    const served = customerIndex + 1;
    if (served >= 5) {
      const record: DayRecord = {
        date: new Date().toISOString(), customers: 5, correct: day.correct + 1,
        errors: day.errors, income: day.income + 12, weakWords: day.weakWords,
      };
      setSave((current) => ({ ...current, history: [...current.history, record].slice(-90) }));
      setPhase("finished");
      setView("ledger");
      return;
    }
    prepareOrder(nextSave, served);
    setPhase("entering");
    playTone("bell", nextSave.settings.sound);
    window.setTimeout(() => setPhase("waiting"), reducedMotion ? 120 : 850);
  };

  const playCard = (word: WordEntry) => {
    if (phase !== "waiting" || deliveryLock.current) return;
    if (
      learningMode === "quiz" &&
      (quizStatus !== "correct" || quizAcceptedOrder.current !== orderSerial.current || word.id !== target.id)
    ) return;
    deliveryLock.current = true;
    setPlayedId(word.id);
    playTone("card", save.settings.sound);
    if (word.id !== target.id) {
      setPhase("wrong");
      playTone("wrong", save.settings.sound);
      setHintLevel((value) => value + 1);
      setDay((current) => ({
        ...current, errors: current.errors + 1,
        weakWords: current.weakWords.includes(target.id) ? current.weakWords : [...current.weakWords, target.id],
      }));
      setSave((current) => ({
        ...current,
        unlockedWordIds: Array.from(new Set([...current.unlockedWordIds, target.id, word.id])),
        learning: { ...current.learning, [target.id]: scheduleReview(current.learning[target.id], target.id, false) },
      }));
      window.setTimeout(() => {
        deliveryLock.current = false;
        setPlayedId(null);
        setPhase("waiting");
      }, reducedMotion ? 300 : 900);
      return;
    }

    setPhase("success");
    const nextLearning = scheduleReview(save.learning[target.id], target.id, true);
    const nextSave: SaveData = {
      ...save,
      unlockedWordIds: Array.from(new Set([...save.unlockedWordIds, target.id])),
      learning: { ...save.learning, [target.id]: nextLearning },
    };
    setSave(nextSave);
    setDay((current) => ({ ...current, correct: current.correct + 1, income: current.income + 12 }));
    window.setTimeout(() => {
      setShowCoins(true);
      setPhase("paying");
      [0, 1, 2].forEach((index) => window.setTimeout(() => playTone("coin", save.settings.sound), index * (reducedMotion ? 80 : 180)));
      window.setTimeout(() => {
        setShowCoins(false);
        setBagPulse(true);
        const paidSave = { ...nextSave, coins: nextSave.coins + 12 };
        setSave(paidSave);
        window.setTimeout(() => setBagPulse(false), 450);
        setPhase("leaving");
        window.setTimeout(() => nextCustomer(paidSave), reducedMotion ? 180 : 850);
      }, reducedMotion ? 350 : 1100);
    }, reducedMotion ? 180 : 700);
  };

  const toggleDecoration = (id: string) => {
    if (!save.ownedDecorations.includes(id)) return;
    setSave((current) => ({
      ...current,
      activeDecorations: current.activeDecorations.includes(id)
        ? current.activeDecorations.filter((item) => item !== id)
        : [...current.activeDecorations, id],
    }));
  };

  const buyDecoration = (id: string, price: number) => {
    if (save.coins < price || save.ownedDecorations.includes(id)) return;
    setSave((current) => ({
      ...current, coins: current.coins - price,
      ownedDecorations: [...current.ownedDecorations, id],
      activeDecorations: [...current.activeDecorations, id],
    }));
    playTone("upgrade", save.settings.sound);
  };

  const onImportSave = async (file?: File) => {
    if (!file) return;
    try { setSave(await readSaveFile(file)); setStorageMessage("存档已导入并保存。"); }
    catch (error) { setStorageMessage(error instanceof Error ? error.message : "导入失败。"); }
  };

  const onImportVocabulary = async (file?: File) => {
    if (!file) return;
    try {
      const imported = parseVocabularyFile(await file.text(), file.name);
      const existingIds = new Set(VOCABULARY.map((word) => word.id));
      setSave((current) => ({
        ...current,
        customWords: [...current.customWords.filter((word) => !imported.some((item) => item.id === word.id)), ...imported.filter((word) => !existingIds.has(word.id))],
        unlockedWordIds: Array.from(new Set([...current.unlockedWordIds, ...imported.map((word) => word.id)])),
      }));
      setStorageMessage(`已导入 ${imported.length} 个词汇。`);
    } catch (error) { setStorageMessage(error instanceof Error ? error.message : "词库导入失败。"); }
  };

  const filteredWords = useMemo(() => {
    const result = words.filter((word) =>
      (partFilter === "all" || word.partOfSpeech === partFilter) &&
      `${word.word} ${word.meaning} ${word.theme}`.toLowerCase().includes(search.toLowerCase()),
    );
    return result.sort((a, b) => sort === "word"
      ? a.word.localeCompare(b.word, "de")
      : (save.learning[b.id]?.mastery ?? 0) - (save.learning[a.id]?.mastery ?? 0));
  }, [words, partFilter, search, sort, save.learning]);

  if (!ready) return <main className="loading-screen"><WandSparkles /><p>正在点亮单词小店…</p></main>;

  return (
    <main className={`game-shell ${save.settings.reducedMotion ? "reduce-motion" : ""}`}>
      <header className="topbar">
        <button className="brand" onClick={() => setView("shop")} aria-label="返回单词小店">
          <span className="brand-mark"><BookOpen size={22} /></span>
          <span><strong>Wortladen</strong><small>单词小店</small></span>
        </button>
        <nav aria-label="主要功能">
          <button className={view === "shop" ? "active" : ""} onClick={() => setView("shop")}><Store />营业</button>
          <button className={view === "lexicon" ? "active" : ""} onClick={() => setView("lexicon")}><BookOpen />图鉴</button>
          <button className={view === "decorate" ? "active" : ""} onClick={() => setView("decorate")}><WandSparkles />装修</button>
          <button className={view === "stats" ? "active" : ""} onClick={() => setView("stats")}><ChartNoAxesColumnIncreasing />统计</button>
          <button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")}><Settings />设置</button>
        </nav>
        <button className={`coin-purse ${bagPulse ? "pulse" : ""}`} onClick={() => setView("ledger")} aria-label={`钱袋，当前 ${save.coins} 金币`}>
          <span className="purse-shape"><Coins size={22} /></span><strong>{save.coins}</strong><small>金币</small>
        </button>
      </header>

      {storageMessage && <button className="toast" onClick={() => setStorageMessage("")}><span>{storageMessage}</span><X size={16} /></button>}

      {view === "shop" && (
        <section className={`shop-view learning-${learningMode} decor-${save.activeDecorations.join(" decor-")}`} aria-label="店铺营业场景">
          <div className="shop-stage">
            <div className="shop-art" style={{ backgroundImage: `url(${ASSET_BASE}/assets/shop-interior.png)` }} aria-hidden="true" />
            <div className="ambient-light" aria-hidden="true" />
            <div className="curtain-layer" aria-hidden="true" />
            <div className="counter-cloth" aria-hidden="true" />
            <div className="counter-zone" aria-label="把卡牌拖到这里出牌">
              <span><Landmark size={18} /> 柜台</span>
            </div>

            {phase !== "closed" && phase !== "finished" && (
              <div className={`customer-wrap phase-${learningMode === "quiz" && phase === "waiting" && quizStatus === "wrong" ? "wrong" : learningMode === "quiz" && phase === "waiting" && quizStatus === "correct" ? "success" : phase}`}>
                <div className="order-bubble">
                  <div className="bubble-meta"><span>{learningMode === "quiz" ? "中文释义" : description.lang === "zh" ? "中文线索" : "Deutscher Hinweis"}</span><span>{learningMode === "quiz" ? `A1 · ${PART_LABEL[target.partOfSpeech]}` : customer.style}</span></div>
                  <p>{learningMode === "quiz" ? target.meaning : description.text}</p>
                  {learningMode === "quiz"
                    ? <small>请写出这个订单对应的德语单词。</small>
                    : hintLevel > 0 && <small>提示 {hintLevel >= 2 ? `答案含义：${target.meaning}` : `词性：${PART_LABEL[target.partOfSpeech]}`}</small>}
                </div>
                <div className="customer-name"><strong>{customer.name}</strong><span>{learningMode === "quiz" && quizStatus === "wrong" ? "再想想…" : learningMode === "quiz" && quizStatus === "revealed" ? "答案已揭晓" : learningMode === "quiz" && quizStatus === "correct" ? "Richtig! 等待交付" : phase === "wrong" ? "再想想…" : phase === "success" || phase === "paying" ? "Genau!" : "正在等候"}</span></div>
                <div className="customer-sprite" style={{ backgroundImage: `url(${ASSET_BASE}/assets/customer-sprites.png)`, backgroundPosition: `${customer.spriteIndex * 33.333}% center` }} role="img" aria-label={`${customer.name} 顾客`} />
              </div>
            )}

            <div className={`money-bag-on-counter ${bagPulse ? "pulse" : ""}`} aria-hidden="true">
              <div className="bag-knot" /><WalletCards size={26} /><strong>{save.coins}</strong>
            </div>
            {showCoins && [0, 1, 2].map((index) => <span key={index} className="flying-coin" style={{ "--coin-index": index } as React.CSSProperties}>€<small>4</small></span>)}

            {phase === "closed" && (
              <div className="opening-card">
                <span className="eyebrow">今日营业准备</span>
                <h1>把理解变成一场真正的交易</h1>
                <p>{learningMode === "flip" ? "查看德语卡面，需要时翻卡确认中文，再把正确词卡交给顾客。" : "根据顾客给出的中文释义，输入正确德语，再完成订单交付。"}今天将接待 5 位顾客。</p>
                <span className="current-mode">当前：{learningMode === "flip" ? "翻卡模式 · 德语 → 中文" : "问答模式 · 中文 → 德语"}</span>
                <div className="opening-stats"><span><strong>{Object.keys(save.learning).length}</strong> 已学习</span><span><strong>{save.history.length}</strong> 营业日</span><span><strong>{save.coins}</strong> 金币</span></div>
                <button className="primary-action" onClick={startDay}><Play size={18} fill="currentColor" />开始营业</button>
              </div>
            )}

            {phase !== "closed" && phase !== "finished" && (
              <div className="day-progress" aria-label={`今日进度 ${customerIndex + 1} / 5`}>
                <div><span>今日订单</span><strong>{customerIndex + 1} / 5</strong></div>
                <div className="progress-track"><span style={{ width: `${(customerIndex + (phase === "leaving" ? 1 : 0)) * 20}%` }} /></div>
                <button onClick={() => setCandidates((current) => [...current].sort(() => Math.random() - 0.5))} disabled={phase !== "waiting"}><Shuffle size={16} />整理手牌</button>
              </div>
            )}
          </div>

          {phase !== "closed" && phase !== "finished" && (
            <div className={`hand-area ${learningMode === "quiz" ? "quiz-hand" : ""}`}>
              {learningMode === "quiz" ? (
                <div className="quiz-panel">
                  <div className="quiz-heading"><span>主动回忆</span><strong>{targetNeedsPlural ? "写出名词和复数" : "写出对应的德语单词"}</strong><small>A1 · {PART_LABEL[target.partOfSpeech]}{targetNeedsPlural ? " · 复数训练" : ""}</small></div>
                  <form className="quiz-form" onSubmit={submitQuizAnswer}>
                    <div className={`quiz-input-row ${targetNeedsPlural ? "has-plural" : ""}`}>
                      <label className="quiz-answer-field" htmlFor="quiz-answer">
                        <span>{targetNeedsPlural ? "德语单数" : "德语答案"}</span>
                        <input
                          className="quiz-word-input"
                          id="quiz-answer"
                          value={quizAnswer}
                          onChange={(event) => {
                            setQuizAnswer(event.target.value);
                            if (quizStatus === "wrong" || quizStatus === "revealed") {
                              setQuizStatus("idle");
                              setQuizMessage("");
                            }
                          }}
                          onFocus={(event) => {
                            const input = event.currentTarget;
                            window.setTimeout(() => input.scrollIntoView({ block: "center", behavior: reducedMotion ? "auto" : "smooth" }), 180);
                          }}
                          onKeyDown={(event) => {
                            if (targetNeedsPlural && event.key === "Enter") {
                              event.preventDefault();
                              pluralInputRef.current?.focus();
                            }
                          }}
                          disabled={phase !== "waiting" || quizStatus === "correct"}
                          autoComplete="off"
                          autoCapitalize="none"
                          autoCorrect="off"
                          spellCheck={false}
                          enterKeyHint={targetNeedsPlural ? "next" : "done"}
                          inputMode="text"
                          placeholder={targetNeedsPlural ? "如：das Buch" : "输入德语单词"}
                        />
                      </label>
                      {targetNeedsPlural && (
                        <label className="quiz-answer-field" htmlFor="quiz-plural-answer">
                          <span>德语复数</span>
                          <input
                            ref={pluralInputRef}
                            className="quiz-plural-input"
                            id="quiz-plural-answer"
                            value={quizPluralAnswer}
                            onChange={(event) => {
                              setQuizPluralAnswer(event.target.value);
                              if (quizStatus === "wrong" || quizStatus === "revealed") {
                                setQuizStatus("idle");
                                setQuizMessage("");
                              }
                            }}
                            onFocus={(event) => {
                              const input = event.currentTarget;
                              window.setTimeout(() => input.scrollIntoView({ block: "center", behavior: reducedMotion ? "auto" : "smooth" }), 180);
                            }}
                            disabled={phase !== "waiting" || quizStatus === "correct"}
                            autoComplete="off"
                            autoCapitalize="none"
                            autoCorrect="off"
                            spellCheck={false}
                            enterKeyHint="done"
                            inputMode="text"
                            placeholder="如：Bücher"
                          />
                        </label>
                      )}
                      <button type="submit" className="quiz-submit" disabled={phase !== "waiting" || quizStatus === "correct" || !quizAnswer.trim() || (targetNeedsPlural && !quizPluralAnswer.trim())}><Send size={17} />提交答案</button>
                    </div>
                    <div className="quiz-actions">
                      <button type="button" onClick={revealQuizAnswer} disabled={phase !== "waiting" || quizStatus === "correct"}><Eye size={16} />查看答案</button>
                      <button type="button" className="quiz-deliver" onClick={() => playCard(target)} disabled={phase !== "waiting" || quizStatus !== "correct"}><Landmark size={16} />交付订单</button>
                    </div>
                    <p className={`quiz-feedback status-${quizStatus}`} aria-live="polite">{quizMessage || (targetNeedsPlural ? "单数可带冠词；复数需准确填写。ä、ö、ü、ß 不能替换。" : "忽略首尾空格和大小写；ä、ö、ü、ß 需要准确输入。")}</p>
                  </form>
                </div>
              ) : <>
                <div className="hand-label"><span>你的手牌</span><small>轻点翻卡 · 向上拖动交付</small></div>
                <div className="word-hand">
                {candidates.map((word, index) => {
                  const mastery = save.learning[word.id]?.mastery ?? 0;
                  const flipped = flippedIds.has(word.id);
                  const pluralHint = hasLearnablePlural(word) ? `，复数 ${word.plural}` : word.partOfSpeech === "noun" && word.plural === "—" ? "，通常无复数" : "";
                  return (
                    <button
                      key={word.id}
                      className={`word-card pos-${word.partOfSpeech} ${flipped ? "is-flipped" : ""} ${playedId === word.id ? (word.id === target.id ? "played-correct" : "played-wrong") : ""}`}
                      style={{ "--card-index": index, "--card-count": candidates.length } as React.CSSProperties}
                      onClick={() => toggleCard(word.id)}
                      onKeyDown={(event) => { if (event.key === "ArrowUp") { event.preventDefault(); playCard(word); } }}
                      onPointerDown={(event) => {
                        pointerStart.current = { id: word.id, x: event.clientX, y: event.clientY };
                        event.currentTarget.setPointerCapture(event.pointerId);
                      }}
                      onPointerUp={(event) => {
                        const start = pointerStart.current;
                        const rise = start ? start.y - event.clientY : 0;
                        const sideways = start ? Math.abs(start.x - event.clientX) : 0;
                        if (start?.id === word.id && rise > 34 && rise > sideways) {
                          suppressFlip.current = { id: word.id, until: Date.now() + 500 };
                          playCard(word);
                        }
                        pointerStart.current = null;
                      }}
                      onPointerCancel={() => { pointerStart.current = null; }}
                      disabled={phase !== "waiting"}
                      aria-pressed={flipped}
                      aria-label={flipped ? `${wordLabel(word)}${pluralHint}，中文释义：${word.meaning}。点击翻回；按向上方向键交付` : `${wordLabel(word)}${pluralHint}。点击翻面查看中文；按向上方向键交付`}
                    >
                      <span className="word-card-inner">
                        <span className="card-face card-front" aria-hidden={flipped}>
                          <span className="card-ribbon">A1 · {PART_LABEL[word.partOfSpeech]}</span>
                          <span className="card-glyph"><WordGlyph word={word} /></span>
                          <strong>{wordLabel(word)}</strong>
                          {word.partOfSpeech === "noun" && word.plural && <span className={`card-plural ${word.plural === "—" ? "no-plural" : ""}`}>{word.plural === "—" ? "通常无复数" : `复数 · ${word.plural}`}</span>}
                          <small>点击查看中文</small>
                        </span>
                        <span className="card-face card-back" aria-hidden={!flipped}>
                          <span className="card-ribbon">中文释义</span>
                          <strong className="card-meaning">{word.meaning}</strong>
                          {word.partOfSpeech === "noun" && word.plural && <span className="card-back-plural">{word.plural === "—" ? "通常无复数" : `${wordLabel(word)} → ${word.plural}`}</span>}
                          <small>点击翻回德语</small>
                        </span>
                      </span>
                      <span className="mastery-pips" aria-label={`熟练度 ${mastery}%`}><i style={{ width: `${mastery}%` }} /></span>
                    </button>
                  );
                })}
                </div>
              </>}
            </div>
          )}
        </section>
      )}

      {view === "lexicon" && (
        <section className="panel-view lexicon-view">
          <div className="panel-heading"><div><span className="eyebrow">Sammlung</span><h1>词汇图鉴</h1><p>{words.length} 个 A1 词汇，掌握程度会随每次交易更新。</p></div><div className="heading-actions"><button onClick={() => importRef.current?.click()}><Import size={17} />导入词库</button><input ref={importRef} hidden type="file" accept=".json,.csv" onChange={(event) => void onImportVocabulary(event.target.files?.[0])} /></div></div>
          <div className="filters">
            <label><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索单词、释义或主题" /></label>
            <select value={partFilter} onChange={(event) => setPartFilter(event.target.value)} aria-label="按词性筛选"><option value="all">全部词性</option>{Object.entries(PART_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            <select value={sort} onChange={(event) => setSort(event.target.value as "word" | "mastery")} aria-label="排序"><option value="word">按字母</option><option value="mastery">按熟练度</option></select>
          </div>
          <div className="lexicon-grid">
            {filteredWords.map((word) => {
              const mastery = save.learning[word.id]?.mastery ?? 0;
              return <article key={word.id} className={`lexicon-card pos-${word.partOfSpeech}`}>
                <div className="lexicon-icon"><WordGlyph word={word} /></div><div className="lexicon-title"><span>{PART_LABEL[word.partOfSpeech]} · {word.theme}</span><h2>{wordLabel(word)}</h2><p>{word.meaning}</p></div>
                <button className="listen" onClick={() => speakGerman(wordLabel(word))} aria-label={`朗读 ${wordLabel(word)}`}><Volume2 size={18} /></button>
                <dl><div><dt>例句</dt><dd>{word.example}<small>{word.exampleZh}</small></dd></div>{word.plural && <div><dt>复数</dt><dd>{word.plural}</dd></div>}{word.conjugation && <div><dt>变位</dt><dd>{word.conjugation}</dd></div>}</dl>
                <div className="mastery-row"><span>熟练度 {mastery}%</span><i><b style={{ width: `${mastery}%` }} /></i></div>
              </article>;
            })}
          </div>
        </section>
      )}

      {view === "decorate" && (
        <section className="panel-view decorate-view">
          <div className="panel-heading"><div><span className="eyebrow">Einrichtung</span><h1>店铺装修</h1><p>购买后会立刻改变右侧的真实店铺画面。</p></div><div className="balance-chip"><Coins size={17} />{save.coins} 金币</div></div>
          <div className="decorate-layout">
            <div className={`shop-preview decor-${save.activeDecorations.join(" decor-")}`}><div className="shop-art" style={{ backgroundImage: `url(${ASSET_BASE}/assets/shop-interior.png)` }} /><div className="ambient-light" /><div className="curtain-layer" /><div className="counter-cloth" /></div>
            <div className="decor-list">{DECORATIONS.map((item) => { const owned = save.ownedDecorations.includes(item.id); const active = save.activeDecorations.includes(item.id); return <article key={item.id}><div className={`decor-swatch swatch-${item.id}`}><WandSparkles size={24} /></div><div><h2>{item.name}</h2><p>{item.note}</p></div>{owned ? <button onClick={() => toggleDecoration(item.id)} className={active ? "active" : ""}>{active ? <><Check size={16} />展示中</> : "摆上"}</button> : <button disabled={save.coins < item.price} onClick={() => buyDecoration(item.id, item.price)}><Coins size={16} />{item.price}</button>}</article>; })}</div>
          </div>
        </section>
      )}

      {view === "stats" && (
        <section className="panel-view stats-view">
          <div className="panel-heading"><div><span className="eyebrow">Lernfortschritt</span><h1>学习统计</h1><p>交易结果会进入复习调度，而不是只改变金币。</p></div></div>
          <div className="stat-cards"><article><span>已接触词汇</span><strong>{Object.values(save.learning).filter((item) => item.lastSeenAt).length}</strong><small>/ {words.length}</small></article><article><span>累计正确</span><strong>{Object.values(save.learning).reduce((sum, item) => sum + item.correct, 0)}</strong><small>次交易</small></article><article><span>待复习</span><strong>{Object.values(save.learning).filter((item) => new Date(item.dueAt) <= new Date()).length}</strong><small>现在到期</small></article><article><span>平均熟练度</span><strong>{Math.round(Object.values(save.learning).reduce((sum, item) => sum + item.mastery, 0) / Math.max(1, Object.keys(save.learning).length))}%</strong><small>已学习词</small></article></div>
          <div className="history-card"><div><h2>最近营业</h2><p>每格代表一次营业日，颜色越深表示正确率越高。</p></div><div className="calendar-grid">{Array.from({ length: 28 }).map((_, index) => { const record = save.history.at(index - 28); const rate = record ? record.correct / Math.max(1, record.correct + record.errors) : 0; return <span key={index} className={record ? "has-day" : ""} style={{ opacity: record ? 0.35 + rate * 0.65 : 0.15 }} title={record ? `${record.correct} 正确 / ${record.errors} 错误` : "暂无记录"} />; })}</div></div>
          <div className="review-list"><h2>需要加强</h2>{Object.values(save.learning).filter((item) => item.wrong > 0).sort((a, b) => b.wrong - a.wrong).slice(0, 8).map((item) => { const word = words.find((entry) => entry.id === item.wordId); return word ? <div key={item.wordId}><span>{wordLabel(word)}<small>{word.meaning}</small></span><strong>{item.wrong} 次答错</strong><i><b style={{ width: `${item.mastery}%` }} /></i></div> : null; })}</div>
        </section>
      )}

      {view === "settings" && (
        <section className="panel-view settings-view">
          <div className="panel-heading"><div><span className="eyebrow">Einstellungen</span><h1>设置与备份</h1><p>音频会在第一次交互后启用；清除浏览器网站数据会删除本地存档。</p></div></div>
          <div className="settings-grid">
            <article className="learning-mode-setting">
              <div className="mode-setting-copy"><Keyboard /><span><h2>学习模式</h2><p>随时切换；当前订单不会重复结算。</p></span></div>
              <div className="mode-options" role="radiogroup" aria-label="学习模式">
                <button type="button" role="radio" aria-checked={learningMode === "flip"} className={learningMode === "flip" ? "active" : ""} onClick={() => changeLearningMode("flip")}><strong>翻卡模式</strong><span>德语正面 · 名词同时显示复数</span><small>适合认识和记忆单词</small></button>
                <button type="button" role="radio" aria-checked={learningMode === "quiz"} className={learningMode === "quiz" ? "active" : ""} onClick={() => changeLearningMode("quiz")}><strong>问答模式</strong><span>中文提示 · 名词需填写复数</span><small>适合主动回忆和拼写</small></button>
              </div>
            </article>
            <article className="sound-setting"><div><Volume2 /><span><h2>游戏音效</h2><p>门铃、卡牌、金币与升级提示。</p></span></div><div className="sound-setting-actions"><button type="button" onClick={previewSound}>试听</button><Switch checked={save.settings.sound} onCheckedChange={(checked) => { setSave((current) => ({ ...current, settings: { ...current.settings, sound: checked } })); if (checked) previewSound(); }} aria-label="游戏音效" /></div></article>
            <article><div><Sparkles /><span><h2>减少动画</h2><p>保留反馈，但缩短位移和等待。</p></span></div><Switch checked={save.settings.reducedMotion} onCheckedChange={(checked) => setSave((current) => ({ ...current, settings: { ...current.settings, reducedMotion: checked } }))} aria-label="减少动画" /></article>
            <article className="range-setting"><div><BookOpen /><span><h2>每日新词</h2><p>当前 {save.settings.dailyNewWords} 个</p></span></div><input type="range" min="5" max="30" step="5" value={save.settings.dailyNewWords} onChange={(event) => setSave((current) => ({ ...current, settings: { ...current.settings, dailyNewWords: Number(event.target.value) } }))} /></article>
            <article className="range-setting"><div><MessageCircleMore /><span><h2>中文线索比例</h2><p>{Math.round(save.settings.chineseRatio * 100)}% 中文，熟练后会自动降低</p></span></div><input type="range" min="0.2" max="0.9" step="0.1" value={save.settings.chineseRatio} onChange={(event) => setSave((current) => ({ ...current, settings: { ...current.settings, chineseRatio: Number(event.target.value) } }))} /></article>
          </div>
          <div className="backup-card"><div><h2>本地存档</h2><p>存档保存在本设备的 IndexedDB。建议定期导出 JSON 备份。</p></div><div><button onClick={() => exportSave(save)}><Upload size={17} />导出存档</button><label className="button-like"><Import size={17} />导入存档<input hidden type="file" accept="application/json" onChange={(event) => void onImportSave(event.target.files?.[0])} /></label></div></div>
        </section>
      )}

      {view === "ledger" && (
        <section className="panel-view ledger-view">
          <button className="back-button" onClick={() => setView("shop")}><ChevronLeft size={18} />返回店铺</button>
          <div className="ledger-paper"><span className="eyebrow">Tagesbuch</span><h1>{phase === "finished" ? "今日打烊" : "店铺账本"}</h1><p>{phase === "finished" ? "五位顾客都已离店。这里同时记录收入与学习结果。" : "最近一次营业记录与当前资产。"}</p>
            <div className="ledger-stats"><div><span>接待顾客</span><strong>{phase === "finished" ? 5 : save.history.at(-1)?.customers ?? 0}</strong></div><div><span>成功交易</span><strong>{phase === "finished" ? day.correct : save.history.at(-1)?.correct ?? 0}</strong></div><div><span>错误次数</span><strong>{phase === "finished" ? day.errors : save.history.at(-1)?.errors ?? 0}</strong></div><div><span>当日收入</span><strong>{phase === "finished" ? day.income : save.history.at(-1)?.income ?? 0}</strong></div></div>
            <div className="weak-strip"><h2>需要加强的单词</h2>{(phase === "finished" ? day.weakWords : save.history.at(-1)?.weakWords ?? []).length ? <div>{(phase === "finished" ? day.weakWords : save.history.at(-1)?.weakWords ?? []).map((id) => { const word = words.find((item) => item.id === id) ?? WORD_BY_ID[id]; return word ? <button key={id} onClick={() => speakGerman(wordLabel(word))}>{wordLabel(word)}<small>{word.meaning}</small><Volume2 size={15} /></button> : null; })}</div> : <p>今天没有错题，做得很好。</p>}</div>
            <button className="primary-action" onClick={startDay}><RotateCcw size={18} />再营业一天</button>
          </div>
        </section>
      )}

      <footer><span>离线可玩 · IndexedDB 自动存档 · 德语发音由设备语音提供</span><span><CircleHelp size={14} />词汇范围参考 Goethe-Zertifikat A1 官方词表</span></footer>
    </main>
  );
}

