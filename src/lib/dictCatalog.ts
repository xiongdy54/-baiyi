// M7 一键下载目录（v32）——唯一事实源：直链/镜像/估计体积/一句话介绍/推荐语/license/档位。
// §7.1.3：站点域名与镜像走配置（本表），不写死在下载逻辑里。
// 全部直链于 2026-09-14 curl 实测核验（HTTP 200 + 文件类型）； FreeDict 为 tar.xz（暂无 lzma 依赖）与
// WordNet 多文件解析停靠后续批次，不挂下载按钮。
// v38 新增两条日→中（jamdict-cn / kaikki zhwiktionary 日语卷）于 2026-09-15 网络核验（kaikki 原始包 226,749,796 字节、
// jamdict-cn release 资产 142,443,471 字节）；JMdict 官方无中文版（多语言版仅 9 种欧语），此二为唯一可自由再分发的日→中来源。
import type { DictSuitable } from "./dict";

export interface DictCatalogItem {
  id: string;
  name: string;
  langPair: string;
  format: string;
  url: string;
  mirrorUrl?: string;
  estSizeLabel: string;
  estBytes: number;
  desc: string;
  recommend: string;
  recommendLevel: "首选" | "轻量" | "备选" | "第二批" | "后续批次" | "不提供";
  license: string;
  attribution: string;
  updateFreq: string;
  suitable: DictSuitable;
}

export const DICT_CATALOG: DictCatalogItem[] = [
  {
    id: "jmdict-e",
    name: "JMDict（英）",
    langPair: "日→英",
    format: "jmdict-xml",
    url: "https://www.edrdg.org/pub/Nihongo/JMdict_e.gz",
    estSizeLabel: "约10MB",
    estBytes: 10572703,
    desc: "日英权威开源词典，日语查词首选（在线 Jisho 已停服，日语靠它）",
    recommend: "体积小、日更，优先内置",
    recommendLevel: "首选",
    license: "CC-BY-SA",
    attribution: "© EDRDG（Electronic Dictionary Research and Development Group）",
    updateFreq: "每日构建",
    suitable: "download",
  },
  {
    id: "ecdict-full",
    name: "ECDICT 完整版",
    langPair: "英→中",
    format: "ecdict-sqlite",
    url: "https://github.com/skywind3000/ECDICT/releases/download/1.0.28/ecdict-sqlite-28.zip",
    estSizeLabel: "约207MB",
    estBytes: 216765132,
    desc: "免费英汉全量库（约 76 万词，含音标词性），查英文主力；repo 内 ecdict.mini.csv 实测仅 53 行样例（2026-09-14 核验），无更小官方包；导入建索引需较充裕内存、约 1-3 分钟",
    recommend: "英汉唯一官方全量包；弱网可复制链接手动下载后本地导入",
    recommendLevel: "首选",
    license: "MIT",
    attribution: "© ECDICT（skywind3000），保留 MIT 声明",
    updateFreq: "低频/偶发更新",
    suitable: "download",
  },
  {
    id: "cc-cedict",
    name: "CC-CEDICT",
    langPair: "中↔英",
    format: "cedict-zip",
    url: "https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.zip",
    estSizeLabel: "约4MB",
    estBytes: 3974366,
    desc: "CC-CEDICT 汉英社区词典（繁简双语头 + 拼音），中英互查刚需",
    recommend: "极小、滚动更新，中文词查询主力",
    recommendLevel: "第二批",
    license: "CC-BY-SA",
    attribution: "© CC-CEDICT（MDBG，CC-BY-SA 4.0），应用内署名",
    updateFreq: "滚动更新",
    suitable: "download",
  },
  {
    id: "jamdict-cn",
    name: "jamdict-cn 日汉",
    langPair: "日→中",
    format: "jamdict-sqlite",
    url: "https://github.com/5945ggh/jamdict-cn/releases/download/database/jamdict_cn_deduplicated.zip",
    estSizeLabel: "约142MB",
    estBytes: 142443471,
    desc: "JMdict 全部约 19 万词条的中文释义（日文词头 + 假名读音 + 中文释义）；释义由英文释义 AI 翻译而来，质量可用但可能存在少量错误",
    recommend: "目前唯一覆盖 JMdict 全量的日→中开放数据；日语学习者查中文释义主力",
    recommendLevel: "第二批",
    license: "代码 MIT / 数据随 EDRDG（CC-BY-SA 4.0）",
    attribution: "© EDRDG；中文释义为 jamdict-cn（5945ggh）AI 翻译，随 CC-BY-SA 4.0 同许可共享",
    updateFreq: "低频",
    suitable: "download",
  },
  {
    id: "kaikki-zh-ja",
    name: "维基词典 日→中（kaikki）",
    langPair: "日→中",
    format: "kaikki-jsonl",
    url: "https://kaikki.org/zhwiktionary/raw-wiktextract-data.jsonl.gz",
    estSizeLabel: "约216MB",
    estBytes: 226749796,
    desc: "中文维基词典全部日语词条提取（人工编纂，含百科词/俗语，JMdict 之外的补充）；导入时按 lang_code==ja 过滤、繁简释义合并去重。官方简繁分卷已标记将下架，故用原始包",
    recommend: "真人编纂的日→中释义，与 jamdict-cn 互补（JMdict 覆盖现代词，维基覆盖百科词）；导入耗时数分钟",
    recommendLevel: "第二批",
    license: "CC-BY-SA + GFDL（双许可）",
    attribution: "© 中文维基词典贡献者（kaikki.org 提取），CC-BY-SA 4.0 署名同许可共享",
    updateFreq: "每周左右",
    suitable: "download",
  },
  {
    id: "freedict-eng-zho",
    name: "FreeDict 英-中",
    langPair: "英↔中",
    format: "stardict-tar-xz",
    url: "https://download.freedict.org/dictionaries/eng-zho/",
    estSizeLabel: "约1–2MB",
    estBytes: 2 * 1024 * 1024,
    desc: "超轻量英汉双语库（约 2.6 万词）；tar.xz 解包依赖后续批次补齐",
    recommend: "后续批次提供一键下载；现可手动转 StarDict 后本地导入",
    recommendLevel: "后续批次",
    license: "GPL（词典数据）",
    attribution: "© FreeDict project（GPL），应用内注明来源与许可",
    updateFreq: "滚动更新（日期版）",
    suitable: "parked",
  },
  {
    id: "freedict-jpn-eng",
    name: "FreeDict 日-英",
    langPair: "日↔英",
    format: "stardict-tar-xz",
    url: "https://download.freedict.org/dictionaries/jpn-eng/",
    estSizeLabel: "约几MB",
    estBytes: 6 * 1024 * 1024,
    desc: "轻量日英双语库（约 17 万词）；tar.xz 解包依赖后续批次补齐",
    recommend: "后续批次提供；日语查词已由 JMDict 覆盖",
    recommendLevel: "后续批次",
    license: "GPL（词典数据）",
    attribution: "© FreeDict project（GPL），应用内注明来源与许可",
    updateFreq: "低频",
    suitable: "parked",
  },
  {
    id: "wordnet",
    name: "WordNet",
    langPair: "英→英",
    format: "wordnet-db",
    url: "https://wordnet.princeton.edu/download",
    estSizeLabel: "约10–30MB",
    estBytes: 20 * 1024 * 1024,
    desc: "英文同义/反义词扩展来源；多文件解析后续批次补齐",
    recommend: "后续批次提供一键下载",
    recommendLevel: "后续批次",
    license: "WordNet License（宽松）",
    attribution: "© Princeton University",
    updateFreq: "低频",
    suitable: "parked",
  },
  {
    id: "stardict-import",
    name: "StarDict 本地包",
    langPair: "多语言",
    format: "stardict-trio",
    url: "",
    estSizeLabel: "本地文件",
    estBytes: 0,
    desc: "已有 .ifo/.idx/.dict(.dz) 三件套走本地导入",
    recommend: "朗道/牛津等第三方包版权不明，不提供下载，仅导入自有文件",
    recommendLevel: "不提供",
    license: "以各词典数据版权为准",
    attribution: "导入时保留原词典版权说明",
    updateFreq: "—",
    suitable: "importOnly",
  },
  {
    id: "kaikki-note",
    name: "Wiktionary 全量包",
    langPair: "多语言",
    format: "kaikki-jsonl",
    url: "https://kaikki.org/dictionary/downloads.html",
    estSizeLabel: "数GB",
    estBytes: 3 * 1024 * 1024 * 1024,
    desc: "Wiktionary 全量解析，最大最全但数 GB",
    recommend: "太大不内置，仅在线 API + 高级 URL 自导入",
    recommendLevel: "不提供",
    license: "CC-BY-SA（数据）",
    attribution: "© Wiktionary contributors（CC-BY-SA）",
    updateFreq: "数日一更",
    suitable: "onlineOnly",
  },
];

export function catalogById(id: string): DictCatalogItem | null {
  return DICT_CATALOG.find((c) => c.id === id) ?? null;
}

export function downloadableCatalog(): DictCatalogItem[] {
  return DICT_CATALOG.filter((c) => c.suitable === "download");
}
