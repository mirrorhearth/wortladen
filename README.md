# Wortladen · 单词小店

一款为 iPhone 竖屏优先设计的德语 A1 卡牌交易与店铺经营学习游戏。顾客只描述想要的词汇，玩家从手牌中点击或上划正确的德语词卡，随后能看到卡牌交付、顾客付款、实体金币飞入钱袋与顾客离店的完整流程。

## 已完成的 MVP

- 5 位顾客为一个营业日，4 种顾客形象轮换出现。
- 50 个 A1 示例词，覆盖名词、动词、形容词、副词及疑问词；每词含中德双语描述、例句与学习信息。
- 5–6 张动态候选手牌、点击与向上拖动出牌、错误退回与渐进提示。
- 完整成交动画：卡牌上柜台、顾客反馈、3 枚实体金币分别代表 4 金币并飞入钱袋、余额动画更新。
- 简化 SM-2 间隔复习、错词记录、熟练度、词汇图鉴、德语 SpeechSynthesis 发音。
- 5 种可购买且会真实改变店铺画面的装饰。
- IndexedDB 自动存档、版本校验、JSON 导入导出。
- JSON/CSV 词库导入；新词自动进入通用订单、卡牌和复习流程。
- PWA manifest、离线缓存、iPhone 安全区与触控优化。
- GitHub Pages 自动部署工作流。

词汇范围参考 [Goethe-Institut《Goethe-Zertifikat A1: Start Deutsch 1 Wortliste》](https://www.goethe.de/pro/relaunch/prf/es/A1_SD1_Wortliste_02.pdf)。中文释义、例句和线索为本项目独立编写并人工检查；它们不是官方词表的逐字翻译。

## 本地运行

需要 Node.js 22.13 或更高版本。

```bash
npm install
npm run dev
```

运行基础逻辑测试与生产构建：

```bash
npm test
npm run build
```

## GitHub Pages

将仓库推送到 `main` 分支后，在 GitHub 仓库的 **Settings → Pages → Build and deployment** 中选择 **GitHub Actions**。工作流会自动注入仓库子路径、运行测试、构建 `dist/client` 并发布。

当前工作区创建时没有已连接的 GitHub 远程仓库，所以本项目只建立了本地 Git 提交和完整 Pages 配置；需要由仓库所有者添加远程并推送。

## 词库导入

JSON 文件必须是 `WordEntry[]` 数组。每项至少需要：`id`、`word`、`meaning`、`partOfSpeech`、`example`、`descriptions.zh[]` 与 `descriptions.de[]`。

CSV 支持这些表头：

```text
id,word,meaning,partOfSpeech,article,plural,conjugation,example,exampleZh,theme,difficulty,zh1,zh2,de1,de2
```

词性可用 `noun`、`verb`、`adjective`、`adverb`、`other`。导入后无需修改游戏核心逻辑，候选卡、订单和复习调度都会自动使用新词。

## 架构

- `data/vocabulary.ts`：独立词库。
- `lib/game-types.ts`：严格 TypeScript 数据模型。
- `lib/learning.ts`：候选卡与间隔复习算法。
- `lib/storage.ts`：IndexedDB 存档、校验和备份。
- `lib/audio.ts`：用户交互后启用的 Web Audio 与德语朗读。
- `components/game/WortladenGame.tsx`：场景、导航与核心交易状态机。
- `public/`：PWA 与原创游戏素材；来源见 `ASSETS.md`。

采用 React + TypeScript + Vinext/Vite 的静态导出路径。没有引入 PixiJS 或动画库：MVP 的状态动画与金币曲线由 CSS 完成，减少下载体积并保持 iPhone Safari 流畅；游戏进度按需求保存在设备本地 IndexedDB，因此离线可用且无需账号或付费 API。
