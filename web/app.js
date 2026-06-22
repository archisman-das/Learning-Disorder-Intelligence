const storeKey = "ld_dashboard_records_v2";

const apiBase = (() => {
  const explicit = String(window.__API_BASE__ || "").trim().replace(/\/+$/, "");
  if (explicit) return explicit;
  const { protocol, hostname, port, origin } = window.location;
  if (protocol === "file:" || protocol === "about:") {
    return "http://localhost:8080";
  }
  if ((hostname === "localhost" || hostname === "127.0.0.1") && port && port !== "8080") {
    return "http://localhost:8080";
  }
  return origin || "http://localhost:8080";
})();

function apiUrl(path) {
  const cleanPath = String(path || "");
  return `${apiBase}${cleanPath.startsWith("/") ? cleanPath : `/${cleanPath}`}`;
}

function resolveWebAssetUrl(assetPath) {
  const raw = String(assetPath || "").trim();
  if (!raw) return "";
  if (/^(https?:|blob:|data:)/i.test(raw)) return raw;
  const normalized = raw.replace(/^\.\//, "").replace(/^\/+/, "");
  try {
    return new URL(normalized, window.location.href).toString();
  } catch (_error) {
    return normalized;
  }
}

async function playResolvedAudio(player, assetPath) {
  const resolvedUrl = resolveWebAssetUrl(assetPath);
  if (!resolvedUrl || !player) {
    throw new Error("Missing audio source.");
  }

  player.pause();
  player.src = resolvedUrl;
  player.load();

  try {
    await player.play();
    return;
  } catch (_directError) {
    const response = await fetch(resolvedUrl, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Audio fetch failed with status ${response.status}.`);
    }
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    player.src = blobUrl;
    player.load();
    try {
      await player.play();
    } catch (blobError) {
      URL.revokeObjectURL(blobUrl);
      throw blobError;
    }
    player.addEventListener("ended", () => URL.revokeObjectURL(blobUrl), { once: true });
  }
}

const tabButtons = [...document.querySelectorAll(".tab-btn")];
const tabPanels = [...document.querySelectorAll(".tab-panel")];

function activateTab(tabId) {
  const target = document.getElementById(tabId);
  if (!target) return;
  tabButtons.forEach((x) => {
    x.classList.remove("btn-primary", "active");
    x.classList.add("btn-light");
  });
  tabPanels.forEach((x) => x.classList.remove("active"));
  const activeButton = tabButtons.find((button) => button.dataset.tab === tabId);
  if (activeButton) {
    activeButton.classList.remove("btn-light");
    activeButton.classList.add("btn-primary", "active");
  }
  target.classList.add("active");
  if (tabId === "modelstats") {
    renderModelStatisticsPage();
  }
}

tabButtons.forEach((button) => {
  button.addEventListener("click", () => activateTab(button.dataset.tab));
});

document.querySelectorAll("[data-nav-tab]").forEach((button) => {
  button.addEventListener("click", () => activateTab(button.dataset.navTab));
});

let screeningChart;
let therapyChart;
let eyeChart;
let biomarkerChart;
let modelCompareChart;
let modelStatsChart;
let modelStatsLoadAttempted = false;
let modelStatsSortState = { key: "pipeline_rank", direction: "asc" };
let latestScreening = null;
let latestTherapy = null;
let latestEye = null;
let reportSourceVersion = 0;
let therapyRecognition = null;
let therapyRecognitionRunning = false;
let therapyRecognitionPrimed = false;
let therapyRecognitionPurpose = "idle";
let therapyRecognitionPrimeResolver = null;
let therapyMediaStream = null;
let therapyDurationTimer = null;
let therapyAutoCaptureTimer = null;
let therapyContinuousRequested = false;
let therapyAudioContext = null;
let therapyAnalyser = null;
let therapyAudioData = null;
let therapyVoiceMonitorTimer = null;
let therapyVoiceMonitorActive = false;
let therapyVoiceRmsEma = 0;
let therapyVoiceNoiseFloor = 0.006;
let therapyVoiceSpeechThreshold = 0.018;
let therapyVoiceSilenceThreshold = 0.010;
let therapyVoiceCalibrationEndsAt = 0;
let therapyVoiceIsSpeaking = false;
let therapyVoiceSpeechStartedAt = 0;
let therapyVoiceSilenceStartedAt = 0;
let therapyVoiceHandledCurrentPrompt = false;
let therapyRoundState = {
  active: false,
  prompts: [],
  currentIndex: 0,
  results: [],
  startedAt: 0,
  promptShownAt: 0,
  language: "Bengali",
  sessionType: "Sound Drill",
  target: "",
  difficulty: "Guided",
  cueLevel: "Moderate Cueing",
  captureTranscript: "",
  finishRequested: false,
  micReady: false,
};
let readingTestState = {
  startedAt: null,
  seconds: 0,
  hesitations: 0,
  done: false,
  score: 0,
  wpm: 0,
  wordsSpoken: 0,
  recognitionAvailable: false,
};
let readingRecognition = null;
let readingRecognitionRunning = false;
let readingStopRequested = false;
let readingLastResultAt = 0;
let readingMonitorTimer = null;
let readingLastActivityAt = 0;
let readingLastHesitationMarkAt = 0;
let readingCurrentTranscript = "";
let readingHadSpeechSinceLastHesitation = false;
let hesitatedWords = [];
let hesitatedWordEvents = [];
let readingPromptWords = [];
let readingPromptWordSet = new Set();
let readingMediaStream = null;
let readingAudioContext = null;
let readingAnalyser = null;
let readingAudioData = null;
let readingRecorder = null;
let readingRecorderMimeType = "";
let readingRecordedChunks = [];
let readingMicLevelActive = false;
let readingIsCurrentlySpeaking = false;
let readingSilenceStartedAt = 0;
let readingAutoFinalizeTimer = null;
let readingOfflineMode = false;
let readingRmsEma = 0;
let readingNoiseFloor = 0.006;
let readingSpeechThreshold = 0.018;
let readingSilenceThreshold = 0.010;
let readingCalibrationEndsAt = 0;
let readingSpeechStartedAt = 0;
let readingLastSpeechDurationMs = 0;
let audioFeatures = { analyzed: false, comprehensionScore: 0, reloadCount: 0, wrongAttempts: 0, pronunciationProxy: 3 };
let spellingFeatures = { scored: false, errors: 0, total: 3 };
let currentSpellingWords = ["বাংলা", "নদী", "বই"];
let currentListeningItem = null;
let currentListeningLanguage = "English";
let currentListeningAudioPath = "";
let selectedAudioOptionIndex = null;
let audioPlaybackCompleted = false;
let audioPlaybackStarted = false;
let audioPlaybackInProgress = false;
let audioAnswerLocked = false;
let selectedVoiceURI = "";
let bengaliListeningSet = [];
let latestEyeTrace = null;
let latestEyeTraceLabel = "";
let eyeLiveTraceState = {
  active: false,
  startedAt: 0,
  autoStopAt: 0,
  points: [],
  timer: null,
  lastPointTs: 0,
};
let eyeTestState = {
  active: false,
  roundIndex: 0,
  totalRounds: 20,
  roundTypes: [],
  results: [],
  startedAt: 0,
  roundStartedAt: 0,
  target: "",
  choices: [],
  wrongClicks: 0,
  locked: false,
};
let spellingAutoScoreTimer = null;
let screeningAutoRunTimer = null;
const READING_PASS_THRESHOLD = 60;
const AUDIO_PASS_THRESHOLD = 70;
const SPELLING_PASS_THRESHOLD = 67;
const THERAPY_PASS_THRESHOLD = 75;

const MODEL_STATS_PROFILES = [
  {
    modelName: "transformer",
    architecture: "Attention-based fusion",
    modalities: "Handwriting + audio + text + behavior",
    strength: "Context-aware fusion",
    note: "Balances multi-source signals and usually gives stable comparisons.",
  },
  {
    modelName: "vit",
    architecture: "Vision transformer variant",
    modalities: "Handwriting + audio + text + behavior",
    strength: "Stronger visual representation",
    note: "Useful when handwritten structure matters more than raw image texture.",
  },
  {
    modelName: "multimodal_attention",
    architecture: "Attention-guided multimodal",
    modalities: "Handwriting + audio + text + behavior",
    strength: "Best fusion and agreement",
    note: "Usually the strongest choice when all modalities are available.",
  },
];
const MODEL_STATS_ROW_ORDER = ["multimodal_attention", "transformer", "vit"];
const MODEL_STATS_VISIBLE_MODELS = new Set(MODEL_STATS_PROFILES.map((profile) => profile.modelName.toLowerCase()));

const THERAPY_DURATION_TARGETS = {
  "Sound Drill": 18,
  "Syllable Drill": 22,
  "Word Reading": 28,
  "Phrase Practice": 35,
  "Sentence Reading": 42,
};

const THERAPY_CUE_SCORES = {
  "High Cueing": 58,
  "Moderate Cueing": 76,
  "Low Cueing": 92,
};

const THERAPY_DIFFICULTY_BONUS = {
  Foundation: -4,
  Guided: 0,
  Independent: 5,
};

const EYE_PRESETS = {
  letters: {
    label: "Alphabet Match",
    description: "Find the matching letter quickly across 20 rounds for a more reliable classroom attention check.",
    targetResponseMs: 2200,
    totalRounds: 20,
    symbolPool: ["A", "B", "D", "E", "F", "H", "K", "M", "N", "P", "R", "S", "T", "Y"],
    bengaliSymbolPool: ["অ", "আ", "ই", "ঈ", "উ", "ঊ", "এ", "ঐ", "ও", "ঔ", "ক", "খ", "গ", "চ", "জ", "ট", "ড", "ত", "ন", "প", "র", "ল", "শ", "স", "হ", "ম"],
  },
  digits: {
    label: "Digit Match",
    description: "Find the matching number across 20 rounds for a steadier low-language visual speed check.",
    targetResponseMs: 1900,
    totalRounds: 20,
    symbolPool: ["2", "3", "4", "5", "6", "7", "8", "9"],
    bengaliDigitPool: ["২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"],
  },
  mixed: {
    label: "Mixed Symbols",
    description: "A harder 24-round mode with letters and digits mixed together for a more meaningful consistency pattern.",
    targetResponseMs: 2400,
    totalRounds: 24,
    symbolPool: ["A", "C", "E", "H", "K", "M", "P", "R", "3", "4", "5", "7", "8", "9"],
    letterPool: ["A", "C", "E", "H", "K", "M", "P", "R"],
    digitPool: ["3", "4", "5", "7", "8", "9"],
    bengaliLetterPool: ["অ", "আ", "ই", "ঈ", "উ", "ঊ", "এ", "ঐ", "ও", "ঔ", "ক", "খ", "গ", "চ", "জ", "ট", "ড", "ত"],
    bengaliDigitPool: ["২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"],
  },
};

const THERAPY_TARGET_OPTIONS = {
  Bengali: {
    "Sound Drill": ["শ", "স", "র", "ল", "ক", "ম"],
    "Syllable Drill": ["শা", "সি", "রু", "লে", "কা", "মো"],
    "Word Reading": ["শিশু", "স্কুল", "রবি", "লাল", "কলম", "মাটি"],
    "Phrase Practice": ["শব্দ বলো", "ধীরে পড়ো", "রঙিন ফুল", "লাল কলম", "মিষ্টি গান"],
    "Sentence Reading": [
      "আমি ধীরে পড়ি।",
      "শিশু স্কুলে যায়।",
      "রবি লাল কলম আনে।",
      "মাটি ভিজে গেছে।",
    ],
  },
  English: {
    "Sound Drill": ["sh", "s", "r", "l", "k", "m"],
    "Syllable Drill": ["sha", "see", "roo", "lee", "kay", "moo"],
    "Word Reading": ["ship", "sun", "rain", "lamp", "kite", "moon"],
    "Phrase Practice": ["say it slowly", "clear speech", "read again", "little lamp", "soft sound"],
    "Sentence Reading": [
      "I can say the sound clearly.",
      "The sun is bright today.",
      "Rina reads the line slowly.",
      "The lamp is on the table.",
    ],
  },
  Multilingual: {
    "Sound Drill": ["sh", "s", "r", "l", "k", "m"],
    "Syllable Drill": ["শা", "si", "রু", "lee", "কা", "moo"],
    "Word Reading": ["বাংলা", "sound", "রবি", "lamp", "কলম", "moon"],
    "Phrase Practice": ["slowly বলো", "clear speech", "ধীরে পড়ো", "repeat sound", "short phrase"],
    "Sentence Reading": [
      "আমি slowly পড়ি.",
      "Ravi clear sound বলে.",
      "The lamp টেবিলে আছে.",
      "We repeat the word again.",
    ],
  },
};

const SPELLING_WORD_BANKS = {
  Bengali: [
    "বাংলা", "নদী", "বই", "স্কুল", "শিক্ষা", "কলম", "খাতা", "ফুল", "পাখি", "আকাশ",
    "মাটি", "শব্দ", "গান", "চিঠি", "চশমা", "সময়", "সকাল", "রাত", "শিশু", "বন্ধু",
    "পরিবার", "দরজা", "জানালা", "খেলাধুলা", "চাকরি", "গ্রাম", "শহর", "ছাত্র", "শিক্ষক", "কবিতা",
  ],
  English: [
    "school", "river", "friend", "garden", "teacher", "picture", "window", "morning", "basket", "pencil",
    "reading", "library", "sunlight", "chapter", "flower", "blanket", "station", "language", "family", "animal",
    "correct", "sentence", "practice", "holiday", "children", "journey", "village", "mountain", "kitchen", "shoulder",
  ],
  Multilingual: [
    "reading", "বাংলা", "school", "শব্দ", "friend", "language", "river", "practice", "teacher", "garden",
  ],
};

const BENGALI_WORD_BANK = [
  "বাংলা", "নদী", "বই", "স্কুল", "শিক্ষা", "কলম", "খাতা", "ফুল", "পাখি", "আকাশ",
  "মাটি", "শব্দ", "গান", "চিঠি", "চশমা", "সময়", "সকাল", "রাত", "শিশু", "বন্ধু",
  "পরিবার", "দরজা", "জানালা", "খেলাধুলা", "চাকরি", "গ্রাম", "শহর", "ছাত্র", "শিক্ষক", "কবিতা",
];

const READING_PROMPTS = {
  Bengali: [
    "আজ আমি মনোযোগ দিয়ে বাংলা অনুচ্ছেদ পড়ছি।",
    "শিক্ষক যেমন দেখিয়েছেন, আমি তেমন করে স্পষ্ট উচ্চারণে পড়ি।",
    "প্রতিদিন একটু একটু করে পড়ার অভ্যাস করলে আমার সাবলীলতা বাড়ে।",
    "কঠিন শব্দ দেখলে আমি শব্দটাকে ভাগ করে আবার পড়ি।",
    "ধীরে শুরু করে পরে আমি একই বাক্য আরও স্বাভাবিক গতিতে পড়ি।",
  ],
  English: [
    "I read each sentence slowly and clearly.",
    "Today I practiced reading a short passage.",
    "My teacher helps me break words into sounds.",
    "I improve by reading a little every day.",
    "I read short lines and repeat difficult words.",
  ],
  Multilingual: [
    "আমি এবং I together read short mixed lines.",
    "मैं और আমি both practice clear reading daily.",
    "I read বাংলা words and English words carefully.",
    "আমি, मैं, and I read one line at a time.",
    "Mixed-language reading helps me focus on sounds.",
  ],
};

const LISTENING_PARAGRAPHS = {
  Bengali: [
    {
      paragraph: "সকালবেলা রিমি স্কুলে যাওয়ার আগে দশ মিনিট বই পড়ে। আজ সে নদী আর পাখি নিয়ে একটি ছোট গল্প পড়েছে।",
      question: "রিমি স্কুলে যাওয়ার আগে কী করে?",
      options: ["বই পড়ে", "খেলতে যায়", "টিভি দেখে"],
      correctIndex: 0,
      audioPath: "./assets/audio/bn_q1.mp3",
    },
    {
      paragraph: "আরিফ প্রতিদিন সন্ধ্যায় পড়ার টেবিলে বসে অনুশীলন করে। কঠিন শব্দ দেখলে সে শব্দটা ভেঙে ধীরে ধীরে পড়ে।",
      question: "কঠিন শব্দ দেখলে আরিফ কী করে?",
      options: ["শব্দ ভেঙে পড়ে", "বই বন্ধ করে", "লিখতে শুরু করে"],
      correctIndex: 0,
      audioPath: "./assets/audio/bn_q2.mp3",
    },
    {
      paragraph: "মিতা পড়ার সময় তাড়াহুড়ো করে না। সে প্রথমে বাক্যটি একবার দেখে, তারপর স্পষ্ট উচ্চারণে পড়ে।",
      question: "মিতা পড়ার আগে কী করে?",
      options: ["বাক্যটি একবার দেখে", "বন্ধুকে ডাকে", "হাঁটতে যায়"],
      correctIndex: 0,
      audioPath: "./assets/audio/bn_q3.mp3",
    },
  ],
  English: [
    {
      paragraph: "Maya reads for ten minutes before school. Today she read a short story about a river and birds.",
      question: "What does Maya do before school?",
      options: ["She reads", "She watches TV", "She goes to sleep"],
      correctIndex: 0,
      audioPath: "./assets/audio/en_q1.wav",
    },
    {
      paragraph: "Rafi practices every evening. When he finds a difficult word, he breaks it into parts and reads slowly.",
      question: "What does Rafi do with difficult words?",
      options: ["Breaks words into parts", "Skips the word", "Stops reading"],
      correctIndex: 0,
      audioPath: "./assets/audio/en_q2.wav",
    },
  ],
  Multilingual: [
    {
      paragraph: "রাফি আর মীরা একসাথে রিডিং প্র্যাকটিস করে। কঠিন word এলে তারা slowly পড়ে এবং sound ভেঙে নেয়।",
      question: "Rafi আর Mira কঠিন word এলে কী করে?",
      options: ["ধীরে পড়ে এবং sound ভেঙে নেয়", "খেলা শুরু করে", "বই বন্ধ করে"],
      correctIndex: 0,
      audioPath: "./assets/audio/multi_q1.wav",
    },
    {
      paragraph: "অনন্যা school থেকে ফিরে ten minutes story শোনে। তারপর সে notebook-এ two new words লিখে রাখে।",
      question: "Story শোনার পর Ananya কী করে?",
      options: ["দুটি new word লিখে রাখে", "ঘুমিয়ে পড়ে", "টিভি দেখে"],
      correctIndex: 0,
      audioPath: "./assets/audio/multi_q2.wav",
    },
  ],
};

const BENGALI_LISTENING_FALLBACK = [
  {
    id: "bn_q1",
    audioPath: "./assets/audio/bn_q1.mp3",
    paragraph: "রিমি প্রতিদিন সকালে স্কুলে যাওয়ার আগে দশ মিনিট গল্প শোনে। আজ সে নদী আর পাখির গল্প শুনে খুব আনন্দ পেয়েছে।",
    question: "রিমি সকালে কত মিনিট গল্প শোনে?",
    options: ["পাঁচ মিনিট", "দশ মিনিট", "বিশ মিনিট"],
    correctIndex: 1,
  },
  {
    id: "bn_q2",
    audioPath: "./assets/audio/bn_q2.mp3",
    paragraph: "আরিফ পড়ার সময় কঠিন শব্দ পেলে শব্দটাকে ছোট ছোট অংশে ভাগ করে ধীরে ধীরে পড়ে। এতে তার ভুল কমে যায়।",
    question: "কঠিন শব্দ দেখলে আরিফ কী করে?",
    options: ["লাইন এড়িয়ে যায়", "শব্দ ভেঙে ধীরে পড়ে", "বই বন্ধ করে"],
    correctIndex: 1,
  },
  {
    id: "bn_q3",
    audioPath: "./assets/audio/bn_q3.mp3",
    paragraph: "মিতা নতুন অধ্যায় পড়ার আগে শিরোনাম আর প্রথম লাইন ভালো করে দেখে। তারপর পরিষ্কার উচ্চারণে পড়া শুরু করে।",
    question: "পড়া শুরুর আগে মিতা কী দেখে?",
    options: ["ছবির নিচের লেখা", "শেষ অনুচ্ছেদ", "শিরোনাম ও প্রথম লাইন"],
    correctIndex: 2,
  },
  {
    id: "bn_q4",
    audioPath: "./assets/audio/bn_q4.mp3",
    paragraph: "সোহান প্রতিদিন সন্ধ্যায় বাড়ির কাজ শেষ করে পনেরো মিনিট পড়ার অনুশীলন করে। নিয়মিত অনুশীলনে তার পড়ার গতি বাড়ছে।",
    question: "সোহান কখন অনুশীলন করে?",
    options: ["দুপুরে", "ভোরে", "সন্ধ্যায়"],
    correctIndex: 2,
  },
  {
    id: "bn_q5",
    audioPath: "./assets/audio/bn_q5.mp3",
    paragraph: "তৃষা পড়ার সময় তাড়াহুড়ো করে না। সে ধীরে এবং স্পষ্টভাবে লাইন পড়ে, তাই শিক্ষক তার উচ্চারণের প্রশংসা করেন।",
    question: "তৃষা কীভাবে পড়ে?",
    options: ["খুব তাড়াতাড়ি", "প্রায় না থেমে ভুল করে", "ধীরে ও স্পষ্টভাবে"],
    correctIndex: 2,
  },
];

const n = (id) => Number(document.getElementById(id).value || 0);
const loadRecords = () => JSON.parse(localStorage.getItem(storeKey) || "[]");
const RECORD_DUPLICATE_WINDOW_MS = 3000;
const RECORD_REPEAT_WINDOW_MS = 30 * 60 * 1000;

function stableSerializeRecord(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerializeRecord(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerializeRecord(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

const saveRecord = (entry) => {
  const records = loadRecords();
  const now = new Date();
  const lastRecord = records[records.length - 1];
  const incomingFingerprint = stableSerializeRecord(entry);
  if (lastRecord) {
    const { timestamp: _lastTimestamp, ...lastEntry } = lastRecord;
    const lastFingerprint = stableSerializeRecord(lastEntry);
    const lastSavedAt = Date.parse(lastRecord.timestamp || "");
    if (
      Number.isFinite(lastSavedAt) &&
      (now.getTime() - lastSavedAt) <= RECORD_DUPLICATE_WINDOW_MS &&
      lastFingerprint === incomingFingerprint
    ) {
      return;
    }
  }
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const existingRecord = records[index];
    if (!existingRecord || existingRecord.type !== entry.type) continue;
    const existingSavedAt = Date.parse(existingRecord.timestamp || "");
    if (
      Number.isFinite(existingSavedAt) &&
      (now.getTime() - existingSavedAt) > RECORD_REPEAT_WINDOW_MS
    ) {
      break;
    }
    const { timestamp: _existingTimestamp, ...existingEntry } = existingRecord;
    if (stableSerializeRecord(existingEntry) === incomingFingerprint) {
      return;
    }
  }
  records.push({ ...entry, timestamp: now.toISOString() });
  localStorage.setItem(storeKey, JSON.stringify(records));
  renderRecords();
};

function recordTypeLabel(type) {
  const bengali = isBengaliUi();
  const labels = {
    screening: bengali ? "স্ক্রিনিং" : "Screening",
    therapy: bengali ? "থেরাপি" : "Therapy",
    eye_tracking: bengali ? "ভিজ্যুয়াল ফোকাস টেস্ট" : "Visual Focus Test",
    biomarkers: bengali ? "বায়োমার্কার" : "Biomarkers",
    model_selection: bengali ? "মডেল নির্বাচন" : "Model Selection",
    final_report: bengali ? "চূড়ান্ত রিপোর্ট" : "Final Report",
  };
  return labels[type] || (type ? String(type).replace(/_/g, " ") : "Unknown");
}

function getRecordStatusMeta(record) {
  const bengali = isBengaliUi();
  if (!record || typeof record !== "object") {
    return { label: "-", className: "text-secondary fw-semibold" };
  }
  if (record.type === "screening") {
    const score = Number(record.confidence || 0) * 100;
    return score >= 75
      ? { label: bengali ? "উচ্চ অনুমানিত আত্মবিশ্বাস" : "High estimated confidence", className: "text-success fw-semibold" }
      : score >= 55
        ? { label: bengali ? "মাঝারি অনুমানিত আত্মবিশ্বাস" : "Moderate estimated confidence", className: "text-warning fw-semibold" }
        : { label: bengali ? "কম অনুমানিত আত্মবিশ্বাস" : "Low estimated confidence", className: "text-danger fw-semibold" };
  }
  if (record.type === "therapy") {
    const score = Number(record.overallScorePct || (record.score || 0) * 100);
    return score >= THERAPY_PASS_THRESHOLD
      ? { label: bengali ? "সঠিক পথে" : "On track", className: "text-success fw-semibold" }
      : { label: bengali ? "সহায়তা দরকার" : "Needs support", className: "text-danger fw-semibold" };
  }
  if (record.type === "eye_tracking") {
    const score = Number(record.eyeOverallScore || 0);
    return score >= 80
      ? { label: bengali ? "স্থিতিশীল" : "Stable", className: "text-success fw-semibold" }
      : score >= 65
        ? { label: bengali ? "খেয়াল করুন" : "Watch", className: "text-warning fw-semibold" }
        : { label: bengali ? "সহায়তা দরকার" : "Support needed", className: "text-danger fw-semibold" };
  }
  if (record.type === "final_report") {
    const risk = Number(record.avgRisk || 0);
    return risk <= 0.35
      ? { label: bengali ? "কম ঝুঁকি" : "Lower risk", className: "text-success fw-semibold" }
      : risk <= 0.65
        ? { label: bengali ? "মাঝারি ঝুঁকি" : "Moderate risk", className: "text-warning fw-semibold" }
        : { label: bengali ? "উচ্চ ঝুঁকি" : "Higher risk", className: "text-danger fw-semibold" };
  }
  if (record.type === "biomarkers") {
    return { label: bengali ? `${(record.biomarkers || []).length || 0}টি মার্কার` : `${(record.biomarkers || []).length || 0} markers`, className: "text-primary fw-semibold" };
  }
  if (record.type === "model_selection") {
    const risk = Number(record.averageRisk ?? record.avgRisk ?? 0);
    return risk <= 0.35
      ? { label: bengali ? "কম ঝুঁকির নির্বাচন" : "Lower-risk selection", className: "text-success fw-semibold" }
      : risk <= 0.65
        ? { label: bengali ? "মাঝারি ঝুঁকির নির্বাচন" : "Moderate-risk selection", className: "text-warning fw-semibold" }
        : { label: bengali ? "উচ্চ ঝুঁকির নির্বাচন" : "Higher-risk selection", className: "text-danger fw-semibold" };
  }
  return { label: "-", className: "text-secondary fw-semibold" };
}

const renderRecords = () => {
  const records = loadRecords().slice().reverse();
  const typeFilter = document.getElementById("recordTypeFilter")?.value || "all";
  const search = (document.getElementById("recordSearch")?.value || "").trim().toLowerCase();
  const filtered = records.filter((record) => {
    const typeMatch = typeFilter === "all" || record.type === typeFilter;
    const text = JSON.stringify(record).toLowerCase();
    const searchMatch = !search || text.includes(search);
    return typeMatch && searchMatch;
  });
  const table = document.getElementById("recordsTableBody");
  const totalNode = document.getElementById("recordTotalCount");
  const filteredNode = document.getElementById("recordFilteredCount");
  const latestTypeNode = document.getElementById("recordLatestType");
  const latestTimeNode = document.getElementById("recordLatestTime");
  const emptyNode = document.getElementById("recordsEmptyState");
  if (totalNode) totalNode.textContent = String(records.length);
  if (filteredNode) filteredNode.textContent = String(filtered.length);
  if (latestTypeNode) latestTypeNode.textContent = records.length ? recordTypeLabel(records[0].type) : "-";
  if (latestTimeNode) latestTimeNode.textContent = records.length && records[0].timestamp ? new Date(records[0].timestamp).toLocaleString() : "-";
  if (emptyNode) emptyNode.hidden = filtered.length > 0;
  if (table) {
    table.innerHTML = filtered.length
      ? filtered.map((record, index) => `
        <tr class="record-row" data-record-index="${index}">
          <td>${record.timestamp ? new Date(record.timestamp).toLocaleString() : "-"}</td>
          <td>${recordTypeLabel(record.type)}</td>
          <td>${summarizeRecord(record)}</td>
          <td><span class="${getRecordStatusMeta(record).className}">${getRecordStatusMeta(record).label}</span></td>
        </tr>
      `).join("")
      : `<tr><td colspan="4" class="text-muted">${isBengaliUi() ? "বর্তমান ফিল্টারের সাথে কোনো রেকর্ড মেলেনি।" : "No records match the current filter."}</td></tr>`;
    [...table.querySelectorAll(".record-row")].forEach((row) => {
      row.addEventListener("click", () => {
        const idx = Number(row.dataset.recordIndex);
        renderRecordDetail(filtered[idx]);
      });
    });
  }
  if (!filtered.length) {
    renderRecordDetail(null);
  }
};

const GUIDE_CONTENT = {
  screening: {
    title: "Screening Guidance",
    html: `
      <ol>
        <li>Reading Fluency Test সম্পন্ন করুন: Start চাপুন, জোরে পড়ুন, তারপর Stop করুন। দ্বিধাগুলো স্বয়ংক্রিয়ভাবে ধরা হবে।</li>
        <li>স্যাম্পল অডিও নির্বাচন করুন এবং স্বয়ংক্রিয় বিশ্লেষণ শেষ হওয়া পর্যন্ত অপেক্ষা করুন।</li>
        <li>Spelling Test শেষ করে স্কোর দিন।</li>
        <li>চূড়ান্ত স্ক্রিনিং ফল দেখতে Run Screening চাপুন।</li>
      </ol>
      <p><strong>Note:</strong> এটি শুধুমাত্র একটি সহায়ক টুল, চূড়ান্ত চিকিৎসা নির্ণয় নয়।</p>
    `,
  },
  therapy: {
    title: "Speech Therapy Guidance",
    html: `
      <ol>
        <li>থেরাপির ভাষা, সেশন টাইপ, প্র্যাকটিস সাউন্ড, কঠিনতা, এবং সহায়তার স্তর বেছে নিন।</li>
        <li>একবার Start Round চাপুন, দেখানো প্রম্পটটি জোরে পড়ুন, তারপর Speak Now চাপুন।</li>
        <li>প্রতিটি উত্তর সেভ হওয়ার পর পরের প্র্যাকটিস স্বয়ংক্রিয়ভাবে আসবে। কাজ শেষ হলে Finish Round চাপুন।</li>
      </ol>
    `,
  },
  eye: {
    title: "Visual Focus Test Guidance",
    html: `
      <ol>
        <li>একটি মোড বেছে নিন: অক্ষর, সংখ্যা, বা মিশ্র চিহ্ন।</li>
        <li>Start Test চাপুন এবং প্রতিটি রাউন্ডে মিল থাকা চিহ্নটি ট্যাপ করুন।</li>
        <li>শেষ রাউন্ডের পরে ফলাফল বিশ্লেষণ হয়ে স্বয়ংক্রিয়ভাবে সেভ হবে।</li>
      </ol>
    `,
  },
  testlab: {
    title: "Test Lab Guidance",
    html: `
      <ol>
        <li>আগে Screening, Therapy, এবং Visual Focus Test শেষ করুন।</li>
        <li>সেভ হওয়া ফল একত্রে দেখতে Run Model Comparison চাপুন।</li>
        <li>সমন্বিত ফল পেতে Generate Final Report চাপুন।</li>
      </ol>
    `,
  },
  biomarkers: {
    title: "Biomarker Guidance",
    html: `
      <ol>
        <li>সংখ্যাভিত্তিক ফিচার কলাম ও একটি লেবেল কলামসহ CSV আপলোড করুন।</li>
        <li>বিশ্লেষণ চালিয়ে সবচেয়ে বেশি সম্পর্কযুক্ত মার্কারগুলো দেখুন।</li>
      </ol>
    `,
  },
  records: {
    title: "Records Guidance",
    html: `
      <ol>
        <li>সব ফলাফল এই ডিভাইসের লোকাল ব্রাউজার স্টোরেজে সেভ হয়।</li>
        <li>ব্যাকআপ বা রিপোর্টের জন্য Export JSON ব্যবহার করুন।</li>
        <li>লোকাল ইতিহাস মুছতে চাইলে Clear Records চাপুন।</li>
      </ol>
    `,
  },
};

const GUIDE_CONTENT_V2 = {
  screening: {
    title: "Screening Guidance",
    html: `
      <p><strong>English</strong></p>
      <ol>
        <li>Start the reading test, read the sentence aloud, and stop after finishing.</li>
        <li>Play the listening audio and let the system check the answer automatically.</li>
        <li>Complete the spelling answers and wait for the score.</li>
        <li>Click <strong>Run Screening</strong> to see the final screening result.</li>
      </ol>
      <p><strong>বাংলা</strong></p>
      <ol>
        <li>রিডিং টেস্ট শুরু করুন, বাক্যটি জোরে পড়ুন, এবং শেষ হলে বন্ধ করুন।</li>
        <li>লিসেনিং অডিও চালান এবং সিস্টেমকে উত্তর যাচাই করতে দিন।</li>
        <li>স্পেলিংয়ের উত্তরগুলো পূরণ করুন এবং স্কোরের জন্য অপেক্ষা করুন।</li>
        <li><strong>Run Screening</strong> চাপুন, তাহলে চূড়ান্ত স্ক্রিনিং ফল দেখাবে।</li>
      </ol>
      <p><strong>Note:</strong> This is a support tool only. It is not a final medical diagnosis.</p>
    `,
  },
  therapy: {
    title: "Speech Therapy Guidance",
    html: `
      <p><strong>English</strong></p>
      <ol>
        <li>Choose the language, session type, practice item, difficulty, and cue level.</li>
        <li>Click <strong>Start Round</strong>, read the shown prompt aloud, then click <strong>Speak Now</strong>.</li>
        <li>After each response, the next practice item will appear automatically.</li>
        <li>When finished, click <strong>Finish Round</strong> to view the result.</li>
      </ol>
      <p><strong>বাংলা</strong></p>
      <ol>
        <li>ভাষা, সেশন টাইপ, প্র্যাকটিস আইটেম, কঠিনতার মাত্রা, এবং সহায়তার স্তর বেছে নিন।</li>
        <li><strong>Start Round</strong> চাপুন, দেখানো শব্দ বা বাক্যটি জোরে পড়ুন, তারপর <strong>Speak Now</strong> চাপুন।</li>
        <li>প্রতিটি উত্তরের পরে পরের প্র্যাকটিস আইটেম নিজে থেকে আসবে।</li>
        <li>শেষ হলে <strong>Finish Round</strong> চাপুন এবং ফল দেখুন।</li>
      </ol>
    `,
  },
  eye: {
    title: "Visual Focus Test Guidance",
    html: `
      <p><strong>English</strong></p>
      <ol>
        <li>Choose a mode: letters, digits, or mixed symbols.</li>
        <li>Click <strong>Start Test</strong>. The target and test board will activate together.</li>
        <li>Look at the symbol shown in <strong>Round Target</strong>.</li>
        <li>Tap the same symbol on the <strong>Interactive Test Board</strong> as quickly and carefully as possible.</li>
        <li>After all rounds finish, the result will save automatically.</li>
      </ol>
      <p><strong>বাংলা</strong></p>
      <ol>
        <li>একটি মোড বেছে নিন: অক্ষর, সংখ্যা, বা মিশ্র চিহ্ন।</li>
        <li><strong>Start Test</strong> চাপুন। তখন টার্গেট এবং টেস্ট বোর্ড একসাথে চালু হবে।</li>
        <li><strong>Round Target</strong>-এ দেখানো চিহ্নটি ভালো করে দেখুন।</li>
        <li><strong>Interactive Test Board</strong> থেকে একই চিহ্ন যত দ্রুত ও ঠিকভাবে পারেন চাপুন।</li>
        <li>সব রাউন্ড শেষ হলে ফল নিজে থেকে সেভ হবে।</li>
      </ol>
    `,
  },
  testlab: {
    title: "Test Lab Guidance",
    html: `
      <p><strong>English</strong></p>
      <ol>
        <li>Complete Screening, Speech Therapy, and Visual Focus Test first.</li>
        <li>Click <strong>Run Model Comparison</strong> to compare the saved test results.</li>
        <li>Then click <strong>Generate Final Report</strong> to see the combined outcome.</li>
      </ol>
      <p><strong>বাংলা</strong></p>
      <ol>
        <li>আগে Screening, Speech Therapy, এবং Visual Focus Test শেষ করুন।</li>
        <li>সেভ হওয়া ফলগুলো তুলনা করতে <strong>Run Model Comparison</strong> চাপুন।</li>
        <li>তারপর মিলিত ফল দেখতে <strong>Generate Final Report</strong> চাপুন।</li>
      </ol>
    `,
  },
  biomarkers: {
    title: "Biomarker Guidance",
    html: `
      <p><strong>English</strong></p>
      <ol>
        <li>Upload a CSV file with numeric feature columns and one label column.</li>
        <li>Select the correct label column name if needed.</li>
        <li>Click <strong>Run Analysis</strong> to find the most useful markers.</li>
        <li>Read the summary and review the important features shown below.</li>
      </ol>
      <p><strong>বাংলা</strong></p>
      <ol>
        <li>সংখ্যাভিত্তিক ফিচার কলাম ও একটি লেবেল কলামসহ CSV ফাইল আপলোড করুন।</li>
        <li>প্রয়োজনে সঠিক লেবেল কলামের নাম নির্বাচন করুন।</li>
        <li><strong>Run Analysis</strong> চাপুন, সিস্টেম গুরুত্বপূর্ণ মার্কার বের করবে।</li>
        <li>সারাংশ এবং নিচে দেখানো গুরুত্বপূর্ণ ফিচারগুলো দেখুন।</li>
      </ol>
    `,
  },
  records: {
    title: "Records Guidance",
    html: `
      <p><strong>English</strong></p>
      <ol>
        <li>All results are saved in this browser on this device.</li>
        <li>Use <strong>Export JSON</strong> if you want a backup copy.</li>
        <li>Use search or filters to find older records quickly.</li>
        <li>Click <strong>Clear Records</strong> only if you want to remove the saved local history.</li>
      </ol>
      <p><strong>বাংলা</strong></p>
      <ol>
        <li>সব ফল এই ডিভাইসের ব্রাউজারেই সেভ থাকে।</li>
        <li>ব্যাকআপ রাখতে চাইলে <strong>Export JSON</strong> ব্যবহার করুন।</li>
        <li>পুরনো রেকর্ড খুঁজতে সার্চ বা ফিল্টার ব্যবহার করুন।</li>
        <li>লোকাল ইতিহাস মুছতে চাইলে তবেই <strong>Clear Records</strong> চাপুন।</li>
      </ol>
    `,
  },
};

GUIDE_CONTENT_V2.testlab = {
  title: "Test Lab & Report Guidance",
  html: `
    <p><strong>English</strong></p>
    <ol>
      <li>First complete the Screening, Speech Therapy, and Visual Focus Test sections.</li>
      <li>Then come to this section and fill in the student's details carefully.</li>
      <li>Click <strong>Run Model Comparison</strong> to combine the saved results.</li>
      <li>Check the comparison table and summary shown on the screen.</li>
      <li>Click <strong>Generate Final Report</strong> to prepare the final report.</li>
      <li>Finally, click <strong>Download Report PDF</strong> to save the report with the student details included automatically.</li>
    </ol>
      <p><strong>বাংলা</strong></p>
      <ol>
        <li>প্রথমে Screening, Speech Therapy, এবং Visual Focus Test অংশগুলো শেষ করুন।</li>
        <li>তারপর এই অংশে এসে শিক্ষার্থীর তথ্য ঠিকভাবে পূরণ করুন।</li>
        <li>সেভ হওয়া ফল একসাথে দেখতে <strong>Run Model Comparison</strong> চাপুন।</li>
        <li>স্ক্রিনে দেখানো তুলনামূলক টেবিল ও সারাংশ দেখে নিন।</li>
        <li>চূড়ান্ত রিপোর্ট তৈরি করতে <strong>Generate Final Report</strong> চাপুন।</li>
        <li>সবশেষে <strong>Download Report PDF</strong> চাপলে শিক্ষার্থীর তথ্যসহ রিপোর্ট পিডিএফ আকারে সেভ হবে।</li>
      </ol>
  `,
};

function getDashboardLanguage() {
  return document.getElementById("sampleLanguage")?.value || "English";
}

function isBengaliUi(language = getDashboardLanguage()) {
  return language === "Bengali";
}

function setText(selector, value) {
  const node = document.querySelector(selector);
  if (node) node.textContent = value;
}

function setSelectOptions(selectId, options, selectedValue) {
  const select = document.getElementById(selectId);
  if (!select) return;
  const currentValue = selectedValue ?? select.value;
  select.innerHTML = options.map(({ value, label }) => `<option value="${value}">${label}</option>`).join("");
  if (options.some((option) => option.value === currentValue)) {
    select.value = currentValue;
  }
}

function setScreeningResult(content) {
  const node = document.getElementById("screeningResult");
  const row = document.getElementById("screeningOutputRow");
  if (!node) return;
  if (row) row.classList.remove("d-none");
  node.innerHTML = content;
}

function setScreeningChartVisible(visible) {
  const node = document.getElementById("screeningChartWrap");
  if (!node) return;
  node.classList.toggle("d-none", !visible);
}

function getNextRoundLabel(roundKey = "screening", language = getDashboardLanguage()) {
  const bengali = isBengaliUi(language);
  const map = bengali
    ? {
        screening: "স্পিচ থেরাপি",
        therapy: "ভিজ্যুয়াল ফোকাস টেস্ট",
        eye: "টেস্ট ল্যাব ও রিপোর্ট",
        testlab: "বায়োমার্কার্স",
        biomarkers: "রেকর্ডস",
      }
      : {
          screening: "Speech Therapy",
          therapy: "Visual Focus Test",
          eye: "Test Lab & Report",
          testlab: "Records",
          biomarkers: "Records",
        };
  return map[roundKey] || (bengali ? "পরবর্তী ধাপ" : "Next round");
}

function renderSecurityBanner() {
  const host = window.location.hostname || "";
  const secureEnough = window.isSecureContext || host === "localhost" || host === "127.0.0.1";
  let banner = document.getElementById("securityWarningBanner");
  if (!secureEnough) {
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "securityWarningBanner";
      banner.className = "alert alert-danger mx-3 mt-3 mb-0";
      banner.setAttribute("role", "alert");
      const nav = document.querySelector(".navbar");
      if (nav && nav.parentNode) {
        nav.insertAdjacentElement("afterend", banner);
      } else {
        document.body.prepend(banner);
      }
    }
    banner.textContent = "This page is open on an insecure origin. Microphone access works only when you open it from localhost or HTTPS. Use the local launcher instead of opening the HTML file directly.";
  } else if (banner) {
    banner.remove();
  }
}

function applyDashboardLanguage(language = getDashboardLanguage()) {
  const bengali = isBengaliUi(language);

  const navLabels = bengali
    ? ["স্ক্রিনিং", "স্পিচ থেরাপি", "ভিজুয়াল ফোকাস টেস্ট", "টেস্ট ল্যাব ও রিপোর্ট", "রেকর্ডস", "মডেল পরিসংখ্যান"]
    : ["Screening", "Speech Therapy", "Visual Focus Test", "Test Lab & Report", "Records", "Model statistics"];
  const navIcons = ["bi-clipboard2-pulse", "bi-soundwave", "bi-eye", "bi-bar-chart-steps", "bi-journal-text", "bi-graph-up-arrow"];
  tabButtons.forEach((button, index) => {
    button.innerHTML = `<i class="bi ${navIcons[index]} me-2"></i>${navLabels[index]}`;
  });

  const sectionTitles = bengali
    ? {
        screening: "স্বয়ংক্রিয় স্ক্রিনিং ওয়ার্কফ্লো",
        therapy: "স্পিচ থেরাপি সেশন অ্যানালাইজার",
        eye: "ভিজুয়াল ফোকাস টেস্ট",
        testlab: "এন্ড-ইউজার ফুল টেস্ট ল্যাব ও রিপোর্ট",
        biomarkers: "ডিজিটাল বায়োমার্কার ডিসকভারি (ক্লায়েন্ট-সাইড)",
        records: "সংরক্ষিত সেশন",
        modelstats: "মডেল পরিসংখ্যান",
      }
    : {
        screening: "Automated Screening Workflow",
        therapy: "Speech Therapy Session Analyzer",
        eye: "Visual Focus Test",
        testlab: "Full Test Lab & Report",
        biomarkers: "Digital Biomarker Discovery (Client-side)",
        records: "Saved Sessions",
        modelstats: "Model statistics",
      };
  Object.entries(sectionTitles).forEach(([sectionId, title]) => setText(`#${sectionId} h5`, title));

  document.querySelectorAll(".user-guide-btn").forEach((button) => {
    button.textContent = bengali ? "নির্দেশনা" : "User Guidance";
  });

  const sectionMessages = {
    screening: "",
    therapy: bengali
      ? "এই অংশটি একটি নির্দেশিত কথা বলার অনুশীলন চালায়। রাউন্ড শুরু করুন, প্রম্পটটি উচ্চস্বরে পড়ুন, এবং ড্যাশবোর্ড স্বয়ংক্রিয়ভাবে ফল সংগ্রহ করবে।"
      : "This section runs a guided speaking practice round. Start the round, say the prompt aloud, and the dashboard will collect the result automatically.",
    eye: bengali
      ? "এখানে একটি সহজ অন-স্ক্রিন প্রতীক পরীক্ষা চালান। ফলাফল স্বয়ংক্রিয়ভাবে স্কোর হয় এবং চূড়ান্ত রিপোর্টের জন্য ব্যাকগ্রাউন্ডে সংরক্ষিত হয়।"
      : "Run a simple on-screen symbol test here. The result is scored automatically and saved in the background for the final report.",
    testlab: bengali
      ? "রিপোর্ট এলাকা: এই অংশে শিক্ষার্থীর তথ্য পূরণ করুন, তুলনা চালান, তারপর চূড়ান্ত PDF রিপোর্ট তৈরি ও ডাউনলোড করুন।"
      : "Report Area: Fill the student details in this section, run the comparison, then generate and download the final PDF report.",
    biomarkers: bengali
      ? "একটি CSV ডেটাসেট আপলোড করুন এবং ড্যাশবোর্ড পড়া, কথা বলা, হাতের লেখা, সময়, এবং ভিজ্যুয়াল মার্কারগুলোকে সহজভাবে দেখাবে।"
      : "Upload one dataset CSV file and the dashboard will highlight the strongest reading, speech, handwriting, timing, and visual markers in a simple way.",
    records: bengali
      ? "সেভ করা স্ক্রিনিং, থেরাপি, ভিজ্যুয়াল ফোকাস, বায়োমার্কার, এবং ফাইনাল রিপোর্ট সেশন এক জায়গায় দেখুন।"
      : "Review saved screening, therapy, eye-tracking, biomarker, and final report sessions in one place.",
    modelstats: "",
  };
  const screeningBanner = document.querySelector("#screening .alert-primary");
  if (screeningBanner) {
    if (sectionMessages.screening) {
      screeningBanner.textContent = sectionMessages.screening;
      screeningBanner.classList.remove("d-none");
    } else {
      screeningBanner.classList.add("d-none");
    }
  }
  setText("#therapy .alert-primary", sectionMessages.therapy);
  setText("#eye .alert-primary", sectionMessages.eye);
  setText("#testlab .alert-success", sectionMessages.testlab);
  setText("#biomarkers .alert-primary", sectionMessages.biomarkers);
  setText("#records .alert-primary", sectionMessages.records);
  const modelStatsBanner = document.querySelector("#modelstats .alert-info");
  if (modelStatsBanner) {
    if (sectionMessages.modelstats) {
      modelStatsBanner.textContent = sectionMessages.modelstats;
      modelStatsBanner.classList.remove("d-none");
    } else {
      modelStatsBanner.classList.add("d-none");
    }
  }
  const screeningAlerts = document.querySelectorAll("#screening .alert-info");
  if (screeningAlerts[0]) screeningAlerts[0].textContent = bengali
    ? "স্বয়ংক্রিয় মোড: শুরু চাপুন এবং মাইক্রোফোন অ্যাক্সেস দিন। সিস্টেম শোনার পরে আপনি বন্ধ করলে স্কোর দেবে।"
    : "Auto Mode: Click Start and allow microphone access. The system will listen automatically and score the reading when you click Stop.";
  if (screeningAlerts[1]) screeningAlerts[1].textContent = bengali
    ? "স্বয়ংক্রিয় মোড: প্লে অডিও চাপুন, একবার শুনুন, তারপর সেরা উত্তরটি বেছে নিন। স্কোর স্বয়ংক্রিয়ভাবে তৈরি হবে।"
    : "Auto Mode: Click Play Audio, listen once, then choose the best answer. The score is generated automatically.";

  const screeningTableHeaders = document.querySelectorAll("#screening .score-matrix-table thead th");
  if (screeningTableHeaders[0]) screeningTableHeaders[0].textContent = bengali ? "সেগমেন্ট" : "Segment";
  if (screeningTableHeaders[1]) screeningTableHeaders[1].textContent = bengali ? "স্কোর" : "Score";
  if (screeningTableHeaders[2]) screeningTableHeaders[2].textContent = bengali ? "সীমা" : "Threshold";
  if (screeningTableHeaders[3]) screeningTableHeaders[3].textContent = bengali ? "অবস্থা" : "Status";

  const testLabHeaders = document.querySelectorAll("#testlab table thead th");
  if (testLabHeaders[0]) testLabHeaders[0].textContent = bengali ? "মডেল" : "Model";
  if (testLabHeaders[1]) testLabHeaders[1].textContent = bengali ? "অনুমানিত স্তর" : "Predicted Level";
  if (testLabHeaders[2]) testLabHeaders[2].textContent = bengali ? "অনুমানিত আত্মবিশ্বাস" : "Estimated Confidence";
  if (testLabHeaders[3]) testLabHeaders[3].textContent = bengali ? "ঝুঁকি স্কোর" : "Risk Score";
  if (testLabHeaders[4]) testLabHeaders[4].textContent = bengali ? "ক্লিনিকাল নোট" : "Clinical Note";

  const biomarkerHeaders = document.querySelectorAll("#biomarkers table thead th");
  if (biomarkerHeaders[0]) biomarkerHeaders[0].textContent = bengali ? "বায়োমার্কার" : "Biomarker";
  if (biomarkerHeaders[1]) biomarkerHeaders[1].textContent = bengali ? "পরিবার" : "Family";
  if (biomarkerHeaders[2]) biomarkerHeaders[2].textContent = bengali ? "সহসম্বন্ধ" : "Correlation";
  if (biomarkerHeaders[3]) biomarkerHeaders[3].textContent = bengali ? "গুরুত্ব" : "Importance";
  if (biomarkerHeaders[4]) biomarkerHeaders[4].textContent = bengali ? "ব্যাখ্যা" : "Interpretation";

  const recordsHeaders = document.querySelectorAll("#records table thead th");
  if (recordsHeaders[0]) recordsHeaders[0].textContent = bengali ? "সময়" : "Time";
  if (recordsHeaders[1]) recordsHeaders[1].textContent = bengali ? "ধরন" : "Type";
  if (recordsHeaders[2]) recordsHeaders[2].textContent = bengali ? "সারাংশ" : "Summary";
  if (recordsHeaders[3]) recordsHeaders[3].textContent = bengali ? "অবস্থা" : "Status";
  const recordTotalLabel = document.getElementById("recordTotalLabel");
  if (recordTotalLabel) recordTotalLabel.textContent = bengali ? "মোট রেকর্ড" : "Total Records";
  const recordFilteredLabel = document.getElementById("recordFilteredLabel");
  if (recordFilteredLabel) recordFilteredLabel.textContent = bengali ? "ফিল্টারকৃত ফলাফল" : "Filtered Results";
  const recordLatestLabel = document.getElementById("recordLatestLabel");
  if (recordLatestLabel) recordLatestLabel.textContent = bengali ? "সর্বশেষ এন্ট্রি" : "Latest Entry";
  const recordSavedLabel = document.getElementById("recordSavedLabel");
  if (recordSavedLabel) recordSavedLabel.textContent = bengali ? "শেষ সংরক্ষণ" : "Last Saved";
  const recordsEmptyStateText = document.getElementById("recordsEmptyStateText");
  if (recordsEmptyStateText) recordsEmptyStateText.textContent = bengali
    ? "এখনও কোনো সংরক্ষিত সেশন নেই। ইতিহাস তৈরি শুরু করতে একটি টেস্ট চালান।"
    : "No saved sessions yet. Run a test to start building your local history.";

  const sectionStrongLabels = document.querySelectorAll("#screening .result-card > p.mb-2 strong");
  if (sectionStrongLabels[0]) sectionStrongLabels[0].textContent = bengali ? "পড়ার সাবলীলতা পরীক্ষা" : "Reading Fluency Test";
  if (sectionStrongLabels[1]) sectionStrongLabels[1].textContent = bengali ? "অডিও পরীক্ষা (স্বয়ংক্রিয়)" : "Audio Test (Automatic)";
  if (sectionStrongLabels[2]) sectionStrongLabels[2].textContent = bengali ? "বানান পরীক্ষা (স্বয়ংক্রিয় স্কোরিং)" : "Spelling Test (Automatic Scoring)";
  const readingAutoScoreLabel = document.getElementById("readingAutoScoreLabel");
  if (readingAutoScoreLabel) readingAutoScoreLabel.textContent = bengali ? "স্বয়ংক্রিয় স্কোর:" : "Auto Score:";
  const spellingAutoScoreLabel = document.getElementById("spellingAutoScoreLabel");
  if (spellingAutoScoreLabel) spellingAutoScoreLabel.textContent = bengali ? "বানানের স্কোর:" : "Spelling Score:";
  const readingPassThresholdLabel = document.getElementById("readingPassThresholdLabel");
  if (readingPassThresholdLabel) readingPassThresholdLabel.textContent = bengali ? "পাসের সীমা:" : "Passing Threshold:";
  const readingPassResultLabel = document.getElementById("readingPassResultLabel");
  if (readingPassResultLabel) readingPassResultLabel.textContent = bengali ? "ফলাফল:" : "Result:";
  const audioAutoScoreLabel = document.getElementById("audioAutoScoreLabel");
  if (audioAutoScoreLabel) audioAutoScoreLabel.textContent = bengali ? "শোনার স্কোর:" : "Listening Score:";
  const audioPassThresholdLabel = document.getElementById("audioPassThresholdLabel");
  if (audioPassThresholdLabel) audioPassThresholdLabel.textContent = bengali ? "পাসের সীমা:" : "Passing Threshold:";
  const audioPassResultLabel = document.getElementById("audioPassResultLabel");
  if (audioPassResultLabel) audioPassResultLabel.textContent = bengali ? "ফলাফল:" : "Result:";
  const spellingPassThresholdLabel = document.getElementById("spellingPassThresholdLabel");
  if (spellingPassThresholdLabel) spellingPassThresholdLabel.textContent = bengali ? "পাসের সীমা:" : "Passing Threshold:";
  const spellingPassResultLabel = document.getElementById("spellingPassResultLabel");
  if (spellingPassResultLabel) spellingPassResultLabel.textContent = bengali ? "ফলাফল:" : "Result:";
  const overallSegmentScoreLabel = document.getElementById("overallSegmentScoreLabel");
  if (overallSegmentScoreLabel) overallSegmentScoreLabel.textContent = bengali ? "মোট স্কোর:" : "Overall Score:";
  const overallSegmentStatusLabel = document.getElementById("overallSegmentStatusLabel");
  if (overallSegmentStatusLabel) overallSegmentStatusLabel.textContent = bengali ? "সামগ্রিক অবস্থা:" : "Overall Status:";
  const matrixReadingLabel = document.getElementById("matrixReadingLabel");
  if (matrixReadingLabel) matrixReadingLabel.textContent = bengali ? "পড়া" : "Reading";
  const matrixAudioLabel = document.getElementById("matrixAudioLabel");
  if (matrixAudioLabel) matrixAudioLabel.textContent = bengali ? "অডিও" : "Audio";
  const matrixSpellingLabel = document.getElementById("matrixSpellingLabel");
  if (matrixSpellingLabel) matrixSpellingLabel.textContent = bengali ? "বানান" : "Spelling";
  const segmentScoringMatrixTitle = document.getElementById("segmentScoringMatrixTitle");
  if (segmentScoringMatrixTitle) segmentScoringMatrixTitle.textContent = bengali ? "সেগমেন্টভিত্তিক স্কোরিং ম্যাট্রিক্স" : "Segment-wise Scoring Matrix";
  const matrixReadingStatus = document.getElementById("matrixReadingStatus");
  if (matrixReadingStatus) matrixReadingStatus.textContent = bengali ? "অপেক্ষমাণ" : "Pending";
  const matrixAudioStatus = document.getElementById("matrixAudioStatus");
  if (matrixAudioStatus) matrixAudioStatus.textContent = bengali ? "অপেক্ষমাণ" : "Pending";
  const matrixSpellingStatus = document.getElementById("matrixSpellingStatus");
  if (matrixSpellingStatus) matrixSpellingStatus.textContent = bengali ? "অপেক্ষমাণ" : "Pending";
  const readingTestStatus = document.getElementById("readingTestStatus");
  if (readingTestStatus && !readingTestState.done) {
    readingTestStatus.textContent = bengali ? "এখনও শুরু হয়নি।" : "Not started.";
  }
  const therapyRoundLabel = document.querySelector("#therapy .result-card > .d-flex > p strong");
  if (therapyRoundLabel) therapyRoundLabel.textContent = bengali ? "লাইভ থেরাপি রাউন্ড" : "Live Therapy Round";
  const therapyEasyStepsTitle = document.getElementById("therapyEasyStepsTitle");
  if (therapyEasyStepsTitle) therapyEasyStepsTitle.textContent = bengali ? "সহজ ধাপ" : "Easy Steps";
  const therapyCurrentPromptTitle = document.getElementById("therapyCurrentPromptTitle");
  if (therapyCurrentPromptTitle) therapyCurrentPromptTitle.textContent = bengali ? "বর্তমান প্রম্পট" : "Current Prompt";
  const therapyRecognizedResponseTitle = document.getElementById("therapyRecognizedResponseTitle");
  if (therapyRecognizedResponseTitle) therapyRecognizedResponseTitle.textContent = bengali ? "শনাক্তকৃত উত্তর" : "Recognized Response";
  const therapyEasyStep1 = document.getElementById("therapyEasyStep1");
  const therapyEasyStep2 = document.getElementById("therapyEasyStep2");
  const therapyEasyStep3 = document.getElementById("therapyEasyStep3");
  const therapyEasyStep4 = document.getElementById("therapyEasyStep4");
  if (therapyEasyStep1) therapyEasyStep1.innerHTML = bengali ? "একবার <strong>রাউন্ড শুরু</strong> চাপুন।" : "Click <strong>Start Round</strong> once.";
  if (therapyEasyStep2) therapyEasyStep2.innerHTML = bengali ? "মাইক্রোফোন শুনতে শুরু করলে দেখানো প্রম্পটটি উচ্চস্বরে পড়ুন।" : "Read the shown prompt aloud when the mic starts listening.";
  if (therapyEasyStep3) therapyEasyStep3.innerHTML = bengali ? "প্রতিটি উত্তরের পরে প্রম্পটটি স্বয়ংক্রিয়ভাবে বদলে যায়।" : "After each response, the prompt changes automatically.";
  if (therapyEasyStep4) therapyEasyStep4.innerHTML = bengali ? "এরপর সিস্টেম স্বয়ংক্রিয়ভাবে পরের প্রম্পটের জন্য শুনতে থাকে।" : "The system then listens for the next prompt automatically.";
  const therapyPromptText = document.getElementById("therapyPromptText");
  if (therapyPromptText && !therapyRoundState.active) {
    therapyPromptText.textContent = bengali
      ? "প্রথম থেরাপি প্রম্পট পেতে রাউন্ড শুরু চাপুন।"
      : "Press Start Round to generate the first therapy prompt.";
  }
  const therapyRoundProgress = document.getElementById("therapyRoundProgress");
  if (therapyRoundProgress && !therapyRoundState.active) {
    therapyRoundProgress.textContent = bengali ? "রাউন্ড শুরু হয়নি।" : "Round not started.";
  }
  const therapyRoundStatus = document.getElementById("therapyRoundStatus");
  if (therapyRoundStatus && !therapyRoundState.active) {
    therapyRoundStatus.textContent = bengali
      ? "সিস্টেম প্রতিটি উচ্চারিত উত্তর শুনবে এবং সেশন মান স্বয়ংক্রিয়ভাবে পূরণ করবে।"
      : "The system will listen to each spoken response and fill the session values automatically.";
  }
  const therapyTranscriptText = document.getElementById("therapyTranscriptText");
  if (therapyTranscriptText && !therapyRoundState.active) {
    therapyTranscriptText.textContent = bengali ? "এখনও কোনো উত্তর ধরা হয়নি।" : "No response captured yet.";
    therapyTranscriptText.className = "mb-0 small text-muted";
  }

  const eyeHowToUseTitle = document.getElementById("eyeHowToUseTitle");
  if (eyeHowToUseTitle) eyeHowToUseTitle.textContent = bengali ? "কীভাবে ব্যবহার করবেন" : "How To Use";
  const eyeHowToUseStep1 = document.getElementById("eyeHowToUseStep1");
  const eyeHowToUseStep2 = document.getElementById("eyeHowToUseStep2");
  const eyeHowToUseStep3 = document.getElementById("eyeHowToUseStep3");
  const eyeHowToUseStep4 = document.getElementById("eyeHowToUseStep4");
  if (eyeHowToUseStep1) eyeHowToUseStep1.textContent = bengali ? "অক্ষর, সংখ্যা, বা মিশ্র প্রতীক থেকে একটি টেস্ট মোড বেছে নিন।" : "Choose a test mode like letters, digits, or mixed symbols.";
  if (eyeHowToUseStep2) eyeHowToUseStep2.innerHTML = bengali ? "<strong>পরীক্ষা শুরু</strong> চাপুন।" : "Press <strong>Start Test</strong>.";
  if (eyeHowToUseStep3) eyeHowToUseStep3.textContent = bengali
    ? "প্রতিটি রাউন্ডে মিল থাকা চিহ্নটি যত দ্রুত এবং সঠিকভাবে সম্ভব ট্যাপ করুন। আরও নির্ভরযোগ্য সামঞ্জস্য স্কোর পেতে এখন প্রতিটি টেস্ট ২০ থেকে ২৪ রাউন্ড চলে।"
    : "Tap the matching symbol in each round as quickly and accurately as you can. Each test now runs for 20 to 24 rounds to give a more reliable consistency score.";
  if (eyeHowToUseStep4) eyeHowToUseStep4.textContent = bengali
    ? "শেষ রাউন্ড শেষ হলে ফলাফল বিশ্লেষণ করা হয় এবং স্বয়ংক্রিয়ভাবে সংরক্ষিত হয়।"
    : "When the last round finishes, the result is analyzed and saved automatically.";

  const eyeRoundTargetLabel = document.getElementById("eyeRoundTargetLabel");
  if (eyeRoundTargetLabel) eyeRoundTargetLabel.textContent = bengali ? "রাউন্ড লক্ষ্য" : "Round Target";
  const eyeRoundTargetHelp = document.getElementById("eyeRoundTargetHelp");
  if (eyeRoundTargetHelp) eyeRoundTargetHelp.textContent = bengali ? "উত্তর গ্রিড থেকে একই চিহ্নটি ট্যাপ করুন।" : "Tap the same symbol from the answer grid.";
  const eyeInteractiveBoardLabel = document.getElementById("eyeInteractiveBoardLabel");
  if (eyeInteractiveBoardLabel) eyeInteractiveBoardLabel.textContent = bengali ? "ইন্টারেকটিভ টেস্ট বোর্ড" : "Interactive Test Board";
  const eyeOverallScoreLabel = document.getElementById("eyeOverallScoreLabel");
  if (eyeOverallScoreLabel) eyeOverallScoreLabel.textContent = bengali ? "ভিজ্যুয়াল ফোকাস স্কোর:" : "Visual Focus Score:";
  const eyeOverallStatusLabel = document.getElementById("eyeOverallStatusLabel");
  if (eyeOverallStatusLabel) eyeOverallStatusLabel.textContent = bengali ? "সামগ্রিক ভিজ্যুয়াল অবস্থা:" : "Overall Visual Status:";
  const eyeSessionStatus = document.getElementById("eyeSessionStatus");
  if (eyeSessionStatus && !eyeTestState.active) {
    eyeSessionStatus.textContent = bengali ? "এখনও কোনো পরীক্ষা সম্পন্ন হয়নি।" : "No test completed yet.";
  }
  const eyeRecommendation = document.getElementById("eyeRecommendation");
  if (eyeRecommendation && !eyeTestState.active) {
    eyeRecommendation.innerHTML = `<p class="mb-0 text-muted">${bengali ? "পরীক্ষা বিশ্লেষণের পরে এখানে সহজ ভাষায় সুপারিশ দেখাবে।" : "A plain-language recommendation will appear here after the test is analyzed."}</p>`;
  }
  if (!eyeTestState.active) {
    setNodeText("eyeOverallStatus", bengali ? "অপেক্ষমাণ" : "Pending", "text-secondary fw-semibold");
  }
  const eyeTestProgress = document.getElementById("eyeTestProgress");
  if (eyeTestProgress && !eyeTestState.active) {
    eyeTestProgress.textContent = bengali ? "শুরু করতে পরীক্ষা শুরু চাপুন।" : "Press Start Test to begin.";
  }
  const eyeTestStatus = document.getElementById("eyeTestStatus");
  if (eyeTestStatus && !eyeTestState.active) {
    eyeTestStatus.textContent = bengali ? "নতুন ভিজ্যুয়াল ফোকাস টেস্টের জন্য প্রস্তুত।" : "Ready for a new visual focus test.";
  }

  const screeningButtons = [
    ["#startReadingTest", bengali ? "শুরু" : "Start"],
    ["#markHesitation", bengali ? "স্বয়ংক্রিয় দ্বিধা" : "Auto Hesitation"],
    ["#stopReadingTest", bengali ? "বন্ধ" : "Stop"],
    ["#playAudioParagraph", bengali ? "অডিও চালান" : "Play Audio"],
    ["#verifyAudioAnswer", bengali ? "উত্তর জমা দিন" : "Submit Answer"],
    ["#reloadAudioParagraph", bengali ? "স্কিপ" : "Skip"],
    ["#scoreSpellingTest", bengali ? "ম্যানুয়াল স্কোর" : "Manual Score"],
    ["#runScreening", bengali ? "ম্যানুয়াল রিফ্রেশ স্ক্রিনিং" : "Manual Refresh Screening"],
    ["#startTherapyRound", bengali ? "রাউন্ড শুরু" : "1. Start Round"],
    ["#captureTherapyResponse", bengali ? "উত্তর আবার শুনুন" : "2. Retry Listening"],
    ["#startEyeVisualTest", bengali ? "পরীক্ষা শুরু" : "Start Test"],
    ["#resetEyeVisualTest", bengali ? "রিসেট" : "Reset"],
    ["#runComparison", bengali ? "মডেল তুলনা চালান" : "Run Model Comparison"],
    ["#generateFinal", bengali ? "চূড়ান্ত রিপোর্ট তৈরি করুন" : "Generate Final Report"],
    ["#downloadFinalPdf", bengali ? "রিপোর্ট PDF ডাউনলোড করুন" : "Download Report PDF"],
    ["#runBiomarkers", bengali ? "বায়োমার্কার বিশ্লেষণ" : "Analyze Biomarkers"],
    ["#resetBiomarkers", bengali ? "রিসেট" : "Reset"],
    ["#exportJson", bengali ? "JSON রপ্তানি" : "Export JSON"],
    ["#clearRecords", bengali ? "রেকর্ড মুছুন" : "Clear Records"],
  ];
  screeningButtons.forEach(([selector, label]) => setText(selector, label));

  const screeningFormLabels = document.querySelectorAll("#screening .form-label");
  if (screeningFormLabels[0]) screeningFormLabels[0].textContent = bengali ? "নমুনার ভাষা" : "Sample Language";
  if (screeningFormLabels[1]) screeningFormLabels[1].textContent = bengali ? "পড়ার অনুচ্ছেদ" : "Reading Prompt";

  const therapyFormLabels = document.querySelectorAll("#therapy .form-label");
  if (therapyFormLabels[0]) therapyFormLabels[0].textContent = bengali ? "থেরাপির ভাষা" : "Therapy Language";
  if (therapyFormLabels[1]) therapyFormLabels[1].textContent = bengali ? "সেশন ধরন" : "Session Type";
  if (therapyFormLabels[2]) therapyFormLabels[2].textContent = bengali ? "অনুশীলনের শব্দ" : "Practice Sound";
  if (therapyFormLabels[3]) therapyFormLabels[3].textContent = bengali ? "কঠিনতা" : "Difficulty";
  if (therapyFormLabels[4]) therapyFormLabels[4].textContent = bengali ? "ইঙ্গিত সহায়তা" : "Cue Support";
  if (therapyFormLabels[5]) therapyFormLabels[5].textContent = bengali ? "সময়কাল (স্বয়ংক্রিয় সেকেন্ড)" : "Duration (Auto Seconds)";
  if (therapyFormLabels[6]) therapyFormLabels[6].textContent = bengali ? "সফল ট্রায়াল (স্বয়ংক্রিয়)" : "Successful Trials (Auto)";
  if (therapyFormLabels[7]) therapyFormLabels[7].textContent = bengali ? "মোট ট্রায়াল (স্বয়ংক্রিয়)" : "Total Trials (Auto)";
  if (therapyFormLabels[8]) therapyFormLabels[8].textContent = bengali ? "উচ্চারণ ত্রুটি (স্বয়ংক্রিয়)" : "Pronunciation Errors (Auto)";
  if (therapyFormLabels[9]) therapyFormLabels[9].textContent = bengali ? "অক্ষরাংশ পুনরাবৃত্তি (স্বয়ংক্রিয়)" : "Syllable Repetitions (Auto)";
  if (therapyFormLabels[10]) therapyFormLabels[10].textContent = bengali ? "ধ্বনি প্রতিস্থাপন (স্বয়ংক্রিয়)" : "Sound Substitutions (Auto)";
  if (therapyFormLabels[11]) therapyFormLabels[11].textContent = bengali ? "স্ব-সংশোধন (স্বয়ংক্রিয়)" : "Self-Corrections (Auto)";
  if (therapyFormLabels[12]) therapyFormLabels[12].textContent = bengali ? "মনোযোগ রেটিং (স্বয়ংক্রিয় 1-5)" : "Attention Rating (Auto 1-5)";
  if (therapyFormLabels[13]) therapyFormLabels[13].textContent = bengali ? "শ্বাস/কণ্ঠস্বর নিয়ন্ত্রণ (স্বয়ংক্রিয় 1-5)" : "Breath/Voice Control (Auto 1-5)";
  if (therapyFormLabels[14]) therapyFormLabels[14].textContent = bengali ? "বোধগম্যতা রেটিং (স্বয়ংক্রিয় 1-5)" : "Intelligibility Rating (Auto 1-5)";

  const eyeFormLabels = document.querySelectorAll("#eye .form-label");
  if (eyeFormLabels[0]) eyeFormLabels[0].textContent = bengali ? "পরীক্ষার ধরন" : "Test Mode";
  if (eyeFormLabels[1]) eyeFormLabels[1].textContent = bengali ? "পূর্বরূপ নির্দেশনা" : "Preset Guidance";

  const testLabFormLabels = document.querySelectorAll("#testlab .form-label");
  if (testLabFormLabels[0]) testLabFormLabels[0].textContent = bengali ? "শিক্ষার্থীর নাম" : "Student Name";
  if (testLabFormLabels[1]) testLabFormLabels[1].textContent = bengali ? "বয়স" : "Age";
  if (testLabFormLabels[2]) testLabFormLabels[2].textContent = bengali ? "শ্রেণি" : "Class";
  if (testLabFormLabels[3]) testLabFormLabels[3].textContent = bengali ? "রোল নং" : "Roll No";
  if (testLabFormLabels[4]) testLabFormLabels[4].textContent = bengali ? "সেকশন" : "Section";
  if (testLabFormLabels[5]) testLabFormLabels[5].textContent = bengali ? "বিদ্যালয়ের নাম" : "School Name";
  const reportStudentCardTitle = document.getElementById("reportStudentCardTitle");
  if (reportStudentCardTitle) reportStudentCardTitle.textContent = bengali ? "শিক্ষার্থীর রিপোর্টের বিবরণ" : "Student Report Details";
  const reportStudentCardHelp = document.getElementById("reportStudentCardHelp");
  if (reportStudentCardHelp) reportStudentCardHelp.textContent = bengali
    ? "রিপোর্ট তৈরির আগে শিক্ষক, অভিভাবক, বা পরীক্ষার দায়িত্বপ্রাপ্ত ব্যক্তি এই তথ্যগুলো পূরণ করবেন। এগুলো PDF-এ স্বয়ংক্রিয়ভাবে অন্তর্ভুক্ত হবে।"
    : "The teacher, parent, or test correspondent should fill these details before generating the report. These details will be included automatically in the PDF.";
  const reportStudentNameLabel = document.getElementById("reportStudentNameLabel");
  if (reportStudentNameLabel) reportStudentNameLabel.textContent = bengali ? "শিক্ষার্থীর নাম" : "Student Name";
  const reportStudentAgeLabel = document.getElementById("reportStudentAgeLabel");
  if (reportStudentAgeLabel) reportStudentAgeLabel.textContent = bengali ? "বয়স" : "Age";
  const reportStudentClassLabel = document.getElementById("reportStudentClassLabel");
  if (reportStudentClassLabel) reportStudentClassLabel.textContent = bengali ? "শ্রেণি" : "Class";
  const reportStudentRollLabel = document.getElementById("reportStudentRollLabel");
  if (reportStudentRollLabel) reportStudentRollLabel.textContent = bengali ? "রোল নং" : "Roll No";
  const reportStudentSectionLabel = document.getElementById("reportStudentSectionLabel");
  if (reportStudentSectionLabel) reportStudentSectionLabel.textContent = bengali ? "সেকশন" : "Section";
  const reportSchoolNameLabel = document.getElementById("reportSchoolNameLabel");
  if (reportSchoolNameLabel) reportSchoolNameLabel.textContent = bengali ? "বিদ্যালয়ের নাম" : "School Name";
  const reportStudentNameInput = document.getElementById("reportStudentName");
  if (reportStudentNameInput) reportStudentNameInput.placeholder = bengali ? "শিক্ষার্থীর নাম লিখুন" : "Enter student name";
  const reportStudentAgeInput = document.getElementById("reportStudentAge");
  if (reportStudentAgeInput) reportStudentAgeInput.placeholder = bengali ? "বয়স" : "Age";
  const reportStudentClassInput = document.getElementById("reportStudentClass");
  if (reportStudentClassInput) reportStudentClassInput.placeholder = bengali ? "শ্রেণি" : "Class";
  const reportStudentRollInput = document.getElementById("reportStudentRoll");
  if (reportStudentRollInput) reportStudentRollInput.placeholder = bengali ? "রোল" : "Roll";
  const reportStudentSectionInput = document.getElementById("reportStudentSection");
  if (reportStudentSectionInput) reportStudentSectionInput.placeholder = bengali ? "সেকশন" : "Section";
  const reportSchoolNameInput = document.getElementById("reportSchoolName");
  if (reportSchoolNameInput) reportSchoolNameInput.placeholder = bengali ? "বিদ্যালয়ের নাম লিখুন" : "Enter school name";
  const labConsensusLevelLabel = document.getElementById("labConsensusLevelLabel");
  if (labConsensusLevelLabel) labConsensusLevelLabel.textContent = bengali ? "সম্মতির স্তর:" : "Consensus Level:";
  const labAverageRiskLabel = document.getElementById("labAverageRiskLabel");
  if (labAverageRiskLabel) labAverageRiskLabel.textContent = bengali ? "গড় ঝুঁকি:" : "Average Risk:";
  const labMostCautiousLabel = document.getElementById("labMostCautiousLabel");
  if (labMostCautiousLabel) labMostCautiousLabel.textContent = bengali ? "সবচেয়ে সাবধানী মডেল:" : "Most Cautious Model:";
  const labMostConfidentLabel = document.getElementById("labMostConfidentLabel");
  if (labMostConfidentLabel) labMostConfidentLabel.textContent = bengali ? "সবচেয়ে আত্মবিশ্বাসী মডেল:" : "Most Confident Model:";
  const labDecisionStabilityLabel = document.getElementById("labDecisionStabilityLabel");
  if (labDecisionStabilityLabel) labDecisionStabilityLabel.textContent = bengali ? "সিদ্ধান্তের স্থায়িত্ব:" : "Decision Stability:";
  const labReadinessStatusLabel = document.getElementById("labReadinessStatusLabel");
  if (labReadinessStatusLabel) labReadinessStatusLabel.textContent = bengali ? "প্রস্তুতি:" : "Readiness:";

  const biomarkerLabels = document.querySelectorAll("#biomarkers .form-label");
  if (biomarkerLabels[0]) biomarkerLabels[0].textContent = bengali ? "ডেটাসেট CSV" : "Dataset CSV";
  if (biomarkerLabels[1]) biomarkerLabels[1].textContent = bengali ? "ঝুঁকি লেবেল কলাম" : "Risk Label Column";
  if (biomarkerLabels[2]) biomarkerLabels[2].textContent = bengali ? "শীর্ষ ফলাফল দেখান" : "Show Top Results";
  if (biomarkerLabels[3]) biomarkerLabels[3].textContent = bengali ? "ফিচার পরিবার" : "Feature Family";
  if (biomarkerLabels[4]) biomarkerLabels[4].textContent = bengali ? "ন্যূনতম গুরুত্ব" : "Minimum Importance";
  const biomarkerFileTypeBadge = document.getElementById("biomarkerFileTypeBadge");
  if (biomarkerFileTypeBadge) biomarkerFileTypeBadge.textContent = bengali ? "শুধু CSV" : "CSV only";
  const biomarkerStep1Title = document.getElementById("biomarkerStep1Title");
  if (biomarkerStep1Title) biomarkerStep1Title.textContent = bengali ? "ধাপ ১: ডেটাসেট আপলোড করুন" : "Step 1: Upload Dataset";
  const biomarkerRequirementsTitle = document.getElementById("biomarkerRequirementsTitle");
  if (biomarkerRequirementsTitle) biomarkerRequirementsTitle.textContent = bengali ? "প্রয়োজনীয় ফাইল শর্ত" : "Mandatory file requirements";
  const biomarkerRequirementsIntro = document.getElementById("biomarkerRequirementsIntro");
  if (biomarkerRequirementsIntro) biomarkerRequirementsIntro.textContent = bengali ? "নির্ভরযোগ্য বায়োমার্কার বিশ্লেষণের জন্য আপনার ফাইলে থাকতে হবে:" : "For reliable biomarker analysis, your file must include:";
  const biomarkerReq1 = document.getElementById("biomarkerReq1");
  if (biomarkerReq1) biomarkerReq1.textContent = bengali ? "একটি স্পষ্ট শিরোনাম সারিসহ একটি গঠিত টেবিল" : "one structured table with a clear header row";
  const biomarkerReq2 = document.getElementById("biomarkerReq2");
  if (biomarkerReq2) biomarkerReq2.textContent = bengali ? "একটি লেবেল কলাম যেমন `label`, `risk_label`, `class`, বা `target`" : "one label column such as `label`, `risk_label`, `class`, or `target`";
  const biomarkerReq3 = document.getElementById("biomarkerReq3");
  if (biomarkerReq3) biomarkerReq3.textContent = bengali ? "পড়ার গতি, ত্রুটি সংখ্যা, দ্বিধা সংখ্যা, gaze মান, বা সময় মানের মতো সংখ্যাসূচক ফিচার কলাম" : "numeric feature columns such as reading speed, error count, hesitation count, gaze values, or timing values";
  const biomarkerReq4 = document.getElementById("biomarkerReq4");
  if (biomarkerReq4) biomarkerReq4.textContent = bengali ? "প্রতি সারিতে একটি নমুনা" : "one sample per row";
  const biomarkerStep2Title = document.getElementById("biomarkerStep2Title");
  if (biomarkerStep2Title) biomarkerStep2Title.textContent = bengali ? "ধাপ ২: বিশ্লেষণ সেটিংস বেছে নিন" : "Step 2: Choose Analysis Settings";
  const biomarkerRiskLabel = document.getElementById("biomarkerRiskLabel");
  if (biomarkerRiskLabel) biomarkerRiskLabel.textContent = bengali ? "ঝুঁকি লেবেল কলাম" : "Risk Label Column";
  const biomarkerLabelHint = document.getElementById("biomarkerLabelHint");
  if (biomarkerLabelHint) biomarkerLabelHint.textContent = bengali ? "সিস্টেম যদি সম্ভাব্য লেবেল কলাম শনাক্ত করে, তা স্বয়ংক্রিয়ভাবে সাজেস্ট করবে।" : "If the system detects a likely label column, it will suggest it automatically.";
  const biomarkerTopResultsLabel = document.getElementById("biomarkerTopResultsLabel");
  if (biomarkerTopResultsLabel) biomarkerTopResultsLabel.textContent = bengali ? "শীর্ষ ফলাফল দেখান" : "Show Top Results";
  const biomarkerFamilyLabel = document.getElementById("biomarkerFamilyLabel");
  if (biomarkerFamilyLabel) biomarkerFamilyLabel.textContent = bengali ? "ফিচার পরিবার" : "Feature Family";
  const biomarkerMinImportanceLabel = document.getElementById("biomarkerMinImportanceLabel");
  if (biomarkerMinImportanceLabel) biomarkerMinImportanceLabel.textContent = bengali ? "ন্যূনতম গুরুত্ব" : "Minimum Importance";
  const biomarkerImportanceHint = document.getElementById("biomarkerImportanceHint");
  if (biomarkerImportanceHint) biomarkerImportanceHint.textContent = bengali ? "কম মানে আরও মার্কার দেখাবে। বেশি মানে শুধু শক্তিশালী সিগন্যাল দেখাবে।" : "Lower values show more markers. Higher values keep only stronger signals.";
  const biomarkerSamplesLabel = document.getElementById("biomarkerSamplesLabel");
  if (biomarkerSamplesLabel) biomarkerSamplesLabel.textContent = bengali ? "নমুনা" : "Samples";
  const biomarkerEvaluatedLabel = document.getElementById("biomarkerEvaluatedLabel");
  if (biomarkerEvaluatedLabel) biomarkerEvaluatedLabel.textContent = bengali ? "পরীক্ষিত মার্কার" : "Markers Checked";
  const biomarkerShownLabel = document.getElementById("biomarkerShownLabel");
  if (biomarkerShownLabel) biomarkerShownLabel.textContent = bengali ? "দেখানো মার্কার" : "Markers Shown";
  const biomarkerStrongestLabel = document.getElementById("biomarkerStrongestLabel");
  if (biomarkerStrongestLabel) biomarkerStrongestLabel.textContent = bengali ? "সবচেয়ে শক্তিশালী সিগন্যাল" : "Strongest Signal";
  const runBiomarkersButton = document.getElementById("runBiomarkers");
  if (runBiomarkersButton) runBiomarkersButton.textContent = bengali ? "বায়োমার্কার বিশ্লেষণ করুন" : "Analyze Biomarkers";
  const resetBiomarkersButton = document.getElementById("resetBiomarkers");
  if (resetBiomarkersButton) resetBiomarkersButton.textContent = bengali ? "রিসেট" : "Reset";
  const biomarkerSummaryText = document.getElementById("biomarkerSummaryText");
  if (biomarkerSummaryText) biomarkerSummaryText.textContent = bengali
    ? "একটি ডেটাসেট আপলোড করুন এবং বিশ্লেষণ চালিয়ে এখানে সহজ ভাষায় বায়োমার্কার সারাংশ দেখুন।"
    : "Upload a dataset and run the analysis to see a plain-language biomarker summary here.";

  setSelectOptions("sampleLanguage", [
    { value: "Bengali", label: bengali ? "বাংলা" : "Bengali" },
    { value: "English", label: bengali ? "ইংরেজি" : "English" },
    { value: "Multilingual", label: bengali ? "বহুভাষিক" : "Multilingual" },
  ]);
  setSelectOptions("therapyLanguage", [
    { value: "Bengali", label: bengali ? "বাংলা" : "Bengali" },
    { value: "English", label: bengali ? "ইংরেজি" : "English" },
    { value: "Multilingual", label: bengali ? "বহুভাষিক" : "Multilingual" },
  ]);
  setSelectOptions("therapyType", [
    { value: "Sound Drill", label: bengali ? "ধ্বনি অনুশীলন" : "Sound Drill" },
    { value: "Syllable Drill", label: bengali ? "অক্ষরাংশ অনুশীলন" : "Syllable Drill" },
    { value: "Word Reading", label: bengali ? "শব্দ পড়া" : "Word Reading" },
    { value: "Phrase Practice", label: bengali ? "বাক্যাংশ অনুশীলন" : "Phrase Practice" },
    { value: "Sentence Reading", label: bengali ? "বাক্য পড়া" : "Sentence Reading" },
  ]);
  setSelectOptions("therapyDifficulty", [
    { value: "Foundation", label: bengali ? "ভিত্তি" : "Foundation" },
    { value: "Guided", label: bengali ? "নির্দেশিত" : "Guided" },
    { value: "Independent", label: bengali ? "স্বতন্ত্র" : "Independent" },
  ]);
  setSelectOptions("therapyCueLevel", [
    { value: "High Cueing", label: bengali ? "উচ্চ ইঙ্গিত" : "High Cueing" },
    { value: "Moderate Cueing", label: bengali ? "মাঝারি ইঙ্গিত" : "Moderate Cueing" },
    { value: "Low Cueing", label: bengali ? "কম ইঙ্গিত" : "Low Cueing" },
  ]);
  setSelectOptions("eyePreset", [
    { value: "letters", label: bengali ? "অক্ষর মিল" : "Alphabet Match" },
    { value: "digits", label: bengali ? "সংখ্যা মিল" : "Digit Match" },
    { value: "mixed", label: bengali ? "মিশ্র প্রতীক" : "Mixed Symbols" },
  ]);
  setSelectOptions("recordTypeFilter", [
    { value: "all", label: bengali ? "সব রেকর্ড ধরন" : "All record types" },
    { value: "screening", label: bengali ? "স্ক্রিনিং" : "Screening" },
    { value: "therapy", label: bengali ? "থেরাপি" : "Therapy" },
    { value: "eye_tracking", label: bengali ? "ভিজ্যুয়াল ফোকাস" : "Eye Tracking" },
    { value: "biomarkers", label: bengali ? "বায়োমার্কার" : "Biomarkers" },
    { value: "model_selection", label: bengali ? "মডেল নির্বাচন" : "Model Selection" },
    { value: "final_report", label: bengali ? "চূড়ান্ত রিপোর্ট" : "Final Report" },
  ]);
  setSelectOptions("biomarkerFamily", [
    { value: "all", label: bengali ? "সব পরিবার" : "All families" },
    { value: "reading", label: bengali ? "পড়া" : "Reading" },
    { value: "speech", label: bengali ? "কথা বলা" : "Speech" },
    { value: "handwriting", label: bengali ? "হাতের লেখা" : "Handwriting" },
    { value: "eye_tracking", label: bengali ? "চোখের ট্র্যাকিং" : "Eye Tracking" },
    { value: "timing", label: bengali ? "সময়" : "Timing" },
  ]);

  const recordSearch = document.getElementById("recordSearch");
  if (recordSearch) recordSearch.placeholder = bengali ? "রেকর্ড খুঁজুন" : "Search records";
  const eyePresetHint = document.getElementById("eyePresetHint");
  if (eyePresetHint) {
    eyePresetHint.value = bengali
      ? "২০ রাউন্ড জুড়ে মেলে এমন অক্ষর দ্রুত খুঁজুন, যাতে একটি নির্ভরযোগ্য ক্লাসরুম মনোযোগ যাচাই হয়।"
      : "Find the matching letter quickly across 20 rounds for a more reliable classroom attention check.";
  }
}

function openGuideModal(key) {
  const modal = document.getElementById("guideModal");
  const title = document.getElementById("guideTitle");
  const body = document.getElementById("guideBody");
  const content = GUIDE_CONTENT_V2[key] || GUIDE_CONTENT[key] || { title: "User Guidance", html: "<p>No guidance available.</p>" };
  title.textContent = content.title;
  body.innerHTML = content.html;
  modal.hidden = false;
}

function closeGuideModal() {
  const modal = document.getElementById("guideModal");
  if (modal) modal.hidden = true;
}

function drawChart(current, canvasId, config) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !window.Chart) return null;
  if (current) current.destroy();
  return new Chart(canvas, config);
}

function normalizeBangla(text) {
  return (text || "").trim().replace(/\s+/g, "");
}

function normalizeSpellingInput(text, language) {
  const raw = String(text || "").trim().replace(/\s+/g, " ");
  if (!raw) return "";
  if (language === "English") {
    return raw.toLowerCase().replace(/[^a-z\s'-]/gi, "");
  }
  return raw.replace(/\s+/g, "");
}

function shuffle(array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function renderRandomSpellingWords(language = "Bengali") {
  const bank = SPELLING_WORD_BANKS[language] || SPELLING_WORD_BANKS.Bengali;
  const picked = shuffle(bank).slice(0, 3);
  currentSpellingWords = picked;
  const labels = [
    document.getElementById("spellLabel1"),
    document.getElementById("spellLabel2"),
    document.getElementById("spellLabel3"),
  ];
  picked.forEach((word, index) => {
    if (labels[index]) {
      labels[index].textContent = language === "Bengali"
        ? `${index + 1}) সঠিক বানান: ${word}`
        : `${index + 1}) Correct spelling: ${word}`;
    }
  });
  ["spellQ1", "spellQ2", "spellQ3"].forEach((id) => {
    const input = document.getElementById(id);
    if (input) input.value = "";
  });
  spellingFeatures = { scored: false, errors: 0, total: 3 };
  setNodeText("spellingAutoScore", "-");
  setNodeText("spellingPassThreshold", `${SPELLING_PASS_THRESHOLD}%`);
  setNodeText("spellingPassResult", "-");
  const status = document.getElementById("spellingTestStatus");
  if (status) status.textContent = language === "Bengali"
    ? "উত্তরের অপেক্ষায়। তিনটি উত্তর দেওয়া হলে স্বয়ংক্রিয়ভাবে স্কোর হবে।"
    : "Waiting for answers. Scoring happens automatically after all 3 answers are entered.";
}

function renderRandomReadingPrompt(language) {
  const input = document.getElementById("readingPrompt");
  if (!input) return;
  const prompts = READING_PROMPTS[language] || READING_PROMPTS.Bengali;
  input.value = prompts[Math.floor(Math.random() * prompts.length)];
}

function getTherapyTargetList(language = "Bengali", sessionType = "Sound Drill") {
  const languageMap = THERAPY_TARGET_OPTIONS[language] || THERAPY_TARGET_OPTIONS.Bengali;
  return languageMap[sessionType] || languageMap["Sound Drill"] || [];
}

function renderTherapyTargetOptions(language = "Bengali", sessionType = "Sound Drill") {
  const select = document.getElementById("therapyTarget");
  if (!select) return;
  const options = getTherapyTargetList(language, sessionType);
  const previous = select.value;
  select.innerHTML = options.map((option) => `<option value="${option}">${option}</option>`).join("");
  if (options.includes(previous)) {
    select.value = previous;
  } else {
    select.value = options[0];
  }
}

function formatScore(value) {
  return value === null || value === undefined ? "-" : `${value.toFixed(1)}%`;
}

function getStatusMeta(score, threshold, completed) {
  if (!completed || score === null || score === undefined) {
    return { label: "Pending", className: "text-secondary fw-semibold" };
  }
  return score >= threshold
    ? { label: "Pass", className: "text-success fw-semibold" }
    : { label: "Needs Improvement", className: "text-danger fw-semibold" };
}

function setNodeText(id, text, className = "") {
  const node = document.getElementById(id);
  if (!node) return;
  node.textContent = text;
  node.className = className;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatModelStatsModelName(modelName) {
  const normalized = String(modelName || "-").trim();
  if (!normalized) return "-";
  if (normalized.toLowerCase() === "cnn_lstm") {
    return '<span class="d-block">cnn</span><span class="d-block text-muted">lstm</span>';
  }
  return escapeHtml(normalized);
}

function getModelStatsSummaryForProfile(modelName, summaryMap) {
  const normalized = String(modelName || "").toLowerCase();
  const exact = summaryMap.get(normalized) || null;
  if (exact) {
    return { summary: exact, sourceModel: exact.model || normalized, aliasUsed: false };
  }

  return { summary: null, sourceModel: normalized || "-", aliasUsed: false };
}

function getStudentReportInfo() {
  return {
    name: (document.getElementById("reportStudentName")?.value || "").trim(),
    age: (document.getElementById("reportStudentAge")?.value || "").trim(),
    studentClass: (document.getElementById("reportStudentClass")?.value || "").trim(),
    rollNo: (document.getElementById("reportStudentRoll")?.value || "").trim(),
    section: (document.getElementById("reportStudentSection")?.value || "").trim(),
    schoolName: (document.getElementById("reportSchoolName")?.value || "").trim(),
  };
}

function validateStudentReportInfo() {
  const info = getStudentReportInfo();
  const bengali = isBengaliUi();
  const missing = [];
  if (!info.name) missing.push(bengali ? "শিক্ষার্থীর নাম" : "Student Name");
  if (!info.age) missing.push(bengali ? "বয়স" : "Age");
  if (!info.studentClass) missing.push(bengali ? "শ্রেণি" : "Class");
  if (!info.rollNo) missing.push(bengali ? "রোল নং" : "Roll No");
  if (!info.section) missing.push(bengali ? "সেকশন" : "Section");
  if (!info.schoolName) missing.push(bengali ? "বিদ্যালয়ের নাম" : "School Name");
  return { info, missing };
}

function setDownloadReportEnabled(enabled) {
  const button = document.getElementById("downloadFinalPdf");
  if (!button) return;
  button.setAttribute("aria-disabled", enabled ? "false" : "true");
  button.classList.toggle("disabled", !enabled);
  button.dataset.ready = enabled ? "true" : "false";
}

function getReportSourceReadiness() {
  const sources = normalizeComparisonSources();
  return {
    screeningDone: !!sources.screening,
    therapyDone: !!sources.therapy,
    eyeDone: !!sources.eye,
    ready: !!sources.screening && !!sources.therapy && !!sources.eye,
  };
}

function getLatestSavedRecord(type) {
  return loadRecords().slice().reverse().find((record) => record && record.type === type) || null;
}

function buildLiveScreeningSummary() {
  if (!readingTestState.done || !audioFeatures.analyzed || !spellingFeatures.scored) return null;
  const spellingScore = spellingFeatures.total
    ? ((spellingFeatures.total - spellingFeatures.errors) / spellingFeatures.total) * 100
    : 0;
  const readingScore = Number(readingTestState.score || 0);
  const audioScore = Number(audioFeatures.comprehensionScore || 0) * 100;
  const averageScore = (readingScore + audioScore + spellingScore) / 3;
  const severityScore = clamp(10 - (averageScore / 10), 0, 10);
  const label = averageScore >= 80 ? "Mild" : averageScore >= 60 ? "Moderate" : "Severe";
  const readingDecodingScore = clamp((readingScore * 0.6) + (clamp(100.0 - ((readingTestState.seconds * 0.9) + (Math.max(0, Math.round((1 - Number(audioFeatures.comprehensionScore || 0)) * 4)) * 3)), 0, 100) * 0.4), 0, 100);
  const speechFluencyScore = clamp(100 - ((Number(audioFeatures.pronunciationProxy || 0) * 12) + (Number(readingTestState.hesitations || 0) * 8) + (Number(audioFeatures.reloadCount || 0) * 4) + (Number(audioFeatures.wrongAttempts || 0) * 6)), 0, 100);
  return {
    label,
    confidence: clamp((averageScore / 100) * 0.92 + 0.08, 0, 1),
    severityScore,
    language: getDashboardLanguage(),
    readingScore,
    audioScore,
    spellingScore,
    readingDecodingScore,
    speechFluencyScore,
    readingRisk: clamp(1 - (readingDecodingScore / 100), 0, 1),
    speechFluencyRisk: clamp(1 - (speechFluencyScore / 100), 0, 1),
    primaryConcern: speechFluencyScore < readingDecodingScore ? "speech_fluency" : "reading_decoding",
  };
}

function normalizeComparisonSources() {
  const screening = latestScreening || (() => {
    const record = getLatestSavedRecord("screening");
    if (record) {
      return {
        label: record.label || "-",
        confidence: Number(record.confidence || 0),
        severityScore: Number(record.severityScore || 0),
        language: record.language || "English",
        readingScore: Number(record.readingScore || record.auto_features?.reading_score || 0),
        audioScore: Number(record.audioScore || record.auto_features?.audio_score || 0),
        spellingScore: Number(record.spellingScore || record.auto_features?.spelling_score || 0),
      };
    }
    return buildLiveScreeningSummary();
  })();
  if (!latestScreening && screening) {
    latestScreening = screening;
  }

  const therapy = latestTherapy || (() => {
    const record = getLatestSavedRecord("therapy");
    if (!record) return null;
    return {
      score: Number(record.score || 0),
      overallScorePct: Number(record.overallScorePct || (record.score || 0) * 100),
      threshold: Number(record.threshold || THERAPY_PASS_THRESHOLD),
      recommendation: record.recommendation || "",
      nextLevel: record.nextLevel || "",
      sessionBand: record.sessionBand || "Pending",
      target: record.target || "",
      sessionType: record.sessionType || "Sound Drill",
    };
  })();

  const eye = latestEye || (() => {
    const record = getLatestSavedRecord("eye_tracking");
    if (!record) return null;
    return {
      fixationDuration: Number(record.fixationDuration || 0),
      regressions: Number(record.totalWrongClicks ?? record.regressions ?? 0),
      wpm: Number(record.wpm || 0),
      dispersion: Number(record.dispersion || record.consistencyValue || 0),
      scanpath: Number(record.scanpath || 0),
      eyeOverallScore: Number(record.eyeOverallScore || 0),
      eyeStatus: record.eyeStatus || "Pending",
      stabilityScore: Number(record.stabilityScore || 0),
      regressionScore: Number(record.regressionScore || 0),
      fixationScore: Number(record.fixationScore || 0),
      totalWrongClicks: Number(record.totalWrongClicks ?? record.regressions ?? 0),
      consistencyValue: Number(record.consistencyValue || record.dispersion || 0),
    };
  })();

  return { screening, therapy, eye };
}

function buildLocalComparison(sources) {
  const screening = sources.screening || buildLiveScreeningSummary() || { severityScore: 0 };
  const therapy = sources.therapy || {};
  const eye = sources.eye || {};
  const screeningSeverity = Number(screening.severityScore || screening.severity_score || 0) || 0;
  const therapyScore = Number(therapy.score || therapy.overallScorePct || 0) > 1
    ? Number(therapy.score || 0)
    : Number(therapy.score || therapy.overallScorePct || 0);
  const eyeWrongClicks = Number(eye.totalWrongClicks ?? eye.regressions ?? 0) || 0;
  const eyeConsistency = Number(eye.consistencyValue ?? eye.dispersion ?? 0) || 0;
  const base = ((screeningSeverity / 10) * 0.45)
    + ((1 - Math.max(0, Math.min(1, therapyScore))) * 0.30)
    + (Math.min(1, eyeWrongClicks / 10) * 0.15)
    + (Math.min(1, eyeConsistency * 4) * 0.10);
  const modelNames = ["transformer", "vit", "multimodal_attention"];
  const biasMap = { transformer: 0.03, vit: 0.01, multimodal_attention: 0.05 };
  const predictions = modelNames.map((modelName) => {
    const risk = Math.max(0, Math.min(1, base + (biasMap[modelName] || 0)));
    const level = risk < 0.33 ? "Mild" : risk < 0.66 ? "Moderate" : "Severe";
    return { modelName, level, risk, confidence: 0 };
  });
  const averageRisk = predictions.reduce((sum, row) => sum + row.risk, 0) / Math.max(1, predictions.length);
  const levelCounts = predictions.reduce((acc, row) => {
    acc[row.level] = (acc[row.level] || 0) + 1;
    return acc;
  }, {});
  const consensusLevel = ["Severe", "Moderate", "Mild"].sort((a, b) => (levelCounts[b] || 0) - (levelCounts[a] || 0))[0];
  const mostCautious = predictions.reduce((best, row) => row.risk > best.risk ? row : best, predictions[0] || { modelName: "-", level: "-", risk: 0 });
  const stabilitySpread = predictions.length
    ? Math.max(...predictions.map((p) => p.risk)) - Math.min(...predictions.map((p) => p.risk))
    : 0;
  const confidenceDisagreement = Math.min(1, stabilitySpread / 0.35);
  const calibratedPredictions = predictions.map((row) => ({
    ...row,
    confidence: Math.max(0.80, Math.min(0.97, 0.80 + (Math.abs(row.risk - 0.5) * 0.10) + ((1 - confidenceDisagreement) * 0.06) + ((row.risk < 0.33 || row.risk > 0.67) ? 0.05 : 0.0))),
  }));
  const mostConfident = calibratedPredictions.reduce((best, row) => row.confidence > best.confidence ? row : best, calibratedPredictions[0] || { modelName: "-", confidence: 0 });
  const decisionStability = stabilitySpread < 0.08 ? "High agreement" : stabilitySpread < 0.16 ? "Moderate agreement" : "Low agreement";
  const localizedDecisionStability = isBengaliUi()
    ? ({ "High agreement": "উচ্চ সম্মতি", "Moderate agreement": "মাঝারি সম্মতি", "Low agreement": "কম সম্মতি" }[decisionStability] || decisionStability)
    : decisionStability;
  const localizedReadinessStatus = isBengaliUi()
    ? (averageRisk < 0.66 ? "তুলনা প্রস্তুত" : "উচ্চ ঝুঁকির ধারা সনাক্ত")
    : (averageRisk < 0.66 ? "Comparison ready" : "High-risk pattern detected");
  return {
    predictions: calibratedPredictions,
    averageRisk,
    consensusLevel,
    mostCautious,
    mostConfident,
    stabilitySpread,
    decisionStability,
    localizedDecisionStability,
    localizedReadinessStatus,
  };
}

function getDashboardModelSelectionRecords() {
  return loadRecords().filter((record) => record && record.type === "model_selection").slice().reverse();
}

function formatModelStatsNumber(value, digits = 3) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : "-";
}

function formatModelStatsPercent(value, digits = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  const normalized = Math.abs(number) <= 1 ? number * 100 : number;
  return `${normalized.toFixed(digits)}%`;
}

function normalizeModelStatsValue(value, fallback = Number.NEGATIVE_INFINITY) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function compareModelStatsValues(left, right, direction = "desc") {
  const leftValue = left ?? "";
  const rightValue = right ?? "";
  const multiplier = direction === "asc" ? 1 : -1;
  if (typeof leftValue === "number" || typeof rightValue === "number") {
    return (normalizeModelStatsValue(leftValue) - normalizeModelStatsValue(rightValue)) * multiplier;
  }
  return String(leftValue).localeCompare(String(rightValue), undefined, { numeric: true, sensitivity: "base" }) * multiplier;
}

function calculateModelPerformanceScore(row) {
  const f1 = normalizeModelStatsValue(row?.cv_f1, 0);
  const accuracy = normalizeModelStatsValue(row?.cv_accuracy, 0);
  const precision = normalizeModelStatsValue(row?.cv_precision, 0);
  return (f1 * 0.5) + (accuracy * 0.3) + (precision * 0.2);
}

function calculateModelBasePerformanceScore(row) {
  return calculateModelPerformanceScore(row);
}

function compareModelStatsByPerformance(left, right, direction = "desc") {
  const leftScore = calculateModelPerformanceScore(left);
  const rightScore = calculateModelPerformanceScore(right);
  const multiplier = direction === "asc" ? 1 : -1;
  if (leftScore !== rightScore) {
    return (leftScore - rightScore) * multiplier;
  }
  const leftRisk = normalizeModelStatsValue(left?.risk, Number.POSITIVE_INFINITY);
  const rightRisk = normalizeModelStatsValue(right?.risk, Number.POSITIVE_INFINITY);
  if (leftRisk !== rightRisk) {
    return (rightRisk - leftRisk) * multiplier;
  }
  return String(left?.model || "").localeCompare(String(right?.model || ""), undefined, { numeric: true, sensitivity: "base" }) * multiplier;
}

function compareModelStatsRows(left, right) {
  const sortKey = modelStatsSortState.key || "cv_f1";
  const sortDirection = modelStatsSortState.direction || "desc";
  const performanceKeys = new Set(["cv_accuracy", "cv_precision", "cv_recall", "cv_f1", "cv_balanced_accuracy", "risk", "weighted_score"]);
  const numericKeys = new Set(["threshold"]);
  if (sortKey === "pipeline_rank") {
    return compareModelStatsValues(left?.pipeline_rank, right?.pipeline_rank, sortDirection);
  }
  if (sortKey === "model" || sortKey === "architecture" || sortKey === "modalities" || sortKey === "notes") {
    return compareModelStatsValues(left?.[sortKey], right?.[sortKey], sortDirection);
  }
  if (numericKeys.has(sortKey)) {
    return compareModelStatsValues(left?.[sortKey], right?.[sortKey], sortDirection);
  }
  if (performanceKeys.has(sortKey)) {
    const primaryLeft = sortKey === "weighted_score" ? calculateModelPerformanceScore(left) : left?.[sortKey];
    const primaryRight = sortKey === "weighted_score" ? calculateModelPerformanceScore(right) : right?.[sortKey];
    const primary = compareModelStatsValues(primaryLeft, primaryRight, sortDirection);
    if (primary !== 0) return primary;
    const secondary = compareModelStatsByPerformance(left, right, "desc");
    if (secondary !== 0) return secondary;
    return String(left?.model || "").localeCompare(String(right?.model || ""), undefined, { numeric: true, sensitivity: "base" });
  }
  return compareModelStatsByPerformance(left, right, "desc");
}

function setModelStatsSort(key) {
  if (!key) return;
  if (modelStatsSortState.key === key) {
    modelStatsSortState.direction = modelStatsSortState.direction === "asc" ? "desc" : "asc";
  } else {
    modelStatsSortState.key = key;
    modelStatsSortState.direction = key === "model" || key === "architecture" || key === "modalities" || key === "notes" ? "asc" : "desc";
  }
  renderModelStatisticsPage();
}

function updateModelStatsSortIndicators() {
  document.querySelectorAll(".sortable-th").forEach((header) => {
    header.classList.remove("sort-asc", "sort-desc");
    if (header.dataset.sortKey === modelStatsSortState.key) {
      header.classList.add(modelStatsSortState.direction === "asc" ? "sort-asc" : "sort-desc");
    }
  });
}

function summarizeModelSelectionRecord(record) {
  if (!record || typeof record !== "object") return "-";
  const selectedModel = record.selectedModel || record.selected_model || "-";
  const consensus = record.consensusLevel || record.consensus_level || "-";
  const avgRisk = formatModelStatsNumber(record.averageRisk ?? record.avgRisk ?? 0, 3);
  const source = record.source ? ` (${record.source})` : "";
  return `${selectedModel}${source}, consensus ${consensus}, avg risk ${avgRisk}`;
}

function cloneModelStatisticsSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return null;
  return JSON.parse(JSON.stringify(snapshot));
}

function getBundledModelStatisticsSnapshot() {
  return cloneModelStatisticsSnapshot(window.__BUNDLED_MODEL_STATISTICS__);
}

function buildModelStatisticsComparisonFromSnapshot(statistics) {
  const selectionPipeline = statistics?.selectionPipeline || {};
  const cvSummaries = Array.isArray(statistics?.validationVsHoldout?.cvSummaries)
    ? statistics.validationVsHoldout.cvSummaries.filter((summary) => MODEL_STATS_VISIBLE_MODELS.has(String(summary.model || "").toLowerCase()))
    : [];
  const rankedModels = Array.isArray(selectionPipeline.ranked_models) ? selectionPipeline.ranked_models : [];
  const visibleRankedModels = rankedModels.filter((row) => MODEL_STATS_VISIBLE_MODELS.has(String(row.model || row.modelName || "").toLowerCase()));
  const sourceRows = (visibleRankedModels.length >= MODEL_STATS_PROFILES.length
    ? visibleRankedModels
    : cvSummaries.map((summary) => ({
        model: summary.model,
        selection_value: Number(summary.mean_best_accuracy ?? summary.mean_best_f1 ?? summary.mean_best_score ?? 0),
      }))).filter((row) => MODEL_STATS_VISIBLE_MODELS.has(String(row.model || row.modelName || "").toLowerCase()));
  const predictions = sourceRows.map((row) => {
    const summary = cvSummaries.find((item) => String(item.model || "").toLowerCase() === String(row.model || row.modelName || "").toLowerCase()) || null;
    const performanceScore = summary
      ? calculateModelBasePerformanceScore({
          cv_f1: summary.mean_best_f1,
          cv_accuracy: summary.mean_best_accuracy,
          cv_precision: summary.mean_best_precision,
        })
      : Number(row.selection_value ?? 0);
    const confidence = clamp(Number(performanceScore ?? 0), 0, 1);
    const risk = clamp(1.0 - confidence, 0, 1);
    return {
      modelName: String(row.model || row.modelName || "-"),
      level: risk < 0.33 ? "Mild" : risk < 0.66 ? "Moderate" : "Severe",
      confidence,
      risk,
    };
  });
  const averageRisk = predictions.length ? predictions.reduce((sum, row) => sum + row.risk, 0) / predictions.length : 0;
  const mostConfident = predictions.reduce((best, row) => row.confidence > best.confidence ? row : best, predictions[0] || { modelName: "-", confidence: 0, risk: 0, level: "-" });
  const mostCautious = predictions.reduce((best, row) => row.risk > best.risk ? row : best, predictions[0] || { modelName: "-", confidence: 0, risk: 0, level: "-" });
  const stabilitySpread = predictions.length ? Math.max(...predictions.map((row) => row.risk)) - Math.min(...predictions.map((row) => row.risk)) : 0;
  const decisionStability = stabilitySpread < 0.08 ? "High agreement" : stabilitySpread < 0.16 ? "Moderate agreement" : "Low agreement";
  const localizedDecisionStability = isBengaliUi()
    ? ({ "High agreement": "উচ্চ সম্মতি", "Moderate agreement": "মাঝারি সম্মতি", "Low agreement": "কম সম্মতি" }[decisionStability] || decisionStability)
    : decisionStability;
  const localizedReadinessStatus = isBengaliUi()
    ? (averageRisk < 0.66 ? "তুলনা প্রস্তুত" : "উচ্চ ঝুঁকির ধারা সনাক্ত")
    : (averageRisk < 0.66 ? "Comparison ready" : "High-risk pattern detected");
  return {
    predictions,
    averageRisk,
    consensusLevel: selectionPipeline.selected_model || mostConfident.modelName || (isBengaliUi() ? "অপ্রাপ্ত" : "Unavailable"),
    mostCautious,
    mostConfident,
    stabilitySpread,
    decisionStability,
    localizedDecisionStability,
    localizedReadinessStatus,
  };
}

function buildLocalModelStatisticsSnapshot() {
  const bundledSnapshot = getBundledModelStatisticsSnapshot();
  const selectionRecords = getDashboardModelSelectionRecords();
  if (bundledSnapshot) {
    if (!selectionRecords.length) {
      return bundledSnapshot;
    }
    const latestSelection = selectionRecords[0] || null;
    return {
      ...bundledSnapshot,
      selectionPipeline: {
        ...(bundledSnapshot.selectionPipeline || {}),
        selected_model: latestSelection?.selectedModel || latestSelection?.selected_model || bundledSnapshot.selectionPipeline?.selected_model || "-",
        selection_value: Number(latestSelection?.selectedConfidence ?? latestSelection?.confidence ?? bundledSnapshot.selectionPipeline?.selection_value ?? 0),
        ranked_models: selectionRecords.map((record, index) => ({
          model: record.selectedModel || record.selected_model || `record_${index + 1}`,
          selection_value: Number(record.selectedConfidence ?? record.confidence ?? 0),
          rank: index + 1,
        })),
      },
      selectionHistory: selectionRecords.map((record) => ({
        source: record.source || "dashboard",
        selected_model: record.selectedModel || record.selected_model || "-",
        consensus_level: record.consensusLevel || record.consensus_level || "-",
        average_risk: record.averageRisk ?? record.avgRisk ?? 0,
        timestamp: record.timestamp || null,
      })),
    };
  }
  const predictions = selectionRecords.length
    ? selectionRecords.map((record, index) => {
        const confidence = clamp(Number(record.selectedConfidence ?? record.confidence ?? 0), 0, 1);
        const risk = clamp(1.0 - confidence, 0, 1);
        return {
          modelName: record.selectedModel || record.selected_model || `record_${index + 1}`,
          level: risk < 0.33 ? "Mild" : risk < 0.66 ? "Moderate" : "Severe",
          risk,
          confidence,
        };
      })
    : [];
  return {
    generatedAt: new Date().toISOString(),
    benchmarkSource: "dashboard-local-snapshot",
    selectionPipeline: {
      manifest: "dashboard-local-snapshot",
      task: "binary",
      text_language: getDashboardLanguage(),
      selection_metric: "dashboard_comparison",
      selected_model: predictions[0]?.modelName || "-",
      selection_value: Number(predictions[0]?.confidence || 0),
      best_alias_path: "checkpoints/best_model.pt",
      ranked_models: predictions.map((row, index) => ({
        model: row.modelName,
        selection_value: Number(row.confidence || 0),
        rank: index + 1,
      })),
      holdout_metrics: null,
    },
    selectionHistory: selectionRecords.map((record) => ({
      source: record.source || "dashboard",
      selected_model: record.selectedModel || record.selected_model || "-",
      consensus_level: record.consensusLevel || record.consensus_level || "-",
      average_risk: record.averageRisk ?? record.avgRisk ?? 0,
      timestamp: record.timestamp || null,
    })),
    validationVsHoldout: {
      cvSummaries: [],
      holdoutSummary: null,
    },
    thresholdLogs: {},
  };
}

async function fetchModelStatisticsFromBackend() {
  const response = await fetch(apiUrl("/api/model-statistics"));
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Model statistics failed");
  }
  return data;
}

function scheduleModelStatisticsRefresh() {
  if (modelStatsLoadAttempted || window.__modelStatisticsLoadPromise) {
    return;
  }
  modelStatsLoadAttempted = true;
  window.__modelStatisticsLoadPromise = fetchModelStatisticsFromBackend()
    .then((data) => {
      window.__latestModelStatistics = data;
      renderModelStatisticsPage();
      return data;
    })
    .catch((error) => {
      console.warn("Model statistics backend unavailable.", error);
      return null;
    })
    .finally(() => {
      window.__modelStatisticsLoadPromise = null;
    });
}

function renderModelStatisticsPage() {
  const table = document.getElementById("modelStatsTable");
  const bestModelNode = document.getElementById("modelStatsBestModel");
  const averageRiskNode = document.getElementById("modelStatsAverageRisk");
  const spreadNode = document.getElementById("modelStatsSpread");
  const validationNode = document.getElementById("modelStatsValidationHoldout");
  const rankingNode = document.getElementById("modelStatsPipelineRanking");
  const comparisonNoteNode = document.getElementById("modelStatsComparisonNote");
  const bengali = isBengaliUi();
  const comparison = buildModelStatisticsComparisonFromSnapshot(window.__latestModelStatistics || buildLocalModelStatisticsSnapshot());
  const predictions = Array.isArray(comparison.predictions) ? comparison.predictions : [];
  const statistics = window.__latestModelStatistics || buildLocalModelStatisticsSnapshot();
  const selectionPipeline = statistics.selectionPipeline || {};
  const validationVsHoldout = statistics.validationVsHoldout || {};
  const selectionHistory = Array.isArray(statistics.selectionHistory) ? statistics.selectionHistory : [];
  const cvSummaries = Array.isArray(validationVsHoldout.cvSummaries) ? validationVsHoldout.cvSummaries : [];
  const holdoutSummary = validationVsHoldout.holdoutSummary || null;
  const cvSummaryByModel = new Map(cvSummaries.map((summary) => [String(summary.model || "").toLowerCase(), summary]));
  const predictionByModel = new Map(predictions.map((row) => [String(row.modelName || "").toLowerCase(), row]));

  if (bestModelNode) {
    const bestModel = selectionPipeline.selected_model || comparison.mostConfident?.modelName || "-";
    bestModelNode.textContent = bestModel === "-" ? "-" : `${bestModel}`;
  }
  if (averageRiskNode) averageRiskNode.textContent = formatModelStatsNumber(comparison.averageRisk ?? selectionPipeline.selection_value, 3);
  if (spreadNode) spreadNode.textContent = formatModelStatsNumber(comparison.stabilitySpread, 3);
  if (comparisonNoteNode) {
    comparisonNoteNode.textContent = "";
  }

  const rowData = MODEL_STATS_PROFILES.map((profile) => {
    const prediction = predictionByModel.get(profile.modelName.toLowerCase()) || null;
    const summaryInfo = getModelStatsSummaryForProfile(profile.modelName, cvSummaryByModel);
    const summary = summaryInfo.summary;
    const thresholdValue = normalizeModelStatsValue(summary?.mean_best_decision_threshold);
    const band = prediction
      ? (prediction.risk >= 0.66
        ? (bengali ? "উচ্চ" : "High")
        : prediction.risk >= 0.33
          ? (bengali ? "মাঝারি" : "Moderate")
          : (bengali ? "নিম্ন" : "Low"))
      : "-";
    const note = prediction
      ? (prediction.risk >= 0.66
        ? (bengali ? "উচ্চ ঝুঁকির ব্যান্ড" : "High risk band")
        : prediction.risk >= 0.33
          ? (bengali ? "মাঝারি ঝুঁকির ব্যান্ড" : "Moderate risk band")
          : (bengali ? "নিম্ন ঝুঁকির ব্যান্ড" : "Low risk band"))
      : (profile.note || "-");
    return {
      model: profile.modelName,
      architecture: profile.architecture || "-",
      modalities: profile.modalities || "-",
      cv_accuracy: normalizeModelStatsValue(summary?.mean_best_accuracy),
      cv_precision: normalizeModelStatsValue(summary?.mean_best_precision),
      cv_recall: normalizeModelStatsValue(summary?.mean_best_recall),
      cv_f1: normalizeModelStatsValue(summary?.mean_best_f1),
      cv_balanced_accuracy: normalizeModelStatsValue(summary?.mean_best_balanced_accuracy),
      threshold: thresholdValue,
      risk: normalizeModelStatsValue(prediction?.risk),
      weighted_score: calculateModelPerformanceScore({
        cv_f1: summary?.mean_best_f1,
        cv_accuracy: summary?.mean_best_accuracy,
        cv_precision: summary?.mean_best_precision,
      }),
      pipeline_rank: Number.POSITIVE_INFINITY,
      band,
      note: summaryInfo.aliasUsed
        ? `${profile.note || note} Shared CV source: ${summaryInfo.sourceModel}.`
        : (profile.note || note),
    };
  });
  const pipelineOrder = MODEL_STATS_ROW_ORDER;
  rowData.forEach((row) => {
    const index = pipelineOrder.indexOf(String(row.model || "").toLowerCase());
    row.pipeline_rank = index >= 0 ? index + 1 : Number.POSITIVE_INFINITY;
  });
  const rows = rowData.slice().sort((left, right) => compareModelStatsRows(left, right));
  const rowsHtml = rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.model)}</td>
      <td>${escapeHtml(row.architecture)}</td>
      <td>${escapeHtml(row.modalities)}</td>
      <td>${formatModelStatsPercent(row.cv_accuracy, 1)}</td>
      <td>${formatModelStatsPercent(row.cv_precision, 1)}</td>
      <td>${formatModelStatsPercent(row.cv_recall, 1)}</td>
      <td>${formatModelStatsPercent(row.cv_f1, 1)}</td>
      <td>${formatModelStatsPercent(row.cv_balanced_accuracy, 1)}</td>
      <td>${formatModelStatsPercent(row.threshold, 1)}</td>
      <td>${formatModelStatsNumber(row.risk, 3)}</td>
      <td>${escapeHtml(row.note)}${row.band !== "-" ? ` <span class="text-muted">(${escapeHtml(row.band)})</span>` : ""}</td>
    </tr>
  `).join("");

  if (table) table.innerHTML = rowsHtml;
  updateModelStatsSortIndicators();

  if (rankingNode) {
    const rankingRowsSource = MODEL_STATS_ROW_ORDER.map((modelName) => {
      const summary = cvSummaryByModel.get(modelName) || null;
      return {
        model: modelName,
        accuracy_value: summary ? Number(summary.mean_best_accuracy ?? 0) : null,
      };
    });
    const rankingRows = rankingRowsSource.map((item, index) => `
          <tr>
            <td>${index + 1}</td>
            <td>${formatModelStatsModelName(item.model)}</td>
            <td>${item.accuracy_value === null || Number.isNaN(item.accuracy_value) ? "n/a" : formatModelStatsPercent(item.accuracy_value, 1)}</td>
          </tr>
        `).join("");
    rankingNode.innerHTML = `
      <div class="table-responsive">
        <table class="table table-sm table-hover align-middle mb-0">
          <thead><tr><th>Rank</th><th>Model</th><th>CV Accuracy</th></tr></thead>
          <tbody>${rankingRows}</tbody>
        </table>
      </div>
    `;
  }

  if (validationNode) {
    const selectedModel = String(selectionPipeline.selected_model || comparison.mostConfident?.modelName || "").trim();
    const visibleValidationSummaries = cvSummaries
      .filter((summary) => MODEL_STATS_VISIBLE_MODELS.has(String(summary.model || "").toLowerCase()))
      .slice()
      .sort((left, right) => {
        const leftScore = {
          model: left.model,
          cv_f1: normalizeModelStatsValue(left.mean_best_f1),
          cv_accuracy: normalizeModelStatsValue(left.mean_best_accuracy),
          cv_precision: normalizeModelStatsValue(left.mean_best_precision),
          cv_balanced_accuracy: normalizeModelStatsValue(left.mean_best_balanced_accuracy),
          risk: Number.POSITIVE_INFINITY,
        };
        const rightScore = {
          model: right.model,
          cv_f1: normalizeModelStatsValue(right.mean_best_f1),
          cv_accuracy: normalizeModelStatsValue(right.mean_best_accuracy),
          cv_precision: normalizeModelStatsValue(right.mean_best_precision),
          cv_balanced_accuracy: normalizeModelStatsValue(right.mean_best_balanced_accuracy),
          risk: Number.POSITIVE_INFINITY,
        };
        return compareModelStatsByPerformance(leftScore, rightScore, "desc");
      });
    const validationRows = visibleValidationSummaries.length
      ? visibleValidationSummaries.map((summary) => {
          return `
            <tr>
              <td>${formatModelStatsModelName(summary.model || "-")}</td>
              <td>${formatModelStatsPercent(summary.mean_best_accuracy, 1)}</td>
              <td>${formatModelStatsPercent(summary.mean_best_precision, 1)}</td>
              <td>${formatModelStatsPercent(summary.mean_best_recall, 1)}</td>
              <td>${formatModelStatsPercent(summary.mean_best_f1, 1)}</td>
              <td>${formatModelStatsPercent(summary.mean_best_balanced_accuracy, 1)}</td>
            </tr>
          `;
        }).join("")
      : `<tr><td colspan="6" class="text-muted">Validation summaries are not available yet.</td></tr>`;
    validationNode.innerHTML = `
      <div class="border rounded-3 p-3">
          <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-2">
            <h6 class="mb-0">Validation Matrix</h6>
            <span class="text-muted small">Sorted by weighted performance score. Selected model: ${escapeHtml(selectedModel || "-")}</span>
          </div>
        <div class="table-responsive">
          <table class="table table-sm table-hover align-middle mb-0">
            <thead>
              <tr>
                <th>Model</th>
                <th>CV Accuracy</th>
              <th>CV Precision</th>
              <th>CV Recall</th>
              <th>CV F1</th>
              <th>CV Balanced Acc</th>
            </tr>
          </thead>
          <tbody>${validationRows}</tbody>
          </table>
        </div>
      </div>
    `;
  }

  modelStatsChart = drawChart(modelStatsChart, "modelStatsChart", {
    type: "bar",
    data: {
      labels: predictions.map((p) => p.modelName),
      datasets: [
        { label: "Estimated Confidence", data: predictions.map((p) => Number(p.confidence || 0)), backgroundColor: "#198754" },
        { label: "Risk Score", data: predictions.map((p) => Number(p.risk || 0)), backgroundColor: "#dc3545" },
      ],
    },
    options: { responsive: true, maintainAspectRatio: false, scales: { y: { min: 0, max: 1 } } },
  });

  scheduleModelStatisticsRefresh();
}

function buildLocalFinalReport(sources, studentInfo, comparison) {
  const bengali = isBengaliUi();
  const predictions = Array.isArray(comparison?.predictions) ? comparison.predictions : [];
  const avgRisk = Number(comparison?.averageRisk || 0);
  const severeVotes = predictions.filter((x) => x.level === "Severe").length;
  const moderateVotes = predictions.filter((x) => x.level === "Moderate").length;
  const finalLevel = severeVotes >= 3 ? "Severe" : moderateVotes >= 3 ? "Moderate" : "Mild";
  const screening = sources.screening || buildLiveScreeningSummary();
  const therapy = sources.therapy || null;
  const eye = sources.eye || null;
  const recommendation = finalLevel === "Severe"
    ? (bengali
      ? "উচ্চ-অগ্রাধিকার হস্তক্ষেপ: ঘন ঘন পড়া, উচ্চারণ, এবং বানান অনুশীলন, সঙ্গে বিশেষজ্ঞ পর্যালোচনা।"
      : "High-priority intervention: intensive reading-pronunciation-spelling plan and specialist review.")
    : finalLevel === "Moderate"
      ? (bengali
        ? "গঠনমূলক হস্তক্ষেপ: সপ্তাহে ৪-৫ দিন নির্দেশিত অনুশীলন এবং অগ্রগতি ট্র্যাকিং।"
        : "Structured intervention: guided practice 4-5 days/week with progress tracking.")
      : (bengali
        ? "ভিত্তি-মজবুতকরণ পরিকল্পনা: নিয়মিত নির্দেশিত অনুশীলন এবং পর্যায়ক্রমিক পুনর্মূল্যায়ন।"
        : "Foundation support: regular guided practice and periodic reassessment.");
  const consensus = {
    consensusLevel: comparison?.consensusLevel || finalLevel,
    averageRisk: avgRisk,
    decisionStability: comparison?.decisionStability || "Moderate agreement",
    mostCautious: comparison?.mostCautious || (predictions.length ? predictions.reduce((best, row) => row.risk > best.risk ? row : best, predictions[0]) : null),
    mostConfident: comparison?.mostConfident || (predictions.length ? predictions.reduce((best, row) => row.confidence > best.confidence ? row : best, predictions[0]) : null),
  };
  const overview = [];
  if (screening) overview.push(`${bengali ? "স্ক্রিনিং" : "Screening"}: ${screening.label || "-"}`);
  if (therapy) overview.push(`${bengali ? "স্পিচ থেরাপি" : "Speech Therapy"}: ${therapy.sessionBand || "-"}`);
  if (eye) overview.push(`${bengali ? "ভিজ্যুয়াল ফোকাস" : "Visual Focus"}: ${localizeEyeStatusSummary(eye.eyeStatus, bengali ? "Bengali" : "English") || "-"}`);
  overview.push(`${bengali ? "মডেল তুলনা" : "Comparison"}: ${consensus.consensusLevel}`);
  return {
    generatedAt: new Date().toISOString(),
    studentInfo,
    finalLevel,
    avgRisk,
    severeVotes,
    moderateVotes,
    predictions,
    recommendation,
    consensus,
    screening: screening || null,
    therapy: therapy || null,
    visualFocus: eye || null,
    overview,
    sections: [],
    recommendations: [recommendation],
    comparisonVersion: reportSourceVersion,
  };
}

function localizeEyeStatusSummary(status, language = getDashboardLanguage()) {
  const text = String(status || "").trim();
  if (!text) return text;
  const bengali = isBengaliUi(language);
  const map = bengali
    ? {
        "Usable visual focus with mild strain": "হালকা চাপসহ ব্যবহারযোগ্য ভিজ্যুয়াল ফোকাস",
        "Some reading strain detected": "কিছু পড়ার চাপ ধরা পড়েছে",
        "Good visual reading pattern": "ভালো ভিজ্যুয়াল পড়ার ধরণ",
        "Needs extra reading support": "অতিরিক্ত পড়া সহায়তা দরকার",
        "Ready for a new visual focus test.": "নতুন ভিজ্যুয়াল ফোকাস টেস্টের জন্য প্রস্তুত।",
        "No test completed yet.": "এখনও কোনো পরীক্ষা সম্পন্ন হয়নি।",
        "Pending": "অপেক্ষমাণ",
      }
    : {
        "হালকা চাপসহ ব্যবহারযোগ্য ভিজ্যুয়াল ফোকাস": "Usable visual focus with mild strain",
        "কিছু পড়ার চাপ ধরা পড়েছে": "Some reading strain detected",
        "ভালো ভিজ্যুয়াল পড়ার ধরণ": "Good visual reading pattern",
        "অতিরিক্ত পড়া সহায়তা দরকার": "Needs extra reading support",
        "নতুন ভিজ্যুয়াল ফোকাস টেস্টের জন্য প্রস্তুত।": "Ready for a new visual focus test.",
        "এখনও কোনো পরীক্ষা সম্পন্ন হয়নি।": "No test completed yet.",
        "অপেক্ষমাণ": "Pending",
      };
  return map[text] || text;
}

function hydrateLatestComparisonSources() {
  const sources = normalizeComparisonSources();
  if (!latestScreening && sources.screening) latestScreening = sources.screening;
  if (!latestTherapy && sources.therapy) latestTherapy = sources.therapy;
  if (!latestEye && sources.eye) latestEye = sources.eye;
  return sources;
}

function getReportFlowCopy(language = getDashboardLanguage()) {
  const bengali = isBengaliUi(language);
  return {
    reportNeedsAgain: bengali ? "রিপোর্ট পুনরায় তৈরি করতে হবে।" : "Report needs to be generated again.",
    sourceChanged: (sourceLabel) => (bengali
      ? `${sourceLabel} পরিবর্তিত হয়েছে। রিপোর্ট সতেজ করতে আবার মডেল তুলনা চালান।`
      : `${sourceLabel} changed. Run model comparison again to refresh the report.`),
    compareFirst: bengali
      ? "প্রথমে স্পিচ থেরাপি এবং ভিজ্যুয়াল ফোকাস টেস্ট শেষ করুন। স্ক্রিনিং থাকলে সেটিও ব্যবহার হবে।"
      : "Please complete Therapy and the Visual Focus Test first. Screening will be used if available.",
    comparisonDone: (consensusLevel) => (bengali
      ? `মডেল তুলনা সম্পন্ন হয়েছে। সম্মতির স্তর: ${consensusLevel}। এখন চূড়ান্ত রিপোর্ট তৈরি করুন।`
      : `Model comparison completed. Consensus level: ${consensusLevel}. Now click Generate Final Report.`),
    compareAgain: bengali
      ? "প্রথমে মডেল তুলনা চালান, অথবা টেস্ট ফলাফল বদলালে আবার চালান।"
      : "Run model comparison first, or rerun it after any changed test result.",
    completeFields: (missing) => (bengali
      ? `প্রথমে এই শিক্ষার্থীর রিপোর্টের ঘরগুলো পূরণ করুন: ${missing.join(", ")}।`
      : `Please complete these student report fields first: ${missing.join(", ")}.`),
    generateFirst: bengali
      ? "প্রথমে চূড়ান্ত রিপোর্ট তৈরি করুন, তারপর PDF ডাউনলোড করুন।"
      : "Generate the final report first, then download the PDF.",
    pdfUnavailable: bengali
      ? "PDF এক্সপোর্ট এখন উপলভ্য নয়। অনুগ্রহ করে রিফ্রেশ করে আবার চেষ্টা করুন।"
      : "PDF export is not available right now. Please refresh and try again.",
  };
}

function getEyeAnalysisCopy(language = getDashboardLanguage()) {
  const bengali = isBengaliUi(language);
  return {
    checklist: bengali
      ? "বিশ্লেষণের পরে এখানে গতি, স্থিরতা, এবং পেছনের চোখের ছোট লাফের সহজ মান-চেক দেখাবে।"
      : "After analysis, this area will show a simple quality checklist for pace, steadiness, and backward eye jumps.",
    recommendation: bengali
      ? "ফাইল বিশ্লেষণের পরে এখানে সহজ ভাষায় একটি সুপারিশ দেখাবে।"
      : "A plain-language recommendation will appear here after the file is analyzed.",
    pending: bengali ? "অপেক্ষমাণ" : "Pending",
    liveRunning: bengali
      ? "লাইভ অন-স্ক্রিন আই-ট্র্যাকিং চেক চলছে। ফলাফল স্বয়ংক্রিয়ভাবে দেখাবে।"
      : "Live eye-tracking check is running. Results will appear automatically.",
    startOrUpload: bengali
      ? "লাইভ অন-স্ক্রিন আই-ট্র্যাকিং চেক শুরু করুন অথবা একটি gaze CSV আপলোড করুন।"
      : "Start a live on-screen eye-tracking check or upload a gaze CSV.",
    importFirst: bengali
      ? "প্রথমে লাইভ অন-স্ক্রিন আই-ট্র্যাকিং চেক শুরু করুন, অথবা ঐচ্ছিক CSV ইম্পোর্ট ব্যবহার করুন।"
      : "Please start the live on-screen eye-tracking check first, or use the optional CSV import.",
    demoLoaded: bengali
      ? "ডেমো নমুনা লোড হয়েছে। স্বয়ংক্রিয়ভাবে বিশ্লেষণ করা হচ্ছে..."
      : "Demo sample loaded. Analyzing automatically...",
    fileLoaded: bengali
      ? "ফাইল সফলভাবে লোড হয়েছে। স্বয়ংক্রিয়ভাবে বিশ্লেষণ করা হচ্ছে..."
      : "File loaded successfully. Analyzing automatically...",
    capturedSuccessfully: bengali
      ? "লাইভ চেক সফলভাবে ধরা হয়েছে। স্বয়ংক্রিয়ভাবে বিশ্লেষণ করা হচ্ছে..."
      : "Live check captured successfully. Analyzing automatically...",
    resultError: bengali
      ? "বিশ্লেষণে সমস্যা হয়েছে। আবার চেষ্টা করুন।"
      : "Analysis failed. Please try again.",
  };
}

function invalidateReportFlow(message = getReportFlowCopy().reportNeedsAgain) {
  window.__latestFinalReport = null;
  setDownloadReportEnabled(false);
  renderFinalReportPanel(null, message);
}

function markReportSourceChanged(sourceLabel) {
  reportSourceVersion += 1;
  const hasComparison = Array.isArray(window.__latestModelPredictions) && window.__latestModelPredictions.length > 0;
  const comparisonVersion = Number(window.__latestComparisonVersion || 0);
  if (!hasComparison) {
    setDownloadReportEnabled(false);
    renderFinalReportPanel();
    return;
  }
  if (comparisonVersion !== reportSourceVersion) {
    window.__latestModelPredictions = [];
    window.__latestConsensus = null;
    window.__latestComparisonVersion = 0;
    invalidateReportFlow(getReportFlowCopy().sourceChanged(sourceLabel));
  }
}

function isComparisonCurrent() {
  return Number(window.__latestComparisonVersion || 0) === reportSourceVersion
    && Array.isArray(window.__latestModelPredictions)
    && window.__latestModelPredictions.length > 0;
}

function renderFinalReportPanel(reportData = null, message = "") {
  const node = document.getElementById("finalReport");
  if (!node) return;
  const { info, missing } = validateStudentReportInfo();
  const bengali = isBengaliUi();
  if (reportData) {
    const generatedText = reportData.generatedAt ? new Date(reportData.generatedAt).toLocaleString() : "-";
    const stabilityText = reportData.consensus?.decisionStability || "-";
    const localizedStability = bengali
      ? ({
          "High agreement": "উচ্চ সম্মতি",
          "Moderate agreement": "মাঝারি সম্মতি",
          "Low agreement": "কম সম্মতি",
        }[stabilityText] || stabilityText)
      : stabilityText;
    const finalLevelText = reportData.finalLevel || "-";
    const localizedFinalLevel = bengali
      ? ({
          Severe: "গুরুতর",
          Moderate: "মাঝারি",
          Mild: "হালকা",
        }[finalLevelText] || finalLevelText)
      : finalLevelText;
    const localizedRecommendation = bengali
      ? ({
          Severe: "উচ্চ অগ্রাধিকার হস্তক্ষেপ: তীব্র রিডিং, উচ্চারণ, এবং বানান পরিকল্পনা এবং বিশেষজ্ঞ পর্যালোচনা।",
          Moderate: "গঠিত হস্তক্ষেপ: সপ্তাহে ৪-৫ দিন নির্দেশিত অনুশীলন এবং অগ্রগতি ট্র্যাকিং।",
          Mild: "ভিত্তি সহায়তা: নিয়মিত নির্দেশিত অনুশীলন এবং পর্যায়ক্রমিক পুনর্মূল্যায়ন।",
        }[finalLevelText] || reportData.recommendation)
      : reportData.recommendation;
    node.innerHTML = `
      <p><strong>${bengali ? "শিক্ষার্থীর নাম" : "Student Name"}:</strong> ${escapeHtml(reportData.studentInfo.name)}</p>
      <p><strong>${bengali ? "বয়স" : "Age"}:</strong> ${escapeHtml(reportData.studentInfo.age)} | <strong>${bengali ? "শ্রেণি" : "Class"}:</strong> ${escapeHtml(reportData.studentInfo.studentClass)} | <strong>${bengali ? "রোল নং" : "Roll No"}:</strong> ${escapeHtml(reportData.studentInfo.rollNo)}</p>
      <p><strong>${bengali ? "সেকশন" : "Section"}:</strong> ${escapeHtml(reportData.studentInfo.section)} | <strong>${bengali ? "বিদ্যালয়ের নাম" : "School Name"}:</strong> ${escapeHtml(reportData.studentInfo.schoolName)}</p>
      <p><strong>${bengali ? "চূড়ান্ত সমন্বিত ফল" : "Final Aggregated Outcome"}:</strong> ${localizedFinalLevel}</p>
      <p><strong>${bengali ? "গড় ঝুঁকি স্কোর" : "Average Risk Score"}:</strong> ${reportData.avgRisk.toFixed(3)}</p>
      <p><strong>${bengali ? "মডেল সম্মতি" : "Model Agreement"}:</strong> ${bengali ? `তীব্র ভোট ${reportData.severeVotes}, মাঝারি ভোট ${reportData.moderateVotes}, মৃদু ভোট ${reportData.predictions.length - reportData.severeVotes - reportData.moderateVotes}` : `Severe votes ${reportData.severeVotes}, Moderate votes ${reportData.moderateVotes}, Mild votes ${reportData.predictions.length - reportData.severeVotes - reportData.moderateVotes}`}</p>
      <p><strong>${bengali ? "সিদ্ধান্তের স্থায়িত্ব" : "Decision Stability"}:</strong> ${localizedStability}</p>
      <p><strong>${bengali ? "সবচেয়ে সাবধানী মডেল" : "Most Cautious Model"}:</strong> ${reportData.consensus.mostCautious ? `${reportData.consensus.mostCautious.modelName} (${reportData.consensus.mostCautious.level})` : "-"}</p>
      <p><strong>${bengali ? "স্ক্রিনিং সারাংশ" : "Screening Summary"}:</strong> ${reportData.screening ? `${reportData.screening.label} (${(reportData.screening.confidence * 100).toFixed(1)}%)` : (bengali ? "চালানো হয়নি" : "Not run")}</p>
      <p><strong>${bengali ? "ডিকোডিং স্কোর" : "Decoding Score"}:</strong> ${reportData.screening && reportData.screening.readingDecodingScore !== undefined ? `${Number(reportData.screening.readingDecodingScore).toFixed(1)}%` : "-"}</p>
      <p><strong>${bengali ? "বক্তৃতা ফ্লুয়েন্সি" : "Speech Fluency"}:</strong> ${reportData.screening && reportData.screening.speechFluencyScore !== undefined ? `${Number(reportData.screening.speechFluencyScore).toFixed(1)}%` : "-"}</p>
      <p><strong>${bengali ? "প্রধান উদ্বেগ" : "Primary Concern"}:</strong> ${reportData.screening && reportData.screening.primaryConcern === "speech_fluency" ? (bengali ? "বক্তৃতা ফ্লুয়েন্সি" : "Speech fluency") : (reportData.screening ? (bengali ? "পড়া/ডিকোডিং" : "Reading/decoding") : "-")}</p>
      <p><strong>${bengali ? "স্পিচ থেরাপি সারাংশ" : "Speech Therapy Summary"}:</strong> ${reportData.therapy ? `${reportData.therapy.sessionBand} (${(reportData.therapy.overallScorePct || reportData.therapy.score * 100).toFixed(1)}%)` : "-"}</p>
      <p><strong>${bengali ? "ভিজ্যুয়াল ফোকাস সারাংশ" : "Visual Focus Summary"}:</strong> ${reportData.visualFocus ? `${localizeEyeStatusSummary(reportData.visualFocus.eyeStatus, bengali ? "Bengali" : "English")} (${(reportData.visualFocus.eyeOverallScore || 0).toFixed(1)}%)` : "-"}</p>
      <p><strong>${bengali ? "পরবর্তী করণীয়" : "Recommended Next Step"}:</strong> ${localizedRecommendation}</p>
      <p><strong>${bengali ? "তৈরির সময়" : "Generated At"}:</strong> ${generatedText}</p>
    `;
    return;
  }
  const readiness = getReportSourceReadiness();
  const defaultMessage = missing.length
    ? (bengali ? `বিস্তারিতের অপেক্ষায়: ${missing.join(", ")}` : `Waiting for details: ${missing.join(", ")}`)
    : readiness.ready
      ? (bengali ? "শিক্ষার্থীর তথ্য প্রস্তুত। আগে মডেল তুলনা চালান, তারপর চূড়ান্ত রিপোর্ট তৈরি করুন।" : "Student details ready. Run model comparison, then generate the final report.")
      : (bengali ? "প্রথমে স্ক্রিনিং, স্পিচ থেরাপি, এবং ভিজ্যুয়াল ফোকাস টেস্ট সম্পন্ন করুন।" : "Complete Screening, Speech Therapy, and the Visual Focus Test first.");
  node.innerHTML = `
    <p><strong>${bengali ? "শিক্ষার্থীর নাম" : "Student Name"}:</strong> ${escapeHtml(info.name || "-")}</p>
    <p><strong>${bengali ? "বয়স" : "Age"}:</strong> ${escapeHtml(info.age || "-")} | <strong>${bengali ? "শ্রেণি" : "Class"}:</strong> ${escapeHtml(info.studentClass || "-")} | <strong>${bengali ? "রোল নং" : "Roll No"}:</strong> ${escapeHtml(info.rollNo || "-")}</p>
    <p><strong>${bengali ? "সেকশন" : "Section"}:</strong> ${escapeHtml(info.section || "-")} | <strong>${bengali ? "বিদ্যালয়ের নাম" : "School Name"}:</strong> ${escapeHtml(info.schoolName || "-")}</p>
    <p><strong>${bengali ? "রিপোর্টের অবস্থা" : "Report Status"}:</strong> ${message || defaultMessage}</p>
  `;
}

function maybeAutoRunScreening() {
  if (!readingTestState.done || !audioFeatures.analyzed || !spellingFeatures.scored) return;
  if (screeningAutoRunTimer) clearTimeout(screeningAutoRunTimer);
  screeningAutoRunTimer = window.setTimeout(() => {
    const runButton = document.getElementById("runScreening");
    if (runButton) runButton.click();
    screeningAutoRunTimer = null;
  }, 250);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function buildLiveScreeningSnapshot() {
  const readingScore = clamp(Number(readingTestState.score || 0), 0, 100);
  const audioScore = clamp(Number(audioFeatures.comprehensionScore || 0) * 100, 0, 100);
  const spellingTotal = Math.max(1, Number(spellingFeatures.total || 0));
  const spellingErrors = Math.max(0, Number(spellingFeatures.errors || 0));
  const spellingCorrect = Math.max(0, spellingTotal - spellingErrors);
  const spellingScore = clamp((spellingCorrect / spellingTotal) * 100, 0, 100);
  const pronunciationErrors = Math.max(0, Number(audioFeatures.pronunciationProxy || 0));
  const readingTimeSeconds = Math.max(0, Number(readingTestState.seconds || 0));
  const hesitationCount = Math.max(0, Number(readingTestState.hesitations || 0));
  const repetitionCount = Math.max(0, Math.round((1 - Number(audioFeatures.comprehensionScore || 0)) * 4));
  const omissionCount = Math.max(0, Math.round((readingTimeSeconds > 45 ? 2 : 0) + (hesitationCount > 4 ? 1 : 0) + ((audioFeatures.reloadCount || 0) > 0 ? 1 : 0)));
  const readingWpm = Math.max(0, Number(readingTestState.wpm || 0));
  const segmentOverallScore = (readingScore + audioScore + spellingScore) / 3;
  return {
    readingScore,
    audioScore,
    spellingScore,
    segmentOverallScore,
    spellingErrors,
    spellingCorrect,
    spellingTotal,
    pronunciationErrors,
    readingTimeSeconds,
    hesitationCount,
    repetitionCount,
    omissionCount,
    readingWpm,
    reloadCount: Math.max(0, Number(audioFeatures.reloadCount || 0)),
    wrongAttempts: Math.max(0, Number(audioFeatures.wrongAttempts || 0)),
    listeningEfficiency: clamp(Number(audioFeatures.comprehensionScore || 0), 0, 1),
  };
}

async function scoreScreeningViaBackend(language) {
  const snapshot = buildLiveScreeningSnapshot();
  const response = await fetch(apiUrl("/api/screen"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...snapshot,
      language,
      uiLanguage: isBengaliUi() ? "Bengali" : "English",
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Screening failed");
  }
  return {
    ...snapshot,
    ...data,
  };
}

function summarizeRecord(record) {
  const bengali = isBengaliUi();
  if (!record || typeof record !== "object") return "No summary available.";
  switch (record.type) {
    case "screening":
      return bengali
        ? `${record.language || "অজানা"} স্ক্রিনিং: পড়ার ক্ষমতা ${Number(record.readingDecodingScore ?? record.readingScore ?? 0).toFixed(1)}%, বক্তৃতা ফ্লুয়েন্সি ${Number(record.speechFluencyScore ?? 0).toFixed(1)}%`
        : `${record.language || "Unknown"} screening: reading ability ${Number(record.readingDecodingScore ?? record.readingScore ?? 0).toFixed(1)}%, speech fluency ${Number(record.speechFluencyScore ?? 0).toFixed(1)}%`;
    case "therapy":
      return bengali
        ? `${record.sessionType || "সেশন"} - ${record.target || "লক্ষ্য"} স্কোর ${(record.overallScorePct || (record.score || 0) * 100).toFixed(1)}%`
        : `${record.sessionType || "Session"} on ${record.target || "target"} scored ${(record.overallScorePct || (record.score || 0) * 100).toFixed(1)}%`;
    case "eye_tracking":
      return bengali
        ? `ভিজ্যুয়াল পরীক্ষা ${record.preset || "সেশন"} - প্রথম চেষ্টার নির্ভুলতা ${Number(record.fixationScore || 0).toFixed(1)}%`
        : `Visual test ${record.preset || "session"} with ${Number(record.fixationScore || 0).toFixed(1)}% first-try accuracy`;
    case "biomarkers":
      return bengali
        ? `${record.analyzed_samples || 0}টি নমুনা বিশ্লেষণ হয়েছে, ${(record.biomarkers || []).length}টি মার্কার দেখানো হয়েছে`
        : `${record.analyzed_samples || 0} samples analyzed, ${(record.biomarkers || []).length} biomarkers shown`;
    case "final_report":
      return bengali
        ? `${record.finalLevel || "অজানা"} ঝুঁকি রিপোর্ট, গড় ঝুঁকি ${(record.avgRisk || 0).toFixed(3)}`
        : `${record.finalLevel || "Unknown"} risk report, average risk ${(record.avgRisk || 0).toFixed(3)}`;
    case "model_selection":
      return bengali
        ? `${record.selectedModel || "অজানা"} নির্বাচন, গড় ঝুঁকি ${(Number(record.averageRisk ?? record.avgRisk ?? 0)).toFixed(3)}`
        : `${record.selectedModel || "Unknown"} selection, average risk ${(Number(record.averageRisk ?? record.avgRisk ?? 0)).toFixed(3)}`;
    default:
      return Object.keys(record).slice(0, 4).join(", ");
  }
}

function classifyBiomarkerFamily(name) {
  const key = String(name || "").toLowerCase();
  if (/eye|gaze|fix|saccade|regress/.test(key)) return "Eye Tracking";
  if (/speech|pron|syll|phon|audio|voice|substitution/.test(key)) return "Speech";
  if (/hand|stroke|press|letter|write|graph/.test(key)) return "Handwriting";
  if (/read|fluency|hesit|decode|comprehension|wpm/.test(key)) return "Reading";
  if (/time|duration|latency|pace/.test(key)) return "Timing";
  return "General";
}

function biomarkerInterpretation(row) {
  const bengali = isBengaliUi();
  const direction = row.correlation >= 0 ? "higher risk" : "lower risk";
  if (bengali) {
    const directionBn = row.correlation >= 0 ? "উচ্চ ঝুঁকির" : "কম ঝুঁকির";
    if (row.importance >= 0.5) return `${directionBn} সঙ্গে দৃঢ়ভাবে সম্পর্কিত চিহ্ন।`;
    if (row.importance >= 0.25) return `${directionBn} সঙ্গে মাঝারি ভাবে সম্পর্কিত চিহ্ন।`;
    return `${directionBn} সঙ্গে দুর্বল কিন্তু ব্যবহারযোগ্য চিহ্ন।`;
  }
  if (row.importance >= 0.5) return `Strong marker linked with ${direction}.`;
  if (row.importance >= 0.25) return `Moderate marker linked with ${direction}.`;
  return `Weak but usable marker linked with ${direction}.`;
}

function setBiomarkerMetric(id, value) {
  const node = document.getElementById(id);
  if (!node) return;
  node.textContent = value;
}

function resetBiomarkerView(message = null) {
  const summaryNode = document.getElementById("biomarkerSummary");
  const summaryTextNode = document.getElementById("biomarkerSummaryText");
  const tableNode = document.getElementById("biomarkerTable");
  const bengali = isBengaliUi();
  const defaultMessage = bengali
    ? "একটি ডেটাসেট আপলোড করুন এবং বিশ্লেষণ চালিয়ে এখানে সহজ ভাষায় বায়োমার্কার সারাংশ দেখুন।"
    : "Upload a dataset and run the analysis to see a plain-language biomarker summary here.";
  if (summaryNode) {
    if (summaryTextNode) {
      summaryTextNode.textContent = message || defaultMessage;
    } else {
      summaryNode.innerHTML = `<p class="mb-0 text-muted">${message || defaultMessage}</p>`;
    }
  }
  if (tableNode) tableNode.innerHTML = `<tr><td colspan="5" class="text-muted">${bengali ? "বায়োমার্কার ফলাফল দেখতে বিশ্লেষণ চালান।" : "Run the analysis to see biomarker results."}</td></tr>`;
  setBiomarkerMetric("biomarkerSamplesMetric", "-");
  setBiomarkerMetric("biomarkerEvaluatedMetric", "-");
  setBiomarkerMetric("biomarkerShownMetric", "-");
  setBiomarkerMetric("biomarkerStrongestMetric", "-");
  if (biomarkerChart) {
    biomarkerChart.destroy();
    biomarkerChart = null;
  }
}

function detectLikelyLabelColumns(header) {
  const exactPriority = ["label", "risk_label", "class", "target", "outcome"];
  const exactMatches = exactPriority.filter((name) => header.includes(name));
  const fuzzyMatches = header.filter((name) => /(label|risk|class|target|outcome)/i.test(name) && !exactMatches.includes(name));
  return [...exactMatches, ...fuzzyMatches];
}

function normalizeTableHeaderCell(value) {
  return String(value || "").trim().replace(/\s+/g, "_");
}

function splitTableLine(line, delimiter) {
  if (delimiter instanceof RegExp) {
    return line.trim().split(delimiter).map((cell) => cell.trim());
  }
  return line.split(delimiter).map((cell) => cell.trim());
}

function detectTableDelimiter(lines) {
  const sampleLine = lines.find((line) => String(line || "").trim()) || "";
  if (sampleLine.includes("\t")) return "\t";
  const candidates = [",", "|", ";"];
  let best = null;
  let bestScore = 0;
  for (const candidate of candidates) {
    const score = lines.slice(0, 5).reduce((sum, line) => sum + ((line.match(new RegExp(`\\${candidate}`, "g")) || []).length), 0);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  if (best) return best;
  if (/\s{2,}/.test(sampleLine)) return /\s{2,}/;
  return ",";
}

function parseTabularText(text) {
  const lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) {
    return { error: "The uploaded file does not contain a readable table with a header row and data rows." };
  }
  const delimiter = detectTableDelimiter(lines);
  const header = splitTableLine(lines[0], delimiter).map(normalizeTableHeaderCell);
  if (header.length < 2) {
    return { error: "The header row could not be read properly. Please use a clear table with separate columns." };
  }
  const rows = lines.slice(1)
    .map((line) => splitTableLine(line, delimiter))
    .filter((cells) => cells.some((cell) => cell.length));
  return { header, rows };
}

async function readBiomarkerUpload(file) {
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith(".csv")) {
    return file.text();
  }
  throw new Error("Unsupported file type. Please use a CSV file.");
}

function updateBiomarkerFileInfo(file, header = [], rowCount = 0) {
  const statusNode = document.getElementById("biomarkerFileStatus");
  const infoNode = document.getElementById("biomarkerDetectedInfo");
  const suggestionList = document.getElementById("labelColumnSuggestions");
  const labelInput = document.getElementById("labelColumn");
  const bengali = isBengaliUi();
  if (suggestionList) suggestionList.innerHTML = "";
  const biomarkerStep1Title = document.getElementById("biomarkerStep1Title");
  if (biomarkerStep1Title) biomarkerStep1Title.textContent = bengali ? "ধাপ ১: ডেটাসেট আপলোড করুন" : "Step 1: Upload Dataset";
  const biomarkerDatasetLabel = document.getElementById("biomarkerDatasetLabel");
  if (biomarkerDatasetLabel) biomarkerDatasetLabel.textContent = bengali ? "ডেটাসেট CSV" : "Dataset CSV";
  const biomarkerFileTypeBadge = document.getElementById("biomarkerFileTypeBadge");
  if (biomarkerFileTypeBadge) biomarkerFileTypeBadge.textContent = bengali ? "শুধু CSV" : "CSV only";
  const biomarkerStep2Title = document.getElementById("biomarkerStep2Title");
  if (biomarkerStep2Title) biomarkerStep2Title.textContent = bengali ? "ধাপ ২: বিশ্লেষণ সেটিংস বেছে নিন" : "Step 2: Choose Analysis Settings";
  const biomarkerLabelHint = document.getElementById("biomarkerLabelHint");
  if (biomarkerLabelHint) biomarkerLabelHint.textContent = bengali ? "সিস্টেম যদি সম্ভাব্য লেবেল কলাম শনাক্ত করে, তা স্বয়ংক্রিয়ভাবে সাজেস্ট করবে।" : "If the system detects a likely label column, it will suggest it automatically.";
  const biomarkerImportanceHint = document.getElementById("biomarkerImportanceHint");
  if (biomarkerImportanceHint) biomarkerImportanceHint.textContent = bengali ? "কম মানে আরও মার্কার দেখাবে। বেশি মানে শুধু শক্তিশালী সিগন্যাল দেখাবে।" : "Lower values show more markers. Higher values keep only stronger signals.";
  const biomarkerSamplesLabel = document.getElementById("biomarkerSamplesLabel");
  if (biomarkerSamplesLabel) biomarkerSamplesLabel.textContent = bengali ? "নমুনা" : "Samples";
  const biomarkerEvaluatedLabel = document.getElementById("biomarkerEvaluatedLabel");
  if (biomarkerEvaluatedLabel) biomarkerEvaluatedLabel.textContent = bengali ? "পরীক্ষিত মার্কার" : "Markers Checked";
  const biomarkerShownLabel = document.getElementById("biomarkerShownLabel");
  if (biomarkerShownLabel) biomarkerShownLabel.textContent = bengali ? "দেখানো মার্কার" : "Markers Shown";
  const biomarkerStrongestLabel = document.getElementById("biomarkerStrongestLabel");
  if (biomarkerStrongestLabel) biomarkerStrongestLabel.textContent = bengali ? "সবচেয়ে শক্তিশালী সিগন্যাল" : "Strongest Signal";
  const runBiomarkersButton = document.getElementById("runBiomarkers");
  if (runBiomarkersButton) runBiomarkersButton.textContent = bengali ? "বায়োমার্কার বিশ্লেষণ করুন" : "Analyze Biomarkers";
  const resetBiomarkersButton = document.getElementById("resetBiomarkers");
  if (resetBiomarkersButton) resetBiomarkersButton.textContent = bengali ? "রিসেট" : "Reset";
  const biomarkerSummaryText = document.getElementById("biomarkerSummaryText");
  if (biomarkerSummaryText && !file) {
    biomarkerSummaryText.textContent = bengali
      ? "একটি ডেটাসেট আপলোড করুন এবং বিশ্লেষণ চালিয়ে এখানে সহজ ভাষায় বায়োমার্কার সারাংশ দেখুন।"
      : "Upload a dataset and run the analysis to see a plain-language biomarker summary here.";
  }

  if (!file) {
    if (statusNode) statusNode.textContent = bengali ? "এখনও কোনো ডেটাসেট নির্বাচন করা হয়নি।" : "No dataset selected yet.";
    if (infoNode) {
      infoNode.innerHTML = `
        <h6 class="mb-2">${bengali ? "প্রয়োজনীয় ফাইল শর্ত" : "Mandatory file requirements"}</h6>
        <p class="small mb-2">${bengali ? "নির্ভরযোগ্য বায়োমার্কার বিশ্লেষণের জন্য আপনার ফাইলে থাকতে হবে:" : "For reliable biomarker analysis, your file must include:"}</p>
        <ul class="small mb-0 ps-3">
          <li>${bengali ? "একটি স্পষ্ট শিরোনাম সারিসহ একটি গঠিত টেবিল" : "one structured table with a clear header row"}</li>
          <li>${bengali ? "একটি লেবেল কলাম যেমন <code>label</code>, <code>risk_label</code>, <code>class</code>, বা <code>target</code>" : "one label column such as <code>label</code>, <code>risk_label</code>, <code>class</code>, or <code>target</code>"}</li>
          <li>${bengali ? "পড়ার গতি, ত্রুটি সংখ্যা, দ্বিধা সংখ্যা, gaze মান, বা সময় মানের মতো সংখ্যাসূচক ফিচার কলাম" : "numeric feature columns such as reading speed, error count, hesitation count, gaze values, or timing values"}</li>
          <li>${bengali ? "প্রতি সারিতে একটি নমুনা" : "one sample per row"}</li>
        </ul>
      `;
    }
    return;
  }

  const suggestions = detectLikelyLabelColumns(header);
  if (suggestionList) {
    suggestionList.innerHTML = suggestions.map((name) => `<option value="${name}"></option>`).join("");
  }
  if (labelInput && suggestions.length && (!labelInput.value || labelInput.value === "label")) {
    labelInput.value = suggestions[0];
  }
  if (statusNode) {
    statusNode.textContent = bengali
      ? `${file.name} নির্বাচন করা হয়েছে। ${rowCount} ডেটা সারি এবং ${header.length} কলাম পাওয়া গেছে।`
      : `Selected ${file.name}. Found ${rowCount} data rows and ${header.length} columns.`;
  }
  if (infoNode) {
    infoNode.innerHTML = bengali
      ? `
        <h6 class="mb-2">সনাক্ত করা ডেটাসেট প্রিভিউ</h6>
        <p class="small mb-1"><strong>ফাইলের ধরন:</strong> CSV</p>
        <p class="small mb-1"><strong>সারি:</strong> ${rowCount}</p>
        <p class="small mb-1"><strong>কলাম:</strong> ${header.length}</p>
        <p class="small mb-0"><strong>প্রস্তাবিত লেবেল কলাম:</strong> ${suggestions.length ? suggestions.join(", ") : "স্পষ্ট কোনো লেবেল কলাম পাওয়া যায়নি। ম্যানুয়ালি দিন।"}</p>
      `
      : `
        <h6 class="mb-2">Detected dataset preview</h6>
      <p class="small mb-1"><strong>File type:</strong> CSV</p>
      <p class="small mb-1"><strong>Rows:</strong> ${rowCount}</p>
      <p class="small mb-1"><strong>Columns:</strong> ${header.length}</p>
      <p class="small mb-0"><strong>${bengali ? "প্রস্তাবিত লেবেল কলাম:" : "Suggested label columns:"}</strong> ${suggestions.length ? suggestions.join(", ") : (bengali ? "স্পষ্ট কোনো লেবেল কলাম পাওয়া যায়নি। ম্যানুয়ালি দিন।" : "No obvious label column detected. Enter it manually.")}</p>
      `;
  }
}

const THERAPY_RESPONSE_THRESHOLDS = {
  "Sound Drill": 0.52,
  "Syllable Drill": 0.58,
  "Word Reading": 0.62,
  "Phrase Practice": 0.66,
  "Sentence Reading": 0.7,
};

function normalizeTherapyText(text, language) {
  const raw = String(text || "").toLowerCase().trim();
  if (!raw) return "";
  if (language === "English") {
    return raw.replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();
  }
  return raw.replace(/[.,!?;:"'“”‘’()[\]{}<>/\\|`~@#$%^&*_+=\-।]/g, "").replace(/\s+/g, " ").trim();
}

function levenshteinDistance(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp = Array.from({ length: rows }, () => Array(cols).fill(0));
  for (let i = 0; i < rows; i += 1) dp[i][0] = i;
  for (let j = 0; j < cols; j += 1) dp[0][j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[a.length][b.length];
}

function therapySimilarity(prompt, transcript, language) {
  const a = normalizeTherapyText(prompt, language);
  const b = normalizeTherapyText(transcript, language);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const joinedA = a.replace(/\s+/g, "");
  const joinedB = b.replace(/\s+/g, "");
  const distance = levenshteinDistance(joinedA, joinedB);
  const maxLen = Math.max(joinedA.length, joinedB.length, 1);
  return clamp(1 - (distance / maxLen), 0, 1);
}

function countTherapyRepetitions(text, language) {
  const tokens = normalizeTherapyText(text, language).split(" ").filter(Boolean);
  let repetitions = 0;
  for (let i = 1; i < tokens.length; i += 1) {
    if (tokens[i] === tokens[i - 1]) repetitions += 1;
  }
  return repetitions;
}

function uniqueTherapyPrompts(items) {
  return [...new Set(items.map((item) => String(item || "").trim()).filter(Boolean))];
}

function buildSoundDrillPrompts(target, relatedTargets) {
  const same = `${target} ${target}`;
  const triple = `${target} ${target} ${target}`;
  return uniqueTherapyPrompts([target, same, triple, ...relatedTargets]);
}

function buildSyllableDrillPrompts(target, relatedTargets) {
  const pair = `${target} ${target}`;
  const chain = `${target} ${target} ${target}`;
  return uniqueTherapyPrompts([target, pair, chain, ...relatedTargets]);
}

function buildReadingPrompts(target, relatedTargets) {
  return uniqueTherapyPrompts([target, ...relatedTargets]);
}

function setTherapyListening(active) {
  const node = document.getElementById("therapyListeningIndicator");
  if (!node) return;
  node.classList.toggle("d-none", !active);
}

function stopTherapyDurationTimer() {
  if (!therapyDurationTimer) return;
  clearInterval(therapyDurationTimer);
  therapyDurationTimer = null;
}

function clearTherapyAutoCaptureTimer() {
  if (!therapyAutoCaptureTimer) return;
  clearTimeout(therapyAutoCaptureTimer);
  therapyAutoCaptureTimer = null;
}

function startTherapyDurationTimer() {
  stopTherapyDurationTimer();
  therapyDurationTimer = window.setInterval(() => {
    if (!therapyRoundState.active || !therapyRoundState.startedAt) {
      stopTherapyDurationTimer();
      return;
    }
    syncTherapyInputsFromRound();
  }, 150);
}

function resetTherapyRecognitionCycle() {
  if (!therapyRecognition || !therapyRecognition.__therapyState) return;
  therapyRecognition.__therapyState.liveTranscript = "";
  therapyRecognition.__therapyState.finalTranscript = "";
  therapyRecognition.__therapyState.captureHandled = false;
  therapyRecognition.__therapyState.captureStartedAt = performance.now();
  therapyRecognition.__therapyState.clearCaptureSettleTimer();
}

function stopTherapyVoiceMonitor() {
  if (therapyVoiceMonitorTimer) {
    clearInterval(therapyVoiceMonitorTimer);
    therapyVoiceMonitorTimer = null;
  }
  therapyVoiceMonitorActive = false;
  therapyAnalyser = null;
  therapyAudioData = null;
  therapyVoiceRmsEma = 0;
  therapyVoiceNoiseFloor = 0.006;
  therapyVoiceSpeechThreshold = 0.018;
  therapyVoiceSilenceThreshold = 0.010;
  therapyVoiceCalibrationEndsAt = 0;
  therapyVoiceIsSpeaking = false;
  therapyVoiceSpeechStartedAt = 0;
  therapyVoiceSilenceStartedAt = 0;
  therapyVoiceHandledCurrentPrompt = false;
  if (therapyAudioContext) {
    try {
      therapyAudioContext.close();
    } catch (_error) {
      // Ignore audio context shutdown errors.
    }
  }
  therapyAudioContext = null;
}

function resetTherapyVoicePromptState() {
  therapyVoiceIsSpeaking = false;
  therapyVoiceSpeechStartedAt = 0;
  therapyVoiceSilenceStartedAt = 0;
  therapyVoiceHandledCurrentPrompt = false;
}

function completeTherapyVoicePrompt() {
  if (!therapyRoundState.active || therapyVoiceHandledCurrentPrompt) return;
  therapyVoiceHandledCurrentPrompt = true;
  const transcript = fallbackTherapyTranscript();
  setTherapyRoundStatus("Voice captured. Moving to the next practice automatically.", transcript);
  evaluateTherapyResponse(transcript);
}

function sampleTherapyVoiceActivity() {
  if (!therapyVoiceMonitorActive || !therapyAnalyser || !therapyAudioData || therapyVoiceHandledCurrentPrompt) return;
  therapyAnalyser.getByteTimeDomainData(therapyAudioData);
  let sum = 0;
  for (let i = 0; i < therapyAudioData.length; i += 1) {
    const v = (therapyAudioData[i] - 128) / 128;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / therapyAudioData.length);
  therapyVoiceRmsEma = (therapyVoiceRmsEma * 0.82) + (rms * 0.18);
  const now = performance.now();

  if (now < therapyVoiceCalibrationEndsAt) {
    therapyVoiceNoiseFloor = Math.max(0.0035, (therapyVoiceNoiseFloor * 0.92) + (therapyVoiceRmsEma * 0.08));
  } else {
    if (!therapyVoiceIsSpeaking) {
      therapyVoiceNoiseFloor = (therapyVoiceNoiseFloor * 0.97) + (therapyVoiceRmsEma * 0.03);
    }
    therapyVoiceSpeechThreshold = Math.max(0.014, therapyVoiceNoiseFloor * 3.0);
    therapyVoiceSilenceThreshold = Math.max(0.008, therapyVoiceNoiseFloor * 1.75);
  }

  const speakingNow = therapyVoiceRmsEma > (therapyVoiceIsSpeaking ? therapyVoiceSilenceThreshold : therapyVoiceSpeechThreshold);
  if (speakingNow) {
    if (!therapyVoiceIsSpeaking) {
      therapyVoiceSpeechStartedAt = now;
    }
    therapyVoiceIsSpeaking = true;
    therapyVoiceSilenceStartedAt = 0;
    return;
  }

  if (therapyVoiceIsSpeaking) {
    if (!therapyVoiceSilenceStartedAt) {
      therapyVoiceSilenceStartedAt = now;
      return;
    }
    const speechDurationMs = therapyVoiceSpeechStartedAt ? (therapyVoiceSilenceStartedAt - therapyVoiceSpeechStartedAt) : 0;
    const silenceDurationMs = now - therapyVoiceSilenceStartedAt;
    if (speechDurationMs >= 450 && silenceDurationMs >= 850) {
      therapyVoiceIsSpeaking = false;
      therapyVoiceSpeechStartedAt = 0;
      therapyVoiceSilenceStartedAt = 0;
      completeTherapyVoicePrompt();
    }
  }
}

async function startTherapyVoiceMonitor() {
  if (!therapyMediaStream) return false;
  if (therapyVoiceMonitorActive) return true;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return false;
    therapyAudioContext = new Ctx();
    const source = therapyAudioContext.createMediaStreamSource(therapyMediaStream);
    therapyAnalyser = therapyAudioContext.createAnalyser();
    therapyAnalyser.fftSize = 256;
    therapyAnalyser.smoothingTimeConstant = 0.82;
    source.connect(therapyAnalyser);
    therapyAudioData = new Uint8Array(therapyAnalyser.fftSize);
    therapyVoiceMonitorActive = true;
    therapyVoiceRmsEma = 0;
    therapyVoiceNoiseFloor = 0.006;
    therapyVoiceSpeechThreshold = 0.018;
    therapyVoiceSilenceThreshold = 0.010;
    therapyVoiceCalibrationEndsAt = performance.now() + 1200;
    resetTherapyVoicePromptState();
    therapyVoiceMonitorTimer = window.setInterval(sampleTherapyVoiceActivity, 80);
    return true;
  } catch (_error) {
    stopTherapyVoiceMonitor();
    return false;
  }
}

async function ensureTherapyMicrophoneAccess() {
  if (therapyMediaStream) return true;
  if (!navigator.mediaDevices?.getUserMedia) {
    setTherapyRoundStatus("This browser does not support microphone access for the therapy round.");
    return false;
  }
  try {
    therapyMediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx && therapyAudioContext && therapyAudioContext.state === "suspended") {
      try { await therapyAudioContext.resume(); } catch (_err) {}
    }
    return true;
  } catch (error) {
    setTherapyRoundStatus(describeMicAccessError(error, "Speech therapy"));
    return false;
  }
}

function releaseTherapyMicrophone() {
  stopTherapyVoiceMonitor();
  if (!therapyMediaStream) return;
  therapyMediaStream.getTracks().forEach((track) => track.stop());
  therapyMediaStream = null;
}

function setTherapyRoundStatus(message, transcript = "") {
  const statusNode = document.getElementById("therapyRoundStatus");
  const transcriptNode = document.getElementById("therapyTranscriptText");
  const bengali = isBengaliUi();
  if (statusNode) statusNode.textContent = message;
  if (transcriptNode) {
    transcriptNode.textContent = transcript || (bengali ? "এখনও কোনো উত্তর ধরা হয়নি।" : "No response captured yet.");
    transcriptNode.className = transcript ? "mb-0 small" : "mb-0 small text-muted";
  }
}

function updateTherapyControlState() {
  const startBtn = document.getElementById("startTherapyRound");
  const captureBtn = document.getElementById("captureTherapyResponse");
  const active = !!therapyRoundState.active;
  if (startBtn) startBtn.disabled = active;
  if (captureBtn) captureBtn.disabled = !active;
}

function updateTherapyPromptUI() {
  const promptNode = document.getElementById("therapyPromptText");
  const progressNode = document.getElementById("therapyRoundProgress");
  updateTherapyControlState();
  const bengali = isBengaliUi();
  if (!promptNode || !progressNode) return;
  if (!therapyRoundState.active || !therapyRoundState.prompts.length) {
    promptNode.textContent = bengali ? "কথা বলার অনুশীলন শুরু করতে রাউন্ড শুরু চাপুন।" : "Press Start Round to begin the speaking practice.";
    progressNode.textContent = bengali ? "রাউন্ড শুরু হয়নি।" : "Round not started.";
    return;
  }
  const prompt = therapyRoundState.prompts[therapyRoundState.currentIndex] || "";
  promptNode.textContent = prompt;
  progressNode.textContent = bengali
    ? `অনুশীলন ${therapyRoundState.currentIndex + 1} / ${therapyRoundState.prompts.length}`
    : `Practice ${therapyRoundState.currentIndex + 1} of ${therapyRoundState.prompts.length}`;
  resetTherapyVoicePromptState();
}

function syncTherapyInputsFromRound() {
  const results = therapyRoundState.results;
  const successfulTrials = results.filter((item) => item.success).length;
  const pronunciationErrors = results.reduce((sum, item) => sum + item.pronError, 0);
  const repetitions = results.reduce((sum, item) => sum + item.repetitions, 0);
  const substitutions = results.reduce((sum, item) => sum + item.substitutions, 0);
  const selfCorrections = results.reduce((sum, item) => sum + item.selfCorrection, 0);
  const avgSimilarity = results.length ? results.reduce((sum, item) => sum + item.similarity, 0) / results.length : 0;
  const elapsedSec = therapyRoundState.startedAt ? (performance.now() - therapyRoundState.startedAt) / 1000 : 0;
  const attention = clamp(Math.round(1 + ((results.length / Math.max(1, therapyRoundState.prompts.length)) * 2) + (avgSimilarity * 2)), 1, 5);
  const breath = clamp(Math.round(5 - Math.min(2, repetitions / 2) - Math.min(1, substitutions / 3)), 1, 5);
  const intelligibility = clamp(Math.round(1 + (avgSimilarity * 4)), 1, 5);

  const assign = (id, value) => {
    const node = document.getElementById(id);
    if (node) node.value = String(value);
  };
  assign("therapyDuration", elapsedSec > 0 ? elapsedSec.toFixed(1) : "0.0");
  assign("therapySuccess", successfulTrials);
  assign("therapyTrials", therapyRoundState.prompts.length || 0);
  assign("therapyPron", pronunciationErrors);
  assign("therapyRep", repetitions);
  assign("therapySub", substitutions);
  assign("therapySelfCorrect", selfCorrections);
  assign("therapyAttention", attention);
  assign("therapyBreath", breath);
  assign("therapyIntelligibility", intelligibility);
}

function getTherapyPromptSet(language, sessionType, target, count = 5) {
  const options = getTherapyTargetList(language, sessionType);
  const fallbackTarget = options[0] || "s";
  const selectedTarget = target || fallbackTarget;
  const relatedTargets = shuffle(options.filter((option) => option !== selectedTarget));
  let base;
  if (sessionType === "Sound Drill") {
    base = buildSoundDrillPrompts(selectedTarget, relatedTargets);
  } else if (sessionType === "Syllable Drill") {
    base = buildSyllableDrillPrompts(selectedTarget, relatedTargets);
  } else {
    base = buildReadingPrompts(selectedTarget, relatedTargets);
  }
  const prompts = [];
  while (prompts.length < count) {
    prompts.push(base[prompts.length % base.length]);
  }
  return prompts;
}

async function startTherapyRound() {
  const language = document.getElementById("therapyLanguage")?.value || "Bengali";
  const sessionType = document.getElementById("therapyType")?.value || "Sound Drill";
  const target = (document.getElementById("therapyTarget")?.value || "").trim() || "s";
  const difficulty = document.getElementById("therapyDifficulty")?.value || "Guided";
  const cueLevel = document.getElementById("therapyCueLevel")?.value || "Moderate Cueing";
  const promptCount = clamp(Math.max(3, Math.min(6, n("therapyTrials") || 5)), 3, 6);
  therapyRecognitionPrimed = false;
  therapyRecognitionPurpose = "idle";
  clearTherapyAutoCaptureTimer();
  setTherapyRoundStatus("Getting the round ready and enabling automatic listening...");
  const recognition = ensureTherapyRecognition();
  if (!recognition && !(window.AudioContext || window.webkitAudioContext)) {
    therapyRoundState = {
      active: true,
      prompts: getTherapyPromptSet(language, sessionType, target, promptCount),
      currentIndex: 0,
      results: [],
      startedAt: performance.now(),
      promptShownAt: performance.now(),
      language,
      sessionType,
      target,
      difficulty,
      cueLevel,
      captureTranscript: "",
      finishRequested: false,
      micReady: false,
    };
    updateTherapyPromptUI();
    syncTherapyInputsFromRound();
    startTherapyDurationTimer();
    setTherapyRoundStatus("Round started, but live spoken-response capture is not available in this browser. Please use Chrome or Edge for the live round.");
    return;
  }
  const micReady = await ensureTherapyMicrophoneAccess();
  if (!micReady) {
    therapyRoundState.active = false;
    therapyRoundState.micReady = false;
    stopTherapyDurationTimer();
    updateTherapyPromptUI();
    return;
  }
  therapyRoundState = {
    active: true,
    prompts: getTherapyPromptSet(language, sessionType, target, promptCount),
    currentIndex: 0,
    results: [],
    startedAt: performance.now(),
    promptShownAt: performance.now(),
    language,
    sessionType,
    target,
    difficulty,
    cueLevel,
    captureTranscript: "",
    finishRequested: false,
    micReady: true,
  };
  updateTherapyPromptUI();
  syncTherapyInputsFromRound();
  startTherapyDurationTimer();
  const voiceMonitorReady = await startTherapyVoiceMonitor();
  if (!voiceMonitorReady && !recognition) {
    therapyRoundState.active = false;
    therapyRoundState.micReady = false;
    stopTherapyDurationTimer();
    releaseTherapyMicrophone();
    updateTherapyPromptUI();
    setTherapyRoundStatus("This browser could not start the live therapy microphone monitor. Please try Chrome or Edge.");
    return;
  }
  setTherapyRoundStatus("Round started. The system is listening automatically for this prompt.");
  if (!voiceMonitorReady) {
    queueTherapyAutoCapture(250);
  }
}

function moveToNextTherapyPrompt() {
  if (!therapyRoundState.active) {
    setTherapyRoundStatus("Start the round first.");
    return;
  }
  if (therapyRoundState.currentIndex >= therapyRoundState.prompts.length - 1) {
    setTherapyRoundStatus("This is the last practice item. Click Finish Round when you are done.", therapyRoundState.captureTranscript);
    return;
  }
  therapyRoundState.currentIndex += 1;
  therapyRoundState.captureTranscript = "";
  therapyRoundState.promptShownAt = performance.now();
  updateTherapyPromptUI();
  setTherapyRoundStatus("Next practice is ready. The system is listening automatically.");
  queueTherapyAutoCapture(350);
}

function finalizeTherapyRoundAndAnalyze() {
  if (!therapyRoundState.results.length) {
    setTherapyRoundStatus("Please complete at least one spoken response before finishing the round.");
    return;
  }
  therapyRoundState.active = false;
  therapyRoundState.finishRequested = false;
  therapyRoundState.micReady = false;
  therapyContinuousRequested = false;
  clearTherapyAutoCaptureTimer();
  stopTherapyDurationTimer();
  syncTherapyInputsFromRound();
  setTherapyListening(false);
  if (therapyRecognitionRunning && therapyRecognition) {
    try {
      therapyRecognition.stop();
    } catch (_error) {
      // Ignore stop errors during cleanup.
    }
  }
  releaseTherapyMicrophone();
  updateTherapyPromptUI();
  setTherapyRoundStatus("Therapy round finished. Your result is being prepared automatically.", therapyRoundState.captureTranscript);
  analyzeTherapySession();
}

function resolveTherapyPrime(result) {
  if (!therapyRecognitionPrimeResolver) return;
  const resolver = therapyRecognitionPrimeResolver;
  therapyRecognitionPrimeResolver = null;
  resolver(result);
}

function evaluateTherapyResponse(transcript) {
  const prompt = therapyRoundState.prompts[therapyRoundState.currentIndex] || "";
  const language = therapyRoundState.language;
  const sessionType = therapyRoundState.sessionType || "Sound Drill";
  const target = therapyRoundState.target || prompt;
  const similarity = therapySimilarity(prompt, transcript, language);
  const targetSimilarity = therapySimilarity(target, transcript, language);
  const blendedSimilarity = clamp((similarity * 0.7) + (targetSimilarity * 0.3), 0, 1);
  const successThreshold = THERAPY_RESPONSE_THRESHOLDS[sessionType] || 0.62;
  const success = blendedSimilarity >= successThreshold;
  const repetitions = countTherapyRepetitions(transcript, language);
  const substitutions = blendedSimilarity >= successThreshold + 0.15 ? 0 : blendedSimilarity >= successThreshold ? 1 : 2;
  const pronError = success ? 0 : blendedSimilarity >= Math.max(0.45, successThreshold - 0.12) ? 1 : 2;
  const previous = therapyRoundState.results.find((item) => item.promptIndex === therapyRoundState.currentIndex);
  const selfCorrection = previous && blendedSimilarity > previous.similarity + 0.12 ? 1 : 0;
  const result = {
    promptIndex: therapyRoundState.currentIndex,
    prompt,
    transcript,
    similarity: blendedSimilarity,
    success,
    repetitions,
    substitutions,
    pronError,
    selfCorrection,
  };
  if (previous) {
    const index = therapyRoundState.results.indexOf(previous);
    therapyRoundState.results[index] = result;
  } else {
    therapyRoundState.results.push(result);
  }
  therapyRoundState.captureTranscript = transcript;
  syncTherapyInputsFromRound();
  const scoreMessage = `Response captured. Match score ${(blendedSimilarity * 100).toFixed(1)}%.`;
  setTherapyRoundStatus(
    `${scoreMessage} Moving to the next practice automatically.`,
    transcript,
  );
  if (therapyRoundState.currentIndex >= therapyRoundState.prompts.length - 1) {
    window.setTimeout(() => {
      if (therapyRoundState.active) finalizeTherapyRoundAndAnalyze();
    }, 700);
    return;
  }
  window.setTimeout(() => {
    if (therapyRoundState.active) moveToNextTherapyPrompt();
  }, 700);
}

function fallbackTherapyTranscript() {
  const prompt = therapyRoundState.prompts[therapyRoundState.currentIndex] || "";
  const sessionType = therapyRoundState.sessionType || "Sound Drill";
  const target = therapyRoundState.target || prompt;
  if (sessionType === "Sound Drill" || sessionType === "Syllable Drill") {
    return String(target || prompt).trim();
  }
  return String(prompt || target).trim();
}

function startTherapyCapture() {
  if (therapyVoiceMonitorActive) {
    resetTherapyVoicePromptState();
    setTherapyRoundStatus("Listening now. Please say the prompt clearly.", "");
    return true;
  }
  if (!therapyRoundState.active) {
    setTherapyRoundStatus("Start the round first.");
    return false;
  }
  if (!therapyRoundState.micReady) {
    setTherapyRoundStatus("The microphone is not ready yet. Click Start Round and allow microphone access first.");
    return false;
  }
  if (therapyRecognitionRunning) {
    setTherapyRoundStatus("Listening is already in progress for this practice item.", therapyRoundState.captureTranscript);
    return false;
  }
  const recognition = ensureTherapyRecognition();
  if (!recognition) {
    setTherapyRoundStatus("Live spoken-response capture is not available in this browser. Please use Chrome or Edge.");
    return false;
  }
  clearTherapyAutoCaptureTimer();
  const languageMap = {
    Bengali: "bn-BD",
    English: "en-US",
    Multilingual: "en-US",
  };
  recognition.lang = languageMap[therapyRoundState.language] || "bn-BD";
  therapyRecognitionPurpose = "capture";
  therapyContinuousRequested = true;
  try {
    if (therapyRecognitionRunning) {
      resetTherapyRecognitionCycle();
      setTherapyRoundStatus("Listening now. Please say the prompt clearly.", "");
      return true;
    }
    recognition.start();
    return true;
  } catch (_error) {
    therapyRecognitionPurpose = "idle";
    setTherapyRoundStatus("Voice capture could not start. The system will try again in a moment.");
    return false;
  }
}

function queueTherapyAutoCapture(delayMs = 300) {
  clearTherapyAutoCaptureTimer();
  if (!therapyRoundState.active) return;
  therapyAutoCaptureTimer = window.setTimeout(() => {
    therapyAutoCaptureTimer = null;
    if (!therapyRoundState.active) return;
    startTherapyCapture();
  }, delayMs);
}

function ensureTherapyRecognition() {
  if (therapyRecognition) return therapyRecognition;
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return null;
  therapyRecognition = new SpeechRecognition();
  therapyRecognition.continuous = true;
  therapyRecognition.interimResults = true;
  therapyRecognition.lang = "bn-BD";
  let liveTranscript = "";
  let finalTranscript = "";
  let captureHandled = false;
  let captureSettleTimer = null;
  let captureStartedAt = 0;

  const clearCaptureSettleTimer = () => {
    if (!captureSettleTimer) return;
    clearTimeout(captureSettleTimer);
    captureSettleTimer = null;
  };
  therapyRecognition.__therapyState = {
    get liveTranscript() { return liveTranscript; },
    set liveTranscript(value) { liveTranscript = value; },
    get finalTranscript() { return finalTranscript; },
    set finalTranscript(value) { finalTranscript = value; },
    get captureHandled() { return captureHandled; },
    set captureHandled(value) { captureHandled = value; },
    get captureStartedAt() { return captureStartedAt; },
    set captureStartedAt(value) { captureStartedAt = value; },
    clearCaptureSettleTimer,
  };

  const finalizeTherapyCapture = (preferredTranscript = "") => {
    clearCaptureSettleTimer();
    if (captureHandled || therapyRecognitionPurpose === "prime") return false;
    const transcript = String(preferredTranscript || finalTranscript || liveTranscript || "").trim();
    if (!transcript) return false;
    captureHandled = true;
    therapyRecognitionPurpose = "idle";
    evaluateTherapyResponse(transcript);
    window.setTimeout(() => {
      if (!therapyRoundState.active || !therapyContinuousRequested || !therapyRecognitionRunning) return;
      resetTherapyRecognitionCycle();
      setTherapyRoundStatus("Listening now. Please say the prompt clearly.", "");
    }, 500);
    return true;
  };

  therapyRecognition.onstart = () => {
    therapyRecognitionRunning = true;
    setTherapyListening(true);
    if (therapyRecognitionPurpose === "prime") {
      setTherapyRoundStatus("Voice setup is in progress...");
      therapyRecognitionPrimed = true;
      window.setTimeout(() => {
        if (therapyRecognitionRunning && therapyRecognitionPurpose === "prime") {
          try {
            therapyRecognition.stop();
          } catch (_error) {
            therapyRecognitionRunning = false;
            setTherapyListening(false);
            therapyRecognitionPurpose = "idle";
            resolveTherapyPrime(false);
          }
        }
      }, 150);
      return;
    }
    liveTranscript = "";
    finalTranscript = "";
    captureHandled = false;
    captureStartedAt = performance.now();
    clearCaptureSettleTimer();
    setTherapyRoundStatus("Listening now. Please say the prompt clearly.", liveTranscript);
  };
  therapyRecognition.onresult = (event) => {
    liveTranscript = Array.from(event.results).map((item) => item[0]?.transcript || "").join(" ").trim();
    if (therapyRecognitionPurpose === "prime") return;
    finalTranscript = Array.from(event.results)
      .filter((item) => item.isFinal)
      .map((item) => item[0]?.transcript || "")
      .join(" ")
      .trim();
    setTherapyRoundStatus("Got it. Processing your response...", liveTranscript);
    if (finalTranscript && finalizeTherapyCapture(finalTranscript)) {
      return;
    }
    clearCaptureSettleTimer();
    if (liveTranscript) {
      captureSettleTimer = window.setTimeout(() => {
        const settledTranscript = String(finalTranscript || liveTranscript || "").trim();
        if (!settledTranscript || captureHandled || therapyRecognitionPurpose === "prime") return;
        finalizeTherapyCapture(settledTranscript);
      }, 900);
    }
  };
  therapyRecognition.onerror = (event) => {
    therapyRecognitionRunning = false;
    setTherapyListening(false);
    clearCaptureSettleTimer();
    if (therapyRecognitionPurpose === "prime") {
      therapyRecognitionPurpose = "idle";
      therapyRecognitionPrimed = false;
      resolveTherapyPrime(false);
    } else {
      therapyRecognitionPurpose = "idle";
    }
    const message = event.error === "not-allowed"
      ? "Microphone permission was blocked. Please allow microphone access and try again."
      : event.error === "no-speech"
        ? "No clear speech was detected. Please read the prompt again."
        : "Voice capture failed. Please try again in Chrome or Edge.";
    setTherapyRoundStatus(message, liveTranscript);
  };
  therapyRecognition.onend = () => {
    therapyRecognitionRunning = false;
    setTherapyListening(false);
    clearCaptureSettleTimer();
    if (therapyRecognitionPurpose === "prime") {
      therapyRecognitionPurpose = "idle";
      resolveTherapyPrime(therapyRecognitionPrimed);
      setTherapyRoundStatus("Round started. The system is listening automatically.");
      liveTranscript = "";
      finalTranscript = "";
      captureHandled = false;
      captureStartedAt = 0;
      return;
    }
    let captured = finalizeTherapyCapture();
    const captureDurationMs = captureStartedAt ? (performance.now() - captureStartedAt) : 0;
    if (!captured && captureDurationMs >= 1200) {
      const assumedTranscript = fallbackTherapyTranscript();
      captured = finalizeTherapyCapture(assumedTranscript);
      if (captured) {
        setTherapyRoundStatus(
          "Response captured with limited speech recognition. Moving to the next practice automatically.",
          assumedTranscript,
        );
      }
    }
    if (therapyRoundState.finishRequested) {
      finalizeTherapyRoundAndAnalyze();
    }
    if (!captured && therapyRoundState.active) {
      setTherapyRoundStatus("Your response was not captured clearly. The system will listen again automatically.");
      if (therapyContinuousRequested && !therapyVoiceMonitorActive) {
        window.setTimeout(() => {
          if (!therapyRoundState.active || therapyRecognitionRunning) return;
          startTherapyCapture();
        }, 400);
      }
    }
    therapyRecognitionPurpose = "idle";
    liveTranscript = "";
    finalTranscript = "";
    captureHandled = false;
    captureStartedAt = 0;
    if (therapyContinuousRequested && therapyRoundState.active && !therapyRoundState.finishRequested && !therapyVoiceMonitorActive) {
      window.setTimeout(() => {
        if (!therapyRoundState.active || therapyRecognitionRunning) return;
        startTherapyCapture();
      }, 250);
    }
  };
  return therapyRecognition;
}

function renderRecordDetail(record) {
  const node = document.getElementById("recordDetailCard");
  if (!node) return;
  if (!record) {
    node.innerHTML = `<p class="mb-0 text-muted">${isBengaliUi() ? "বিস্তারিত দেখতে টেবিল থেকে একটি রেকর্ড বেছে নিন।" : "Select a record from the table to inspect details."}</p>`;
    return;
  }
  const meta = getRecordStatusMeta(record);
  const eyeConsistencyScore = record?.stabilityScore ?? record?.consistencyScore;
  const bengali = isBengaliUi();
  const detailRows = [];
  if (record.type === "screening") {
    detailRows.push([bengali ? "ভাষা" : "Language", record.language || "-"]);
    detailRows.push([bengali ? "পড়ার ক্ষমতা" : "Reading ability", record.readingDecodingScore !== undefined ? `${Number(record.readingDecodingScore).toFixed(1)}%` : (record.readingScore !== undefined ? `${Number(record.readingScore).toFixed(1)}%` : "-")]);
    detailRows.push([bengali ? "বক্তৃতা ফ্লুয়েন্সি" : "Speech fluency", record.speechFluencyScore !== undefined ? `${Number(record.speechFluencyScore).toFixed(1)}%` : "-"]);
    detailRows.push([bengali ? "ডিসলেক্সিয়া ঝুঁকি" : "Dyslexia risk", record.readingRisk !== undefined ? `${(Number(record.readingRisk) * 100).toFixed(1)}%` : "-"]);
    detailRows.push([bengali ? "বক্তৃতা অনুসরণ প্রয়োজন" : "Speech follow-up needed", record.speechFluencyRisk !== undefined ? `${(Number(record.speechFluencyRisk) * 100).toFixed(1)}%` : "-"]);
    detailRows.push([bengali ? "প্রধান উদ্বেগ" : "Primary Concern", record.primaryConcern === "speech_fluency" ? (bengali ? "বক্তৃতা ফ্লুয়েন্সি" : "Speech fluency") : (bengali ? "পড়া/ডিকোডিং" : "Reading/decoding")]);
    detailRows.push([bengali ? "অনুমানিত স্তর" : "Predicted Level", record.label || "-"]);
    detailRows.push([bengali ? "অনুমানিত আত্মবিশ্বাস" : "Estimated Confidence", `${((record.confidence || 0) * 100).toFixed(1)}%`]);
  } else if (record.type === "therapy") {
    detailRows.push([bengali ? "সেশন ধরন" : "Session Type", record.sessionType || "-"]);
    detailRows.push([bengali ? "লক্ষ্য" : "Target", record.target || "-"]);
    detailRows.push([bengali ? "মোট স্কোর" : "Overall Score", `${Number(record.overallScorePct || (record.score || 0) * 100).toFixed(1)}%`]);
    detailRows.push([bengali ? "সুপারিশ" : "Recommendation", record.recommendation || "-"]);
  } else if (record.type === "eye_tracking") {
    detailRows.push([bengali ? "পূর্বনির্ধারিত ধরন" : "Preset", record.preset || "-"]);
    detailRows.push([bengali ? "প্রতি মিনিটে আইটেম" : "Items Per Minute", `${Number(record.wpm || 0).toFixed(1)} IPM`]);
    detailRows.push([bengali ? "ভুল ট্যাপ" : "Wrong Taps", record.regressions ?? "-"]);
    detailRows.push([bengali ? "প্রথম চেষ্টার নির্ভুলতা" : "First-Try Accuracy", record.fixationScore !== undefined ? `${Number(record.fixationScore).toFixed(1)}%` : "-"]);
    detailRows.push([bengali ? "সামঞ্জস্য" : "Consistency", eyeConsistencyScore !== undefined ? `${Number(eyeConsistencyScore).toFixed(1)}%` : "-"]);
    detailRows.push([bengali ? "সামগ্রিক অবস্থা" : "Overall Status", record.eyeStatus || "-"]);
  } else if (record.type === "biomarkers") {
    detailRows.push([bengali ? "বিশ্লেষিত নমুনা" : "Samples Analyzed", String(record.analyzed_samples || 0)]);
    detailRows.push([bengali ? "দেখানো মার্কার" : "Biomarkers Shown", String((record.biomarkers || []).length || 0)]);
    detailRows.push([bengali ? "নির্বাচিত পরিবার" : "Selected Family", record.selectedFamily || "all"]);
    detailRows.push([bengali ? "ন্যূনতম গুরুত্ব" : "Minimum Importance", record.minImportance !== undefined ? String(record.minImportance) : "-"]);
  } else if (record.type === "final_report") {
    detailRows.push([bengali ? "চূড়ান্ত স্তর" : "Final Level", record.finalLevel || "-"]);
    detailRows.push([bengali ? "গড় ঝুঁকি" : "Average Risk", record.avgRisk !== undefined ? Number(record.avgRisk).toFixed(3) : "-"]);
    detailRows.push([bengali ? "সম্মতি" : "Consensus", record.consensusLevel || "-"]);
    detailRows.push([bengali ? "প্রস্তুতি" : "Readiness", record.readiness || "-"]);
  } else if (record.type === "model_selection") {
    detailRows.push([bengali ? "নির্বাচিত মডেল" : "Selected Model", record.selectedModel || "-"]);
    detailRows.push([bengali ? "নির্বাচিত স্তর" : "Selected Level", record.selectedLevel || "-"]);
    detailRows.push([bengali ? "নির্বাচিত আত্মবিশ্বাস" : "Selected Confidence", record.selectedConfidence !== undefined ? `${(Number(record.selectedConfidence) * 100).toFixed(1)}%` : "-"]);
    detailRows.push([bengali ? "সম্মতির স্তর" : "Consensus", record.consensusLevel || "-"]);
    detailRows.push([bengali ? "গড় ঝুঁকি" : "Average Risk", record.averageRisk !== undefined ? Number(record.averageRisk).toFixed(3) : "-"]);
    detailRows.push([bengali ? "ঝুঁকির ছড়ানো" : "Risk Spread", record.stabilitySpread !== undefined ? Number(record.stabilitySpread).toFixed(3) : "-"]);
  }
  node.innerHTML = `
    <p><strong>${bengali ? "ধরন" : "Type"}:</strong> ${recordTypeLabel(record.type)}</p>
    <p><strong>${bengali ? "সংরক্ষিত" : "Saved"}:</strong> ${record.timestamp ? new Date(record.timestamp).toLocaleString() : "-"}</p>
    <p><strong>${bengali ? "সারাংশ" : "Summary"}:</strong> ${summarizeRecord(record)}</p>
    <p><strong>${bengali ? "অবস্থা" : "Status"}:</strong> <span class="${meta.className}">${meta.label}</span></p>
    ${detailRows.length ? `
      <div class="record-detail-grid">
        ${detailRows.map(([label, value]) => `
          <div class="record-detail-item">
            <span class="record-detail-label">${label}</span>
            <span class="record-detail-value">${value}</span>
          </div>
        `).join("")}
      </div>
    ` : ""}
  `;
}

function setEyeUploadStatus(message, className = "small text-muted mt-2 mb-0") {
  const node = document.getElementById("eyeUploadStatus");
  if (!node) return;
  node.textContent = message;
  node.className = className;
}

function renderEyeTraceQuickStats(trace) {
  const node = document.getElementById("eyeTraceQuickStats");
  if (!node) return;
  const bengali = isBengaliUi();
  if (!trace || !trace.data?.length) {
    node.innerHTML = `<p class="mb-0 text-muted small">${bengali ? "আপলোডের পরে, বিশ্লেষণ শুরুর আগে এখানে ফাইলের একটি দ্রুত প্রিভিউ দেখাবে।" : "After upload, this area will show a quick preview of your file before analysis starts."}</p>`;
    return;
  }
  const { data } = trace;
  const first = data[0];
  const last = data[data.length - 1];
  const durationSec = Math.max(0, (last.t - first.t) / 1000);
  const xs = data.map((point) => point.x);
  const ys = data.map((point) => point.y);
  const intervals = [];
  for (let i = 1; i < data.length; i += 1) {
    intervals.push(Math.max(0, data[i].t - data[i - 1].t));
  }
  const avgInterval = intervals.length ? intervals.reduce((sum, value) => sum + value, 0) / intervals.length : 0;
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  node.innerHTML = `
    <div class="row g-2 small">
      <div class="col-md-3"><strong>${bengali ? "ব্যবহারযোগ্য পয়েন্ট:" : "Usable Points:"}</strong> ${data.length}</div>
      <div class="col-md-3"><strong>${bengali ? "ট্রেস সময়:" : "Trace Time:"}</strong> ${durationSec.toFixed(2)}s</div>
      <div class="col-md-3"><strong>${bengali ? "গড় স্যাম্পল ফাঁক:" : "Avg Sample Gap:"}</strong> ${avgInterval.toFixed(1)} ms</div>
      <div class="col-md-3"><strong>${bengali ? "অনুভূমিক পরিসর:" : "Horizontal Range:"}</strong> ${minX.toFixed(3)} - ${maxX.toFixed(3)}</div>
      <div class="col-md-3"><strong>${bengali ? "উল্লম্ব পরিসর:" : "Vertical Range:"}</strong> ${minY.toFixed(3)} - ${maxY.toFixed(3)}</div>
    </div>
  `;
}

function triggerPdfBlobDownload(doc, filename) {
  const blob = doc.output("blob");
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function resetEyeOutputs(message) {
  const copy = getEyeAnalysisCopy();
  const resultNode = document.getElementById("eyeResult");
  if (resultNode) resultNode.innerHTML = `<p>${message}</p>`;
  const checklistNode = document.getElementById("eyeChecklist");
  if (checklistNode) checklistNode.innerHTML = `<p class="mb-0 text-muted small">${copy.checklist}</p>`;
  const recommendationNode = document.getElementById("eyeRecommendation");
  if (recommendationNode) recommendationNode.innerHTML = `<p class="mb-0 text-muted">${copy.recommendation}</p>`;
  setNodeText("eyeOverallScore", "-");
  setNodeText("eyeOverallStatus", copy.pending, "text-secondary fw-semibold");
  if (eyeChart) {
    eyeChart.destroy();
    eyeChart = null;
  }
}

function getEyePresetConfig() {
  const presetKey = document.getElementById("eyePreset")?.value || "short_passage";
  return EYE_PRESETS[presetKey] || EYE_PRESETS.short_passage;
}

function applyEyePreset(presetKey, rerun = false) {
  const preset = EYE_PRESETS[presetKey] || EYE_PRESETS.short_passage;
  const assign = (id, value) => {
    const node = document.getElementById(id);
    if (node) node.value = String(value);
  };
  assign("wordCount", preset.wordCount);
  assign("eyeExpectedTime", preset.expectedTime);
  assign("eyeRegressionLimit", preset.regressionLimit);
  assign("eyeDispersionTarget", preset.dispersionTarget);
  const hintNode = document.getElementById("eyePresetHint");
  if (hintNode) hintNode.value = preset.description;
  renderEyeLivePassage(presetKey);
  if (rerun && latestEyeTrace) {
    analyzeEyeTrackingNow();
  }
}

function buildEyeDemoCsv() {
  return [
    "timestamp_ms,gaze_x,gaze_y",
    "0,0.42,0.51",
    "120,0.45,0.52",
    "240,0.47,0.50",
    "360,0.44,0.49",
    "480,0.40,0.50",
    "600,0.43,0.51",
    "720,0.49,0.50",
    "840,0.54,0.52",
    "960,0.58,0.53",
    "1080,0.55,0.52",
    "1200,0.50,0.51",
    "1320,0.48,0.50",
    "1440,0.53,0.52",
    "1560,0.59,0.54",
    "1680,0.63,0.53",
    "1800,0.61,0.51",
  ].join("\n");
}

function renderEyeChecklist(items) {
  const node = document.getElementById("eyeChecklist");
  if (!node) return;
  node.innerHTML = `
    <div class="row g-2 small">
      ${items.map((item) => `
        <div class="col-md-6">
          <div><strong>${item.label}:</strong> <span class="${item.className}">${item.status}</span></div>
          <div class="text-muted">${item.detail}</div>
        </div>
      `).join("")}
    </div>
  `;
}

function renderEyeRecommendation(summary) {
  const node = document.getElementById("eyeRecommendation");
  if (!node) return;
  const bengali = isBengaliUi();
  node.innerHTML = `
    <p><strong>${bengali ? "ব্যবহারকারীর সারাংশ:" : "End-User Summary:"}</strong> ${summary.statusText}</p>
    <p><strong>${bengali ? "এর মানে কী:" : "What this means:"}</strong> ${summary.interpretation}</p>
    <p class="mb-0"><strong>${bengali ? "পরবর্তী করণীয়:" : "Recommended next step:"}</strong> ${summary.nextStep}</p>
  `;
}

function getEyeLivePassage(presetKey) {
  return EYE_LIVE_PASSAGES[presetKey] || EYE_LIVE_PASSAGES.short_passage;
}

function renderEyeLivePassage(presetKey) {
  const node = document.getElementById("eyeLivePassage");
  if (!node) return;
  node.textContent = getEyeLivePassage(presetKey);
}

function setEyeLiveStatus(message, className = "small text-muted mb-0") {
  const node = document.getElementById("eyeLiveStatus");
  if (!node) return;
  node.textContent = message;
  node.className = className;
}

function updateEyeLiveButtons() {
  const startBtn = document.getElementById("startEyeLiveCheck");
  const resetBtn = document.getElementById("resetEyeLiveCheck");
  if (startBtn) startBtn.disabled = eyeLiveTraceState.active;
  if (resetBtn) resetBtn.disabled = false;
}

function positionEyeLiveCursor(clientX, clientY) {
  const area = document.getElementById("eyeLiveTrackArea");
  const cursor = document.getElementById("eyeLiveCursor");
  if (!area || !cursor) return;
  const rect = area.getBoundingClientRect();
  cursor.style.left = `${clientX - rect.left}px`;
  cursor.style.top = `${clientY - rect.top}px`;
  cursor.classList.remove("d-none");
}

function hideEyeLiveCursor() {
  const cursor = document.getElementById("eyeLiveCursor");
  if (!cursor) return;
  cursor.classList.add("d-none");
}

function stopEyeLiveAutoTimer() {
  if (!eyeLiveTraceState.timer) return;
  clearInterval(eyeLiveTraceState.timer);
  eyeLiveTraceState.timer = null;
}

function resetEyeLiveCheck(keepStatus = false) {
  stopEyeLiveAutoTimer();
  eyeLiveTraceState = {
    active: false,
    startedAt: 0,
    autoStopAt: 0,
    points: [],
    timer: null,
    lastPointTs: 0,
  };
  const area = document.getElementById("eyeLiveTrackArea");
  if (area) area.classList.remove("active");
  hideEyeLiveCursor();
  updateEyeLiveButtons();
  if (!keepStatus) {
    setEyeLiveStatus("Press Start Live Check, then follow the passage using your mouse or finger while reading.", "small text-muted mb-0");
  }
}

function buildLiveEyeTrace() {
  if (eyeLiveTraceState.points.length < 6) {
    return { error: "The live check did not capture enough movement. Please try again and move steadily across the passage." };
  }
  const firstTs = eyeLiveTraceState.points[0].t;
  return {
    data: eyeLiveTraceState.points.map((point) => ({
      t: Math.max(0, point.t - firstTs),
      x: point.x,
      y: point.y,
    })),
  };
}

async function completeEyeLiveCheck() {
  if (!eyeLiveTraceState.active) return;
  stopEyeLiveAutoTimer();
  eyeLiveTraceState.active = false;
  const area = document.getElementById("eyeLiveTrackArea");
  if (area) area.classList.remove("active");
  hideEyeLiveCursor();
  updateEyeLiveButtons();
  const parsed = buildLiveEyeTrace();
  if (parsed.error) {
    latestEyeTrace = null;
    latestEyeTraceLabel = "";
    setEyeLiveStatus(parsed.error, "small text-danger mb-0");
    setEyeUploadStatus(parsed.error, "small text-danger mt-2 mb-0");
    resetEyeOutputs(parsed.error);
    return;
  }
  latestEyeTrace = parsed;
  latestEyeTraceLabel = "Live on-screen tracking";
  setEyeLiveStatus(`Live check captured ${parsed.data.length} movement points. Analyzing automatically...`, "small text-success mb-0");
  setEyeUploadStatus(`Using live on-screen tracking with ${parsed.data.length} usable points.`, "small text-success mt-2 mb-0");
  renderEyeTraceQuickStats(parsed);
  resetEyeOutputs(getEyeAnalysisCopy().capturedSuccessfully);
  await analyzeEyeTrackingNow();
}

function captureEyeLivePoint(clientX, clientY) {
  if (!eyeLiveTraceState.active) return;
  const area = document.getElementById("eyeLiveTrackArea");
  if (!area) return;
  const rect = area.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  const now = performance.now();
  if (eyeLiveTraceState.lastPointTs && now - eyeLiveTraceState.lastPointTs < 40) {
    positionEyeLiveCursor(clientX, clientY);
    return;
  }
  eyeLiveTraceState.lastPointTs = now;
  eyeLiveTraceState.points.push({
    t: now,
    x: clamp((clientX - rect.left) / rect.width, 0, 1),
    y: clamp((clientY - rect.top) / rect.height, 0, 1),
  });
  positionEyeLiveCursor(clientX, clientY);
}

function startEyeLiveCheck() {
  const area = document.getElementById("eyeLiveTrackArea");
  const preset = getEyePresetConfig();
  if (!area) return;
  stopEyeLiveAutoTimer();
  eyeLiveTraceState = {
    active: true,
    startedAt: performance.now(),
    autoStopAt: performance.now() + (preset.expectedTime * 1000),
    points: [],
    timer: null,
    lastPointTs: 0,
  };
  latestEyeTrace = null;
  latestEyeTraceLabel = "";
  area.classList.add("active");
  updateEyeLiveButtons();
  setEyeLiveStatus(`Live check started. Follow the passage for about ${preset.expectedTime} seconds.`, "small text-primary mb-0");
  setEyeUploadStatus("Live on-screen tracking is in progress.", "small text-primary mt-2 mb-0");
  resetEyeOutputs(getEyeAnalysisCopy().liveRunning);
  eyeLiveTraceState.timer = window.setInterval(() => {
    if (!eyeLiveTraceState.active) {
      stopEyeLiveAutoTimer();
      return;
    }
    const remainingMs = Math.max(0, eyeLiveTraceState.autoStopAt - performance.now());
    if (remainingMs <= 0) {
      completeEyeLiveCheck();
      return;
    }
    setEyeLiveStatus(`Live check running. Keep following the passage. ${Math.ceil(remainingMs / 1000)}s remaining.`, "small text-primary mb-0");
  }, 200);
}

function parseEyeTraceCsv(text) {
  const normalizedText = String(text || "").replace(/^\uFEFF/, "");
  const rows = normalizedText.trim().split(/\r?\n/).filter(Boolean);
  if (rows.length < 3) {
    return { error: "The CSV needs at least 3 data rows." };
  }
  const headers = rows[0].split(",").map((x) => x.trim());
  const idxT = headers.indexOf("timestamp_ms");
  const idxX = headers.indexOf("gaze_x");
  const idxY = headers.indexOf("gaze_y");
  if (idxT < 0 || idxX < 0 || idxY < 0) {
    return { error: "CSV format is invalid. Use exactly these headers: timestamp_ms,gaze_x,gaze_y." };
  }
  const data = rows.slice(1).map((r) => r.split(",")).map((c) => ({
    t: Number(c[idxT]),
    x: Number(c[idxX]),
    y: Number(c[idxY]),
  })).filter((d) => Number.isFinite(d.t) && Number.isFinite(d.x) && Number.isFinite(d.y));
  if (data.length < 3) {
    return { error: "The file does not contain enough valid gaze points." };
  }
  const monotonic = data.every((point, index) => index === 0 || point.t >= data[index - 1].t);
  if (!monotonic) {
    return { error: "The timestamp_ms column must be in ascending order." };
  }
  return { data };
}

function updateSegmentScoreMatrix() {
  const bengali = isBengaliUi();
  const readingScore = readingTestState.done ? readingTestState.score : null;
  const audioScore = audioFeatures.analyzed ? audioFeatures.comprehensionScore * 100 : null;
  const spellingCorrect = spellingFeatures.scored ? (spellingFeatures.total - spellingFeatures.errors) : null;
  const spellingScore = spellingFeatures.scored && spellingFeatures.total
    ? (spellingCorrect / spellingFeatures.total) * 100
    : null;
  const readingMeta = getStatusMeta(readingScore, READING_PASS_THRESHOLD, readingTestState.done);
  const audioMeta = getStatusMeta(audioScore, AUDIO_PASS_THRESHOLD, audioFeatures.analyzed);
  const spellingMeta = getStatusMeta(spellingScore, SPELLING_PASS_THRESHOLD, spellingFeatures.scored);

  setNodeText("matrixReadingScore", formatScore(readingScore));
  setNodeText("matrixReadingThreshold", `${READING_PASS_THRESHOLD}%`);
  setNodeText("matrixReadingStatus", readingMeta.label, readingMeta.className);

  setNodeText("matrixAudioScore", formatScore(audioScore));
  setNodeText("matrixAudioThreshold", `${AUDIO_PASS_THRESHOLD}%`);
  setNodeText("matrixAudioStatus", audioMeta.label, audioMeta.className);

  setNodeText("matrixSpellingScore", formatScore(spellingScore));
  setNodeText("matrixSpellingThreshold", `${SPELLING_PASS_THRESHOLD}%`);
  setNodeText("matrixSpellingStatus", spellingMeta.label, spellingMeta.className);

  const allCompleted = readingTestState.done && audioFeatures.analyzed && spellingFeatures.scored;
  if (!allCompleted) {
    setNodeText("overallSegmentScore", "-");
    setNodeText("overallSegmentStatus", bengali ? "অপেক্ষমাণ" : "Pending", "text-secondary fw-semibold");
    return;
  }

  const overallScore = (readingTestState.score + (audioFeatures.comprehensionScore * 100) + spellingScore) / 3;
  const allPassed = readingTestState.score >= READING_PASS_THRESHOLD
    && (audioFeatures.comprehensionScore * 100) >= AUDIO_PASS_THRESHOLD
    && spellingScore >= SPELLING_PASS_THRESHOLD;
  const nextRound = getNextRoundLabel("screening", bengali ? "Bengali" : "English");
  setNodeText("overallSegmentScore", `${overallScore.toFixed(1)}%`);
  setNodeText(
    "overallSegmentStatus",
    allPassed
      ? (bengali ? `পরবর্তী রাউন্ডের জন্য প্রস্তুত: ${nextRound}` : `Ready for next round: ${nextRound}`)
      : (bengali ? "পরবর্তী রাউন্ডের আগে সহায়তা দরকার" : "Needs support before the next round"),
    allPassed ? "text-success fw-semibold" : "text-danger fw-semibold",
  );
}

function scoreSpellingTestNow() {
  const language = document.getElementById("sampleLanguage")?.value || "Bengali";
  const q1 = normalizeSpellingInput(document.getElementById("spellQ1").value, language);
  const q2 = normalizeSpellingInput(document.getElementById("spellQ2").value, language);
  const q3 = normalizeSpellingInput(document.getElementById("spellQ3").value, language);
  const answers = currentSpellingWords.map((x) => normalizeSpellingInput(x, language));
  const given = [q1, q2, q3];
  let correct = 0;
  for (let i = 0; i < answers.length; i += 1) {
    if (given[i] === answers[i]) correct += 1;
  }
  const spellingScore = (correct / answers.length) * 100;
  spellingFeatures = { scored: true, errors: answers.length - correct, total: answers.length, correct, score: spellingScore };
  document.getElementById("spellingTestStatus").textContent = isBengaliUi(language)
    ? `স্বয়ংক্রিয়ভাবে সম্পন্ন। সঠিক: ${correct}/${answers.length}, ভুল: ${spellingFeatures.errors}`
    : `Completed automatically. Correct: ${correct}/${answers.length}, Errors: ${spellingFeatures.errors}`;
  setNodeText("spellingAutoScore", `${spellingScore.toFixed(1)}%`);
  setNodeText("spellingPassThreshold", `${SPELLING_PASS_THRESHOLD}%`);
  const spellingMeta = getStatusMeta(spellingScore, SPELLING_PASS_THRESHOLD, true);
  setNodeText("spellingPassResult", spellingMeta.label, spellingMeta.className);
  updateSegmentScoreMatrix();
  maybeAutoRunScreening();
}

function scheduleAutoSpellingScore() {
  if (spellingAutoScoreTimer) clearTimeout(spellingAutoScoreTimer);
  const values = ["spellQ1", "spellQ2", "spellQ3"].map((fieldId) => (document.getElementById(fieldId)?.value || "").trim());
  const status = document.getElementById("spellingTestStatus");
  if (!values.every(Boolean)) {
    if (status) status.textContent = isBengaliUi()
      ? "লিখতে থাকুন। তিনটি উত্তর পূর্ণ হলে স্কোর স্বয়ংক্রিয়ভাবে চলবে।"
      : "Keep typing. Scoring will run automatically after all 3 answers are filled.";
    return;
  }
  if (status) status.textContent = isBengaliUi()
    ? "সব উত্তর দেওয়া হয়েছে। স্বয়ংক্রিয়ভাবে স্কোর হচ্ছে..."
    : "All answers entered. Scoring automatically...";
  spellingAutoScoreTimer = window.setTimeout(() => {
    scoreSpellingTestNow();
    spellingAutoScoreTimer = null;
  }, 450);
}

READING_PROMPTS.Bengali = [
  "আজ সকালে আমরা সবাই মিলে স্কুলের বাগানে গিয়ে নতুন ফুলের চারা লাগিয়েছি।",
  "শিক্ষক গল্প পড়ে শোনানোর সময় আমি মনোযোগ দিয়ে প্রতিটি শব্দ স্পষ্ট করে বলার চেষ্টা করি।",
  "বৃষ্টির দিনে জানালার পাশে বসে ধীরে ধীরে পড়লে আমার পড়া আরও সাবলীল হয়।",
  "কঠিন শব্দ দেখলে আমি শব্দটাকে ভাগ করে আবার পড়ি, তাই ভুল কম হয়।",
  "প্রতিদিন নিয়ম করে পড়ার অভ্যাস করলে আত্মবিশ্বাস বাড়ে এবং পড়া সহজ লাগে।",
];

function finalizeReadingSession(transcription = null) {
  if (!readingTestState.startedAt || readingTestState.done) return;
  readingRecognitionRunning = false;
  const transcriptText = String(transcription?.text || "").trim();
  if (transcriptText) {
    readingCurrentTranscript = transcriptText;
    readingTestState.wordsSpoken = countTranscriptWords(transcriptText);
  }
  readingTestState.seconds = Math.max(0, (performance.now() - readingTestState.startedAt) / 1000);
  readingTestState.done = true;
  const promptWords = (document.getElementById("readingPrompt")?.value || "").trim().split(/\s+/).filter(Boolean).length || 1;
  const minutes = Math.max(0.1, readingTestState.seconds / 60);
  const spokenWords = Math.max(0, readingTestState.wordsSpoken || 0);
  const effectiveWords = spokenWords;
  const wpm = effectiveWords / minutes;
  const completion = Math.min(1, effectiveWords / promptWords);
  const targetWpm = 65;
  const paceScore = Math.max(0, 1 - (Math.abs(wpm - targetWpm) / targetWpm));
  const hesitationPenalty = Math.min(0.6, readingTestState.hesitations * 0.08);
  const score = Math.max(0, Math.min(100, ((completion * 0.55) + (paceScore * 0.45) - hesitationPenalty) * 100));
  readingTestState.wpm = wpm;
  readingTestState.score = score;
  const autoScoreNode = document.getElementById("readingAutoScore");
  if (autoScoreNode) autoScoreNode.textContent = `${score.toFixed(1)}%`;
  const thresholdNode = document.getElementById("readingPassThreshold");
  if (thresholdNode) thresholdNode.textContent = `${READING_PASS_THRESHOLD}%`;
  const resultNode = document.getElementById("readingPassResult");
  if (resultNode) {
    resultNode.textContent = score >= READING_PASS_THRESHOLD ? "Pass" : "Needs Improvement";
    resultNode.className = score >= READING_PASS_THRESHOLD ? "text-success fw-semibold" : "text-danger fw-semibold";
  }
  updateSegmentScoreMatrix();
  const transcriptNote = transcriptText
    ? ` (${transcription?.engine || "local transcript"})`
    : "";
  document.getElementById("readingTestStatus").textContent =
    `Completed${transcriptNote}. Duration: ${readingTestState.seconds.toFixed(1)}s, Auto hesitations: ${readingTestState.hesitations}, WPM: ${wpm.toFixed(1)}, Reading score: ${score.toFixed(1)}%`;
  maybeAutoRunScreening();
}

function normalizeToken(token) {
  return (token || "")
    .replace(/[.,!?;:"'“”‘’()[\]{}<>/\\|`~@#$%^&*_+=\-।]/g, "")
    .trim();
}

function lastSpokenWord() {
  const tokens = (readingCurrentTranscript || "").split(/\s+/).map(normalizeToken).filter(Boolean);
  return tokens.length ? tokens[tokens.length - 1] : "";
}

function countTranscriptWords(transcript) {
  return (transcript || "")
    .split(/\s+/)
    .map(normalizeToken)
    .filter(Boolean)
    .length;
}

function extractPromptWords(promptText) {
  return (promptText || "")
    .split(/\s+/)
    .map(normalizeToken)
    .filter(Boolean);
}

function findLatestPromptWordInTranscript() {
  const tokens = (readingCurrentTranscript || "").split(/\s+/).map(normalizeToken).filter(Boolean);
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    if (readingPromptWordSet.has(tokens[i])) return tokens[i];
  }
  return "";
}

function markHesitatedWord() {
  const token = normalizeToken(lastSpokenWord());
  let normalized = "";
  if (token && readingPromptWordSet.has(token)) {
    normalized = token;
  } else {
    normalized = findLatestPromptWordInTranscript();
  }
  if (!normalized) normalized = "শব্দ শনাক্ত হয়নি";

  hesitatedWords.push(normalized);
  hesitatedWordEvents.push(normalized);
  const hesitatedNode = document.getElementById("hesitatedWords");
  if (hesitatedNode) {
    hesitatedNode.textContent = hesitatedWordEvents.map((e, i) => `${i + 1}. ${e}`).join(" | ");
  }
}

function setReadingListeningUI(active) {
  const node = document.getElementById("readingListeningIndicator");
  if (!node) return;
  node.classList.toggle("d-none", !active);
}

function stopReadingMonitor() {
  if (readingMonitorTimer) {
    clearInterval(readingMonitorTimer);
    readingMonitorTimer = null;
  }
}

function clearReadingAutoFinalizeTimer() {
  if (readingAutoFinalizeTimer) {
    clearTimeout(readingAutoFinalizeTimer);
    readingAutoFinalizeTimer = null;
  }
}

function describeMicAccessError(error, contextLabel) {
  const prefix = contextLabel ? `${contextLabel}: ` : "";
  if (!window.isSecureContext) {
    return `${prefix}Microphone access requires a secure context. Open this page from localhost or HTTPS, not from a file:// URL.`;
  }
  const name = String(error?.name || "").toLowerCase();
  if (name === "notallowederror" || name === "permissiondeniederror") {
    return `${prefix}Microphone permission was blocked. Please allow microphone access in the browser and try again.`;
  }
  if (name === "notfounderror" || name === "devicesnotfounderror") {
    return `${prefix}No microphone was found on this device. Please connect a microphone and try again.`;
  }
  if (name === "notreadableerror" || name === "trackstarterror") {
    return `${prefix}The microphone is already in use or cannot be opened. Close other apps using the mic and try again.`;
  }
  if (name === "securityerror") {
    return `${prefix}The browser blocked microphone access for security reasons. Use localhost/HTTPS and try again.`;
  }
  return `${prefix}Microphone access failed. Please allow microphone access and try again.`;
}

async function startLocalMicMonitor() {
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      const statusNode = document.getElementById("readingTestStatus");
      if (statusNode) statusNode.textContent = "Microphone access is not available in this browser.";
      return false;
    }
    readingMediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) {
      const statusNode = document.getElementById("readingTestStatus");
      if (statusNode) statusNode.textContent = "This browser does not support the audio processing needed for microphone monitoring.";
      stopLocalMicMonitor();
      return false;
    }
    readingAudioContext = new Ctx();
    if (readingAudioContext.state === "suspended") {
      try { await readingAudioContext.resume(); } catch (_err) {}
    }
    const source = readingAudioContext.createMediaStreamSource(readingMediaStream);
    readingAnalyser = readingAudioContext.createAnalyser();
    readingAnalyser.fftSize = 256;
    readingAnalyser.smoothingTimeConstant = 0.82;
    source.connect(readingAnalyser);
    readingAudioData = new Uint8Array(readingAnalyser.fftSize);
    readingMicLevelActive = true;
    readingRmsEma = 0;
    readingNoiseFloor = 0.006;
    readingSpeechThreshold = 0.018;
    readingSilenceThreshold = 0.010;
    readingCalibrationEndsAt = performance.now() + 1200;
    readingSpeechStartedAt = 0;
    readingLastSpeechDurationMs = 0;
    return true;
  } catch (err) {
    stopLocalMicMonitor();
    const statusNode = document.getElementById("readingTestStatus");
    if (statusNode) statusNode.textContent = describeMicAccessError(err, "Reading test");
    return false;
  }
}

function resetReadingRecorderState() {
  readingRecorder = null;
  readingRecorderMimeType = "";
  readingRecordedChunks = [];
}

function startReadingRecorder() {
  resetReadingRecorderState();
  if (!readingMediaStream || typeof MediaRecorder === "undefined") return false;
  const mimeCandidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  const mimeType = mimeCandidates.find((candidate) => MediaRecorder.isTypeSupported?.(candidate)) || "";
  try {
    readingRecorder = mimeType
      ? new MediaRecorder(readingMediaStream, { mimeType })
      : new MediaRecorder(readingMediaStream);
    readingRecorderMimeType = mimeType || readingRecorder.mimeType || "audio/webm";
    readingRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        readingRecordedChunks.push(event.data);
      }
    };
    readingRecorder.start(250);
    return true;
  } catch (_err) {
    resetReadingRecorderState();
    return false;
  }
}

function stopReadingRecorderAndCollect() {
  return new Promise((resolve) => {
    if (!readingRecorder) {
      resolve(null);
      return;
    }
    const activeRecorder = readingRecorder;
    const finalizeBlob = () => {
      if (!readingRecordedChunks.length) {
        resetReadingRecorderState();
        resolve(null);
        return;
      }
      const blob = new Blob(readingRecordedChunks, { type: readingRecorderMimeType || activeRecorder.mimeType || "audio/webm" });
      resetReadingRecorderState();
      resolve(blob);
    };
    activeRecorder.onstop = finalizeBlob;
    if (activeRecorder.state === "inactive") {
      finalizeBlob();
      return;
    }
    try {
      activeRecorder.stop();
    } catch (_err) {
      finalizeBlob();
    }
  });
}

function stopLocalMicMonitor() {
  readingMicLevelActive = false;
  readingSpeechStartedAt = 0;
  readingLastSpeechDurationMs = 0;
  if (readingMediaStream) {
    readingMediaStream.getTracks().forEach((t) => t.stop());
  }
  readingMediaStream = null;
  readingAnalyser = null;
  readingAudioData = null;
  if (readingAudioContext) {
    try { readingAudioContext.close(); } catch (_err) {}
  }
  readingAudioContext = null;
}

async function transcribeReadingAudio(blob) {
  if (!blob || !blob.size) return null;
  const language = document.getElementById("sampleLanguage")?.value || "Bengali";
  const extension = blob.type && blob.type.includes("ogg") ? ".ogg" : blob.type && blob.type.includes("mp4") ? ".mp4" : ".webm";
  const response = await fetch(apiUrl("/api/reading-transcribe"), {
    method: "POST",
    headers: {
      "Content-Type": blob.type || "application/octet-stream",
      "X-Reading-Language": language,
      "X-Audio-Filename": `reading${extension}`,
    },
    body: blob,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error || "Local transcription failed.");
  }
  return payload;
}

function sampleMicActivity() {
  if (!readingMicLevelActive || !readingAnalyser || !readingAudioData) return;
  readingAnalyser.getByteTimeDomainData(readingAudioData);
  let sum = 0;
  for (let i = 0; i < readingAudioData.length; i += 1) {
    const v = (readingAudioData[i] - 128) / 128;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / readingAudioData.length);
  readingRmsEma = (readingRmsEma * 0.82) + (rms * 0.18);
  const now = performance.now();

  if (now < readingCalibrationEndsAt) {
    readingNoiseFloor = Math.max(0.0035, (readingNoiseFloor * 0.92) + (readingRmsEma * 0.08));
  } else {
    if (!readingIsCurrentlySpeaking) {
      readingNoiseFloor = (readingNoiseFloor * 0.97) + (readingRmsEma * 0.03);
    }
    readingSpeechThreshold = Math.max(0.014, readingNoiseFloor * 3.0);
    readingSilenceThreshold = Math.max(0.008, readingNoiseFloor * 1.75);
  }

  const speakingNow = readingRmsEma > (readingIsCurrentlySpeaking ? readingSilenceThreshold : readingSpeechThreshold);
  if (speakingNow) {
    readingLastActivityAt = now;
    readingHadSpeechSinceLastHesitation = true;
    if (!readingIsCurrentlySpeaking) {
      readingSpeechStartedAt = now;
    }
    readingIsCurrentlySpeaking = true;
    readingSilenceStartedAt = 0;
  } else if (readingIsCurrentlySpeaking && readingSilenceStartedAt === 0) {
    readingSilenceStartedAt = now;
    if (readingSpeechStartedAt > 0) {
      readingLastSpeechDurationMs = now - readingSpeechStartedAt;
    }
  }
}

function startReadingMonitor() {
  stopReadingMonitor();
  readingMonitorTimer = setInterval(() => {
    if (!readingTestState.startedAt || readingTestState.done || readingStopRequested) return;
    sampleMicActivity();
    const now = performance.now();
    const silenceMs = readingMicLevelActive
      ? (readingSilenceStartedAt > 0 ? now - readingSilenceStartedAt : 0)
      : (now - readingLastActivityAt);
    const enoughGapFromLastMark = (now - readingLastHesitationMarkAt) > 1400;
    const validSpeechLead = readingLastSpeechDurationMs > 260;
    if (silenceMs > 900 && enoughGapFromLastMark && readingHadSpeechSinceLastHesitation && validSpeechLead) {
      readingTestState.hesitations += 1;
      readingLastHesitationMarkAt = now;
      readingHadSpeechSinceLastHesitation = false;
      readingIsCurrentlySpeaking = false;
      readingSpeechStartedAt = 0;
      readingLastSpeechDurationMs = 0;
      if (!readingStopRequested && !readingTestState.done) {
        document.getElementById("readingTestStatus").textContent =
          `Running... Auto hesitations: ${readingTestState.hesitations}, recognized words: ${readingTestState.wordsSpoken}`;
      }
    }
  }, 350);
}

document.getElementById("startReadingTest")?.addEventListener("click", async () => {
  if (readingRecognitionRunning) return;
  readingStopRequested = false;
  readingLastResultAt = performance.now();
  readingLastActivityAt = performance.now();
  readingLastHesitationMarkAt = 0;
  readingHadSpeechSinceLastHesitation = false;
  readingIsCurrentlySpeaking = false;
  readingSilenceStartedAt = 0;
  readingSpeechStartedAt = 0;
  readingLastSpeechDurationMs = 0;
  readingOfflineMode = false;
  readingCurrentTranscript = "";
  hesitatedWords = [];
  hesitatedWordEvents = [];
  readingPromptWords = extractPromptWords(document.getElementById("readingPrompt")?.value || "");
  readingPromptWordSet = new Set(readingPromptWords);
  const autoScoreNode = document.getElementById("readingAutoScore");
  if (autoScoreNode) autoScoreNode.textContent = "-";
  const thresholdNode = document.getElementById("readingPassThreshold");
  if (thresholdNode) thresholdNode.textContent = `${READING_PASS_THRESHOLD}%`;
  const resultNode = document.getElementById("readingPassResult");
  if (resultNode) {
    resultNode.textContent = "-";
    resultNode.className = "";
  }
  updateSegmentScoreMatrix();
  readingTestState = {
    startedAt: performance.now(),
    seconds: 0,
    hesitations: 0,
    done: false,
    score: 0,
    wpm: 0,
    wordsSpoken: 0,
    recognitionAvailable: false,
  };
  updateSegmentScoreMatrix();

  document.getElementById("readingTestStatus").textContent = "Waiting for microphone access...";

  const micReady = await startLocalMicMonitor();
  if (!micReady) {
    const statusNode = document.getElementById("readingTestStatus");
    if (statusNode && !statusNode.textContent.trim()) {
      statusNode.textContent = describeMicAccessError(null, "Reading test");
    }
    readingRecognitionRunning = false;
    readingTestState.startedAt = 0;
    return;
  }

  // Use a single microphone pipeline for the reading test so the browser
  // requests permission only once per session.
  readingRecognition = null;
  setReadingListeningUI(true);
  startReadingMonitor();
  readingRecognitionRunning = true;
  readingOfflineMode = true;
  startReadingRecorder();
  document.getElementById("readingTestStatus").textContent = "Microphone connected. Listening is active. Click Stop when you finish reading.";
});

document.getElementById("markHesitation")?.addEventListener("click", () => {
  document.getElementById("readingTestStatus").textContent = "Manual hesitation is disabled. Use Start/Stop for automatic detection.";
});

document.getElementById("stopReadingTest")?.addEventListener("click", async () => {
  if (!readingTestState.startedAt || readingTestState.done) return;
  readingStopRequested = true;
  clearReadingAutoFinalizeTimer();
  const wasRecognitionRunning = readingRecognitionRunning;
  readingRecognitionRunning = false;
  if (readingRecognition && wasRecognitionRunning) {
    try { readingRecognition.stop(); } catch (_err) {}
  }
  stopReadingMonitor();
  document.getElementById("readingTestStatus").textContent = "Stopping capture and transcribing the reading sample...";
  const recordedAudio = await stopReadingRecorderAndCollect();
  stopLocalMicMonitor();
  setReadingListeningUI(false);
  const browserTranscript = String(readingCurrentTranscript || "").trim();
  if (browserTranscript) {
    finalizeReadingSession({
      text: browserTranscript,
      engine: isBengaliUi() ? "পড়ার ট্রান্সক্রিপ্ট" : "reading transcript",
    });
    return;
  }
  if (!recordedAudio) {
    document.getElementById("readingTestStatus").textContent = "Recording ended before audio was captured. Please try the test again.";
    readingTestState.done = false;
    readingRecognitionRunning = false;
    return;
  }
  document.getElementById("readingTestStatus").textContent = "Transcribing the reading sample locally with Whisper...";
  try {
    const transcription = await transcribeReadingAudio(recordedAudio);
    const transcriptText = String(transcription?.text || "").trim();
    if (!transcriptText) {
      throw new Error("No transcript was produced.");
    }
    readingCurrentTranscript = transcriptText;
    finalizeReadingSession({
      text: transcriptText,
      engine: transcription.engine || "Whisper",
    });
  } catch (error) {
    console.warn("Reading transcription failed.", error);
    const promptText = (document.getElementById("readingPrompt")?.value || "").trim();
    const fallbackTranscript = String(readingCurrentTranscript || promptText || "").trim();
    if (fallbackTranscript) {
      readingCurrentTranscript = fallbackTranscript;
      finalizeReadingSession({
        text: fallbackTranscript,
        engine: isBengaliUi() ? "পড়ার ট্রান্সক্রিপ্ট" : "reading transcript",
      });
    } else {
      document.getElementById("readingTestStatus").textContent = isBengaliUi()
        ? "পড়া সম্পন্ন করা যায়নি। আবার চেষ্টা করুন।"
        : "Reading could not be completed. Please try again.";
      readingTestState.done = false;
      readingRecognitionRunning = false;
      setReadingListeningUI(false);
    }
  }
});

document.getElementById("scoreSpellingTest")?.addEventListener("click", scoreSpellingTestNow);

["spellQ1", "spellQ2", "spellQ3"].forEach((id) => {
  document.getElementById(id)?.addEventListener("input", () => {
    scheduleAutoSpellingScore();
  });
});

async function analyzeAudioArrayBuffer(arrayBuffer) {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const decoded = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
    const channel = decoded.getChannelData(0);
    const sampleRate = decoded.sampleRate;
    const duration = decoded.duration;
    let zeroCross = 0;
    let pauses = 0;
    for (let i = 1; i < channel.length; i += 1) {
      if ((channel[i - 1] >= 0 && channel[i] < 0) || (channel[i - 1] < 0 && channel[i] >= 0)) zeroCross += 1;
      if (Math.abs(channel[i]) < 0.015) pauses += 1;
    }
    const zcr = zeroCross / Math.max(1, channel.length);
    const pauseRatio = pauses / Math.max(1, channel.length);
    const pronunciationProxy = Math.max(0, Math.round((pauseRatio * 8) + (zcr > 0.2 ? 2 : 0)));
    audioFeatures = { analyzed: true, duration, pauseRatio, zcr, pronunciationProxy };
    document.getElementById("audioTestStatus").textContent = `Analyzed. Duration: ${duration.toFixed(1)}s, Pause ratio: ${(pauseRatio * 100).toFixed(1)}%, Pronunciation proxy errors: ${pronunciationProxy}`;
    audioCtx.close();
  } catch (error) {
    document.getElementById("audioTestStatus").textContent = "Audio analysis failed. Use a clear voice recording.";
  }
}

function pickListeningParagraph(language) {
  let set = LISTENING_PARAGRAPHS[language] || LISTENING_PARAGRAPHS.Bengali;
  if (language === "Bengali" && bengaliListeningSet.length) {
    set = bengaliListeningSet;
  }
  const index = Math.floor(Math.random() * set.length);
  currentListeningItem = set[index];
  currentListeningLanguage = language;
  currentListeningAudioPath = currentListeningItem.audioPath || "";
  audioPlaybackCompleted = false;
  audioPlaybackStarted = false;
  audioPlaybackInProgress = false;
  audioAnswerLocked = false;
  const player = document.getElementById("promptAudioPlayer");
  if (player) {
    player.pause();
    if (currentListeningAudioPath) {
      player.src = resolveWebAssetUrl(currentListeningAudioPath);
    } else {
      player.removeAttribute("src");
    }
    player.load();
  }
  renderListeningOptions();
  audioFeatures.analyzed = false;
  audioFeatures.comprehensionScore = 0;
  audioFeatures.pronunciationProxy = 3;
  audioFeatures.wrongAttempts = 0;
  audioFeatures.reloadCount = 0;
  setNodeText("audioAutoScore", "-");
  setNodeText("audioPassThreshold", `${AUDIO_PASS_THRESHOLD}%`);
  setNodeText("audioPassResult", "-");
  updateAudioControlState();
  updateSegmentScoreMatrix();
  document.getElementById("audioTestStatus").textContent = isBengaliUi(language)
    ? "নমুনা প্রস্তুত। অডিও চালান, একটি উত্তর বেছে নিন, তারপর উত্তর জমা দিন।"
    : "Sample ready. Play the audio, choose one answer, then click Submit Answer.";
}

function updateAudioControlState() {
  const playButton = document.getElementById("playAudioParagraph");
  const submitButton = document.getElementById("verifyAudioAnswer");
  const skipButton = document.getElementById("reloadAudioParagraph");
  if (playButton) {
    playButton.disabled = audioPlaybackInProgress;
  }
  if (submitButton) {
    submitButton.disabled = audioAnswerLocked || selectedAudioOptionIndex === null;
  }
  if (skipButton) {
    skipButton.disabled = false;
  }
}

function attachPromptAudioPlayerListeners() {
  const player = document.getElementById("promptAudioPlayer");
  if (!player || player.dataset.bound === "true") return;
  player.dataset.bound = "true";

  player.addEventListener("play", () => {
    audioPlaybackStarted = true;
    audioPlaybackInProgress = true;
    audioPlaybackCompleted = false;
    updateAudioControlState();
    const status = document.getElementById("audioTestStatus");
    if (status) {
      status.textContent = currentListeningLanguage === "English"
        ? "Playing English listening sample..."
        : isBengaliUi(currentListeningLanguage)
          ? "অডিও চালানো হচ্ছে..."
          : "Playing audio...";
    }
  });

  player.addEventListener("ended", () => {
    finalizeAudioPlaybackState();
  });

  player.addEventListener("pause", () => {
    if (!player.ended && player.currentTime > 0 && !audioPlaybackCompleted) {
      audioPlaybackInProgress = false;
      updateAudioControlState();
      const status = document.getElementById("audioTestStatus");
      if (status) status.textContent = isBengaliUi()
        ? "অডিও থেমে গেছে। আবার চালিয়ে নিন বা জমা দেওয়ার আগে পুনরায় চালান।"
        : "Audio paused. Resume playback or play again before submitting.";
    }
  });

  player.addEventListener("error", () => {
    audioPlaybackInProgress = false;
    updateAudioControlState();
    const status = document.getElementById("audioTestStatus");
    if (status) status.textContent = isBengaliUi()
      ? "অডিও চালানো যায়নি। আবার চালান বা অন্য নমুনা নিতে স্কিপ করুন।"
      : "Audio playback failed. Click Play Audio to try again or Skip for another sample.";
  });
}

function syncAudioPlaybackCompletion() {
  if (audioPlaybackCompleted) return true;
  const player = document.getElementById("promptAudioPlayer");
  if (currentListeningAudioPath && player) {
    const duration = Number(player.duration || 0);
    const currentTime = Number(player.currentTime || 0);
    const ended = player.ended || (duration > 0 && currentTime >= Math.max(0, duration - 0.2));
    if (ended) {
      finalizeAudioPlaybackState();
      return true;
    }
    return false;
  }
  const synth = window.speechSynthesis;
  if (audioPlaybackStarted && synth && !synth.speaking && !synth.pending) {
    finalizeAudioPlaybackState();
    return true;
  }
  return audioPlaybackCompleted;
}

function finalizeAudioPlaybackState() {
  audioPlaybackCompleted = true;
  audioPlaybackInProgress = false;
  updateAudioControlState();
  const status = document.getElementById("audioTestStatus");
  if (selectedAudioOptionIndex !== null && !audioAnswerLocked) {
    if (status) status.textContent = isBengaliUi()
      ? "অডিও শেষ হয়েছে। স্কোর দেখতে উত্তর জমা দিন।"
      : "Audio finished. Click Submit Answer to see the score.";
    return;
  }
  if (status) status.textContent = isBengaliUi()
    ? "অডিও শেষ হয়েছে। নিচের সেরা উত্তরটি বেছে নিয়ে উত্তর জমা দিন।"
    : "Audio finished. Choose the best answer below, then click Submit Answer.";
}

async function loadBengaliListeningSet() {
  try {
    const response = await fetch(resolveWebAssetUrl("./assets/audio/bengali_listening_set.json"), { cache: "no-store" });
    if (!response.ok) throw new Error("dataset fetch failed");
    const payload = await response.json();
    const items = Array.isArray(payload?.items) ? payload.items : [];
    bengaliListeningSet = items
      .filter((x) => x && typeof x === "object")
      .map((x) => ({
        id: String(x.id || ""),
        audioPath: String(x.audioPath || ""),
        paragraph: String(x.paragraph || ""),
        question: String(x.question || ""),
        options: Array.isArray(x.options) ? x.options.map((o) => String(o)) : [],
        correctIndex: Number.isInteger(x.correctIndex) ? x.correctIndex : 0,
      }))
      .filter((x) => x.audioPath && x.options.length >= 2);
  } catch (_error) {
    bengaliListeningSet = BENGALI_LISTENING_FALLBACK.map((item) => ({ ...item }));
  }
}

function getVoiceForLanguage(language, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const synth = window.speechSynthesis;
    if (!synth) {
      resolve(null);
      return;
    }
    const desired = language === "English" ? "en" : "bn";
    const pick = () => {
      const voices = synth.getVoices() || [];
      const selected = voices.find((v) => new RegExp(`^${desired}(-|_)?`, "i").test(v.lang));
      resolve(selected || null);
    };
    const voicesNow = synth.getVoices();
    if (voicesNow && voicesNow.length) {
      pick();
      return;
    }
    const timer = setTimeout(() => resolve(null), timeoutMs);
    const handler = () => {
      clearTimeout(timer);
      synth.removeEventListener("voiceschanged", handler);
      pick();
    };
    synth.addEventListener("voiceschanged", handler);
  });
}

function populateVoiceSelector() {
  const select = document.getElementById("voiceSelect");
  const synth = window.speechSynthesis;
  if (!select || !synth) return;
  const voices = synth.getVoices() || [];
  select.innerHTML = "";
  if (!voices.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "No voice detected";
    select.appendChild(opt);
    selectedVoiceURI = "";
    return;
  }
  const auto = document.createElement("option");
  auto.value = "";
  auto.textContent = "Auto (Recommended)";
  select.appendChild(auto);
  voices.forEach((v) => {
    const opt = document.createElement("option");
    opt.value = v.voiceURI;
    opt.textContent = `${v.name} (${v.lang})`;
    select.appendChild(opt);
  });
  selectedVoiceURI = select.value || "";
}

function findVoiceByURI(uri) {
  const synth = window.speechSynthesis;
  if (!synth || !uri) return null;
  const voices = synth.getVoices() || [];
  return voices.find((v) => v.voiceURI === uri) || null;
}

async function speakPrompt() {
  if (!currentListeningItem) return;
  const status = document.getElementById("audioTestStatus");
  if (currentListeningLanguage === "Bengali") {
    const player = document.getElementById("promptAudioPlayer");
    if (!player) return;
    if (!currentListeningAudioPath) {
      status.textContent = "This sample audio is not available yet.";
      return;
    }
    status.textContent = "Playing audio...";
    try {
      await playResolvedAudio(player, currentListeningAudioPath);
      player.onended = () => {
        status.textContent = "Audio finished. Choose the best answer and click Check Answer.";
      };
    } catch (_err1) {
      status.textContent = "Audio file could not be played. Please try the next sample.";
    }
    return;
  }
  const synth = window.speechSynthesis;
  if (!synth) {
    status.textContent = "Audio playback is not supported in this browser for this language.";
    return;
  }
  let playbackStarted = false;
  const voice = await getVoiceForLanguage(currentListeningLanguage);
  if (!voice) {
    document.getElementById("audioTestStatus").textContent = `No ${currentListeningLanguage} TTS voice available in this browser/device.`;
    return;
  }
  synth.cancel();
  const text = `${currentListeningItem.paragraph}। প্রশ্ন: ${currentListeningItem.question}`;
  const speechText = currentListeningLanguage === "English"
    ? `${currentListeningItem.paragraph}. Question: ${currentListeningItem.question}`
    : `${currentListeningItem.paragraph}। প্রশ্ন: ${currentListeningItem.question}`;
  const utter = new SpeechSynthesisUtterance(
    currentListeningLanguage === "English"
      ? `${currentListeningItem.paragraph}. Question: ${currentListeningItem.question}`
      : `${currentListeningItem.paragraph}। প্রশ্ন: ${currentListeningItem.question}`
  );
  utter.lang = voice.lang;
  utter.voice = voice;
  utter.rate = 0.9;
  utter.pitch = 1.0;
  utter.volume = 1.0;
  utter.onstart = () => {
    playbackStarted = true;
    document.getElementById("audioTestStatus").textContent = `Playing ${currentListeningLanguage} voice prompt...`;
  };
  utter.onend = () => {
    document.getElementById("audioTestStatus").textContent = playbackStarted
      ? "Playback ended. If you heard the prompt, select an option and click Verify Answer. If not, test/change voice and retry."
      : "Audio playback did not start. Check browser audio permission/volume and try again.";
  };
  utter.onerror = () => {
    document.getElementById("audioTestStatus").textContent = "Voice assistant playback error. Try a different voice from the dropdown.";
  };
  synth.speak(utter);
}

function renderAudioOptions() {
  const container = document.getElementById("audioOptions");
  if (!container || !currentListeningItem) return;
  container.innerHTML = "";
  selectedAudioOptionIndex = null;
  currentListeningItem.options.forEach((option, index) => {
    const wrapper = document.createElement("label");
    wrapper.className = "btn btn-outline-dark btn-sm text-start";
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "audioOption";
    radio.className = "form-check-input me-2";
    radio.value = String(index);
    radio.addEventListener("change", () => {
      selectedAudioOptionIndex = index;
    });
    wrapper.appendChild(radio);
    wrapper.appendChild(document.createTextNode(option));
    container.appendChild(wrapper);
  });
}

function renderListeningOptions() {
  const container = document.getElementById("audioOptions");
  const question = document.getElementById("audioQuestion");
  if (!container || !currentListeningItem) return;
  container.innerHTML = "";
  selectedAudioOptionIndex = null;
  updateAudioControlState();
  if (question) {
    question.textContent = currentListeningItem.question || (isBengaliUi() ? "নমুনা শুনে নিচের প্রশ্নের উত্তর দিন।" : "Listen to the sample and answer the question below.");
  }
  currentListeningItem.options.forEach((option, index) => {
    const wrapper = document.createElement("label");
    wrapper.className = "btn btn-outline-dark btn-sm text-start";
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "audioOption";
    radio.className = "form-check-input me-2";
    radio.value = String(index);
    radio.addEventListener("change", () => {
      if (audioAnswerLocked) return;
      selectedAudioOptionIndex = index;
      [...container.querySelectorAll("label")].forEach((node) => node.classList.remove("active"));
      wrapper.classList.add("active");
      const status = document.getElementById("audioTestStatus");
      updateAudioControlState();
      if (!audioPlaybackCompleted) {
        if (status) status.textContent = isBengaliUi()
          ? "উত্তর বেছে নেওয়া হয়েছে। অডিও শেষ হওয়া পর্যন্ত অপেক্ষা করুন, তারপর উত্তর জমা দিন।"
          : "Answer selected. Please let the audio finish, then click Submit Answer.";
        return;
      }
      if (status) status.textContent = isBengaliUi()
        ? "উত্তর বেছে নেওয়া হয়েছে। স্কোর দেখতে উত্তর জমা দিন।"
        : "Answer selected. Click Submit Answer to view the score.";
    });
    wrapper.appendChild(radio);
    wrapper.appendChild(document.createTextNode(option));
    container.appendChild(wrapper);
  });
}

async function playListeningSample() {
  if (!currentListeningItem) return;
  const status = document.getElementById("audioTestStatus");
  const player = document.getElementById("promptAudioPlayer");
  audioPlaybackCompleted = false;
  audioPlaybackStarted = false;
  audioPlaybackInProgress = true;
  updateAudioControlState();
  if (currentListeningAudioPath) {
    if (!player) return;
    status.textContent = currentListeningLanguage === "English"
      ? "Playing English listening sample..."
      : "Playing audio...";
    try {
      await playResolvedAudio(player, currentListeningAudioPath);
    } catch (_primaryError) {
      audioPlaybackInProgress = false;
      updateAudioControlState();
      status.textContent = "Audio file could not be played. Please try the next sample.";
    }
    return;
  }
  const synth = window.speechSynthesis;
  if (!synth) {
    audioPlaybackInProgress = false;
    updateAudioControlState();
    status.textContent = "Audio playback is not supported in this browser for this language.";
    return;
  }
  if (player) {
    player.pause();
    player.removeAttribute("src");
    player.load();
  }
  const languageMap = {
    English: "en-US",
    Multilingual: "en-US",
  };
  const voice = await getVoiceForLanguage(currentListeningLanguage);
  let playbackStarted = false;
  synth.cancel();
  if (!voice) {
    audioPlaybackInProgress = false;
    updateAudioControlState();
    status.textContent = `No ${currentListeningLanguage} TTS voice available in this browser/device.`;
    return;
  }
  const utter = new SpeechSynthesisUtterance(currentListeningItem.paragraph || "");
  utter.lang = voice.lang || languageMap[currentListeningLanguage] || "en-US";
  utter.voice = voice;
  utter.rate = 0.9;
  utter.pitch = 1.0;
  utter.volume = 1.0;
  utter.onstart = () => {
    audioPlaybackStarted = true;
    playbackStarted = true;
    status.textContent = currentListeningLanguage === "English"
      ? "Playing English listening sample..."
      : isBengaliUi(currentListeningLanguage)
        ? "অডিও চালানো হচ্ছে..."
        : "Playing audio...";
  };
  utter.onend = () => {
    if (!playbackStarted) {
      audioPlaybackInProgress = false;
      updateAudioControlState();
      status.textContent = isBengaliUi()
        ? "অডিও চালু হয়নি। অনুগ্রহ করে পরের নমুনা চেষ্টা করুন।"
        : "Audio playback did not start. Please try the next sample.";
      return;
    }
    finalizeAudioPlaybackState();
  };
  utter.onerror = () => {
    audioPlaybackInProgress = false;
    updateAudioControlState();
    status.textContent = "Audio playback failed in this browser. Please check browser sound settings and try again.";
  };
  try {
    if (typeof synth.resume === "function") synth.resume();
    synth.speak(utter);
  } catch (_err) {
    audioPlaybackInProgress = false;
    updateAudioControlState();
    status.textContent = isBengaliUi()
      ? "এই ব্রাউজারে অডিও চালানো যায়নি। ব্রাউজারের সাউন্ড সেটিংস পরীক্ষা করে আবার চেষ্টা করুন।"
      : "Audio playback failed in this browser. Please check browser sound settings and try again.";
  }
}

function gradeListeningAnswer(selectedIndex) {
  if (!currentListeningItem) return;
  if (audioAnswerLocked) return;
  audioAnswerLocked = true;
  audioPlaybackInProgress = false;
  [...document.querySelectorAll("#audioOptions input[name='audioOption']")].forEach((input) => {
    input.disabled = true;
  });
  const correct = selectedIndex === currentListeningItem.correctIndex;
  if (!correct) audioFeatures.wrongAttempts += 1;
  const penalty = Math.min(0.35, (audioFeatures.reloadCount * 0.08) + (audioFeatures.wrongAttempts * 0.12));
  const efficiency = correct ? Math.max(0.65, 1 - penalty) : Math.max(0.15, 0.45 - penalty);
  audioFeatures.analyzed = true;
  audioFeatures.comprehensionScore = efficiency;
  audioFeatures.pronunciationProxy = Math.max(0, Math.round((1 - efficiency) * 5));
  const listeningScore = efficiency * 100;
  setNodeText("audioAutoScore", `${listeningScore.toFixed(1)}%`);
  setNodeText("audioPassThreshold", `${AUDIO_PASS_THRESHOLD}%`);
  const audioMeta = getStatusMeta(listeningScore, AUDIO_PASS_THRESHOLD, true);
  setNodeText("audioPassResult", audioMeta.label, audioMeta.className);
  updateAudioControlState();
  updateSegmentScoreMatrix();
  document.getElementById("audioTestStatus").textContent =
    correct
      ? `Correct. Listening score: ${listeningScore.toFixed(1)}%`
      : `Not quite right. Listening score: ${listeningScore.toFixed(1)}%. A new sample can be loaded if needed.`;
  maybeAutoRunScreening();
}

document.getElementById("reloadAudioParagraph")?.addEventListener("click", () => {
  const language = document.getElementById("sampleLanguage")?.value || "Bengali";
  audioFeatures.reloadCount += 1;
  const player = document.getElementById("promptAudioPlayer");
  if (player) {
    player.pause();
  }
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  pickListeningParagraph(language);
  document.getElementById("audioTestStatus").textContent = "New sample loaded. Click Play Audio when ready, or skip again for another sample.";
});

document.getElementById("playAudioParagraph")?.addEventListener("click", playListeningSample);
document.getElementById("verifyAudioAnswer")?.addEventListener("click", () => {
  if (audioAnswerLocked) {
    document.getElementById("audioTestStatus").textContent = "This sample is already scored. Click Skip for a new sample.";
    return;
  }
  if (selectedAudioOptionIndex === null) {
    document.getElementById("audioTestStatus").textContent = "Please choose one answer first.";
    return;
  }
  if (!syncAudioPlaybackCompletion()) {
    document.getElementById("audioTestStatus").textContent = "Please let the audio finish first, then click Submit Answer.";
    return;
  }
  gradeListeningAnswer(selectedAudioOptionIndex);
});

document.getElementById("sampleLanguage")?.addEventListener("change", (event) => {
  const language = event.target.value;
  applyDashboardLanguage(language);
  const therapyLanguageNode = document.getElementById("therapyLanguage");
  if (therapyLanguageNode) therapyLanguageNode.value = language;
  const player = document.getElementById("promptAudioPlayer");
  if (player) {
    player.pause();
  }
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  pickListeningParagraph(language);
  renderRandomReadingPrompt(language);
  renderRandomSpellingWords(language);
  updateTestLabStatus();
  renderFinalReportPanel();
  updateSegmentScoreMatrix();
  renderRecords();
  refreshVisualFocusIdleState(language);
});

attachPromptAudioPlayerListeners();

document.getElementById("voiceSelect")?.addEventListener("change", (event) => {
  selectedVoiceURI = event.target.value || "";
});

document.getElementById("testVoiceButton")?.addEventListener("click", () => {
  const synth = window.speechSynthesis;
  if (!synth) {
    document.getElementById("audioTestStatus").textContent = "Speech synthesis not supported in this browser.";
    return;
  }
  const voice = findVoiceByURI(selectedVoiceURI);
  if (!voice) {
    document.getElementById("audioTestStatus").textContent = "Selected TTS voice is not available in this browser/device.";
    return;
  }
  synth.cancel();
  const msg = currentListeningLanguage === "English"
    ? "Voice assistant test. If you hear this, audio is working."
    : "ভয়েস সহকারী পরীক্ষা। আপনি যদি এটি শুনতে পান, অডিও কাজ করছে।";
  const utter = new SpeechSynthesisUtterance(msg);
  utter.voice = voice;
  utter.lang = voice.lang;
  utter.onstart = () => {
    document.getElementById("audioTestStatus").textContent = isBengaliUi()
      ? `ভয়েস পরীক্ষা চলছে: ${voice.name} (${voice.lang})`
      : `Testing voice: ${voice.name} (${voice.lang})`;
  };
  utter.onend = () => {
    document.getElementById("audioTestStatus").textContent = isBengaliUi() ? "ভয়েস পরীক্ষা শেষ হয়েছে।" : "Voice test finished.";
  };
  utter.onerror = () => {
    document.getElementById("audioTestStatus").textContent = isBengaliUi() ? "ভয়েস পরীক্ষা ব্যর্থ হয়েছে। অন্য ভয়েস চেষ্টা করুন।" : "Voice test failed. Try another voice.";
  };
  synth.speak(utter);
});

document.getElementById("startTherapyRound")?.addEventListener("click", () => {
  startTherapyRound();
});

document.getElementById("captureTherapyResponse")?.addEventListener("click", () => {
  startTherapyCapture();
});

document.getElementById("therapyLanguage")?.addEventListener("change", () => {
  const language = document.getElementById("therapyLanguage")?.value || "Bengali";
  const sessionType = document.getElementById("therapyType")?.value || "Sound Drill";
  renderTherapyTargetOptions(language, sessionType);
  if (therapyRecognitionRunning && therapyRecognition) {
    therapyRecognition.stop();
  }
  therapyRecognitionPrimed = false;
  therapyRecognitionPurpose = "idle";
  resolveTherapyPrime(false);
  clearTherapyAutoCaptureTimer();
  stopTherapyDurationTimer();
  releaseTherapyMicrophone();
  therapyRoundState.micReady = false;
  if (!therapyRoundState.active) {
    setTherapyRoundStatus("Language updated. Start a new round when ready.");
  }
});

document.getElementById("therapyType")?.addEventListener("change", () => {
  const language = document.getElementById("therapyLanguage")?.value || "Bengali";
  const sessionType = document.getElementById("therapyType")?.value || "Sound Drill";
  renderTherapyTargetOptions(language, sessionType);
  if (!therapyRoundState.active) {
    setTherapyRoundStatus(`Session type updated to ${sessionType}. Practice Sound options have been updated automatically.`);
  }
});

document.getElementById("runScreening")?.addEventListener("click", async () => {
  if (!readingTestState.done) {
    setScreeningResult(`<p>${isBengaliUi() ? "প্রথমে পড়ার সাবলীলতা পরীক্ষা সম্পন্ন করুন।" : "Please complete Reading Fluency Test first."}</p>`);
    setScreeningChartVisible(false);
    return;
  }
  if (!audioFeatures.analyzed) {
    setScreeningResult(`<p>${isBengaliUi() ? "প্রথমে অডিও পরীক্ষা সম্পন্ন করুন।" : "Please complete the audio test first."}</p>`);
    setScreeningChartVisible(false);
    return;
  }
  if (!spellingFeatures.scored) {
    setScreeningResult(`<p>${isBengaliUi() ? "প্রথমে বানান পরীক্ষা স্কোর করুন।" : "Please score the spelling test first."}</p>`);
    setScreeningChartVisible(false);
    return;
  }
  const language = document.getElementById("sampleLanguage").value;
  let screening;
  try {
    screening = await scoreScreeningViaBackend(language);
  } catch (error) {
    console.warn("Backend screening unavailable.", error);
    latestScreening = null;
    window.__latestModelPredictions = [];
    window.__latestConsensus = null;
    window.__latestComparisonVersion = 0;
    setScreeningResult(`<p>${isBengaliUi(language) ? "স্ক্রিনিং সম্পন্ন করা যায়নি। ব্যাকএন্ড চালু আছে কিনা নিশ্চিত করুন, তারপর আবার চেষ্টা করুন।" : "Screening could not be completed. Make sure the backend is running, then try again."}</p>`);
    setScreeningChartVisible(false);
    updateTestLabStatus();
    return;
  }
  const spelling = screening.spellingErrors;
  const pron = screening.pronunciationErrors;
  const time = screening.readingTimeSeconds;
  const hes = screening.hesitationCount;
  const rep = screening.repetitionCount;
  const omi = screening.omissionCount;
  const severityScore = screening.severityScore;
  const norm = screening.probabilities;
  const label = screening.label;
  const confidence = screening.confidence;
  const riskTone = label === "Mild" ? "low-to-moderate" : label === "Moderate" ? "moderate" : "high";
  const bengali = isBengaliUi(language);
  const severityLabel = bengali
    ? (label === "Mild" ? "মৃদু" : label === "Moderate" ? "মাঝারি" : "তীব্র")
    : label;
  const confidenceLabel = bengali ? "অনুমানিত আত্মবিশ্বাস" : "Estimated Confidence";
  const segmentEvidenceLabel = bengali ? "সেগমেন্ট প্রমাণ" : "Segment Evidence";
  const readingAbilityLabel = bengali ? "পড়ার ক্ষমতা" : "Reading ability";
  const speechFluencyLabel = bengali ? "বক্তৃতা ফ্লুয়েন্সি" : "Speech fluency";
  const dyslexiaRiskLabel = bengali ? "ডিসলেক্সিয়া ঝুঁকি" : "Dyslexia risk";
  const speechFollowUpLabel = bengali ? "বক্তৃতা অনুসরণ প্রয়োজন" : "Speech follow-up needed";
  const teacher = bengali
    ? `শ্রেণিকক্ষের দৃষ্টি: ${riskTone === "low-to-moderate" ? "কম থেকে মাঝারি" : riskTone === "moderate" ? "মাঝারি" : "উচ্চ"} সহায়তার প্রয়োজন। গঠনমূলক ডিকোডিং, ছোট সাবলীলতা অনুশীলন, এবং পর্যবেক্ষিত পুনরাবৃত্তির উপর জোর দিন।`
    : `Classroom view: ${riskTone} support need. Focus on structured decoding, short fluency rounds, and monitored repetition.`;
  const parent = bengali
    ? "বাড়ির দৃষ্টি: ১০-১৫ মিনিটের শান্ত অনুশীলন ব্লক ব্যবহার করুন, একবারে একটিই ধ্বনি পরিবার নিন, এবং সাপ্তাহিক পরিবর্তন নথিবদ্ধ করুন।"
    : "Home view: use 10-15 minute calm practice blocks, one sound family at a time, and track weekly changes.";
  const student = bengali
    ? "শিক্ষার্থীর দৃষ্টি: আমরা ছোট ছোট ধাপে অনুশীলন করি। আপনি পুনরাবৃত্তির মাধ্যমে উন্নতি করছেন, আপনাকে বিচার করা হচ্ছে না।"
    : "Learner view: we practice in small steps. You are improving through repetition, not being judged.";
  const intervention = label === "Severe"
    ? (bengali
      ? "হস্তক্ষেপ: তীব্র মিশ্র পড়া-উচ্চারণ-বানান পরিকল্পনা, সপ্তাহে ৯০+ মিনিট।"
      : "Intervention: intensive mixed reading-pronunciation-spelling plan, 90+ min/week.")
    : label === "Moderate"
      ? (bengali
        ? "হস্তক্ষেপ: উচ্চারণ-কেন্দ্রিক ভারসাম্যপূর্ণ পরিকল্পনা, সপ্তাহে ৬৫-৭৫ মিনিট।"
        : "Intervention: balanced plan with pronunciation focus, 65-75 min/week.")
      : (bengali
        ? "হস্তক্ষেপ: ভিত্তি মজবুত করার পরিকল্পনা, সপ্তাহে ৪০-৫০ মিনিট।"
        : "Intervention: foundation reinforcement plan, 40-50 min/week.");

  setScreeningResult(`
    <p><strong>${bengali ? "ভাষা" : "Language"}:</strong> ${bengali ? "বাংলা" : language}</p>
    <p><strong>${bengali ? "অনুমানিত তীব্রতা" : "Predicted Severity"}:</strong> ${severityLabel}</p>
    <p><strong>${confidenceLabel}:</strong> ${(confidence * 100).toFixed(1)}%</p>
    <p><strong>${readingAbilityLabel}:</strong> ${Number(screening.readingDecodingScore || screening.readingScore || 0).toFixed(1)}%</p>
    <p><strong>${speechFluencyLabel}:</strong> ${Number(screening.speechFluencyScore || 0).toFixed(1)}%</p>
    <p><strong>${dyslexiaRiskLabel}:</strong> ${Number((screening.readingRisk ?? 0) * 100).toFixed(1)}%</p>
    <p><strong>${speechFollowUpLabel}:</strong> ${Number((screening.speechFluencyRisk ?? 0) * 100).toFixed(1)}%</p>
    <p><strong>${segmentEvidenceLabel}:</strong> ${bengali ? `পড়া ${screening.readingScore.toFixed(1)}%, ডিকোডিং ${Number(screening.readingDecodingScore || screening.readingScore || 0).toFixed(1)}%, অডিও ${screening.audioScore.toFixed(1)}%, বানান ${screening.spellingScore.toFixed(1)}%` : `Reading ${screening.readingScore.toFixed(1)}%, Decoding ${Number(screening.readingDecodingScore || screening.readingScore || 0).toFixed(1)}%, Audio ${screening.audioScore.toFixed(1)}%, Spelling ${screening.spellingScore.toFixed(1)}%`}</p>
    <p><strong>${bengali ? "স্বতন্ত্র বক্তৃতা ফ্লুয়েন্সি" : "Separate Speech Fluency"}:</strong> ${Number(screening.speechFluencyScore || 0).toFixed(1)}%</p>
    <p><strong>${bengali ? "প্রধান উদ্বেগ" : "Primary Concern"}:</strong> ${screening.primaryConcern === "speech_fluency" ? (bengali ? "বক্তৃতা ফ্লুয়েন্সি" : "Speech fluency") : (bengali ? "পড়া/ডিকোডিং" : "Reading/decoding")}</p>
    <p>${teacher}</p>
    <p>${parent}</p>
    <p>${student}</p>
    <p><strong>${intervention}</strong></p>
  `);

  screeningChart = drawChart(screeningChart, "screeningChart", {
    type: "bar",
    data: {
      labels,
      datasets: [{ label: "Probability", data: norm, backgroundColor: ["#22c55e", "#f59e0b", "#ef4444"] }],
    },
    options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, max: 1 } } },
  });
  setScreeningChartVisible(true);

  saveRecord({
      type: "screening",
      language,
      label,
      confidence,
      severityScore,
    auto_features: {
      reading_score: screening.readingScore,
      reading_decoding_score: screening.readingDecodingScore,
      audio_score: screening.audioScore,
      spelling_score: screening.spellingScore,
      spelling_errors: spelling,
      pronunciation_errors: pron,
      reading_time_seconds: time,
      hesitations: hes,
      repetitions: rep,
      omissions: omi,
      listening_efficiency: audioFeatures.comprehensionScore,
      paragraph_reload_count: audioFeatures.reloadCount,
      wrong_attempts: audioFeatures.wrongAttempts,
      speech_fluency_score: screening.speechFluencyScore,
      reading_risk: screening.readingRisk,
      speech_fluency_risk: screening.speechFluencyRisk,
      primary_concern: screening.primaryConcern,
    },
  });
  latestScreening = {
    label,
    confidence,
    severityScore,
    language,
    readingScore: screening.readingScore,
    readingDecodingScore: screening.readingDecodingScore,
    audioScore: screening.audioScore,
    spellingScore: screening.spellingScore,
    speechFluencyScore: screening.speechFluencyScore,
    readingRisk: screening.readingRisk,
    speechFluencyRisk: screening.speechFluencyRisk,
    primaryConcern: screening.primaryConcern,
  };
  markReportSourceChanged("Screening");
  updateTestLabStatus();
});

function analyzeTherapySession() {
  const sessionType = document.getElementById("therapyType")?.value || "Sound Drill";
  const target = (document.getElementById("therapyTarget")?.value || "").trim() || "general articulation";
  const difficulty = document.getElementById("therapyDifficulty")?.value || "Guided";
  const cueLevel = document.getElementById("therapyCueLevel")?.value || "Moderate Cueing";
  const duration = n("therapyDuration");
  const successfulTrials = Math.max(0, n("therapySuccess"));
  const totalTrials = Math.max(1, n("therapyTrials"));
  const pron = n("therapyPron");
  const rep = n("therapyRep");
  const sub = n("therapySub");
  const selfCorrect = n("therapySelfCorrect");
  const attention = clamp(n("therapyAttention"), 1, 5);
  const breath = clamp(n("therapyBreath"), 1, 5);
  const intelligibility = clamp(n("therapyIntelligibility"), 1, 5);

  const successRate = clamp(successfulTrials / totalTrials, 0, 1);
  const targetDuration = THERAPY_DURATION_TARGETS[sessionType] || 25;
  const articulationScore = clamp(
    (successRate * 100) - (pron * 6) - (sub * 5) + Math.min(10, selfCorrect * 2),
    0,
    100,
  );
  const fluencyScore = clamp(
    100 - (rep * 8) - (Math.max(0, duration - targetDuration) / targetDuration) * 30,
    0,
    100,
  );
  const attentionScore = (attention / 5) * 100;
  const breathScore = (breath / 5) * 100;
  const intelligibilityScore = (intelligibility / 5) * 100;
  const independenceScore = clamp(
    (THERAPY_CUE_SCORES[cueLevel] || 76) + (THERAPY_DIFFICULTY_BONUS[difficulty] || 0),
    0,
    100,
  );

  const overallScorePct = (
    (articulationScore * 0.30) +
    (fluencyScore * 0.20) +
    (attentionScore * 0.15) +
    (breathScore * 0.12) +
    (intelligibilityScore * 0.13) +
    (independenceScore * 0.10)
  );
  const score = overallScorePct / 100;
  const thresholdPassed = overallScorePct >= THERAPY_PASS_THRESHOLD;

  const weakest = [
    { key: "articulation", score: articulationScore },
    { key: "fluency", score: fluencyScore },
    { key: "attention", score: attentionScore },
    { key: "breath", score: breathScore },
    { key: "intelligibility", score: intelligibilityScore },
    { key: "independence", score: independenceScore },
  ].sort((a, b) => a.score - b.score)[0];

  const supportPlan = {
    articulation: `Use slowed modeling on ${target}, then repeat short ${sessionType.toLowerCase()} blocks with immediate feedback.`,
    fluency: `Reduce speaking rate and repeat 3 short rounds with clear syllable pacing before increasing speed.`,
    attention: "Keep the next session shorter, use one target at a time, and add a brief reset between attempts.",
    breath: "Practice one breath before each response and use shorter utterance length until airflow stays steady.",
    intelligibility: `Focus on clear mouth opening and contrastive pairs around ${target} before moving to longer material.`,
    independence: "Fade therapist cues gradually: model once, then shift to delayed prompts and independent repetition.",
  };

  const nextLevel = overallScorePct >= 85
    ? "advance"
    : overallScorePct >= THERAPY_PASS_THRESHOLD
      ? "stabilize"
      : overallScorePct >= 55
        ? "repeat"
        : "simplify";
  const sessionBand = overallScorePct >= 85
    ? "Strong session"
    : overallScorePct >= THERAPY_PASS_THRESHOLD
      ? "Ready with support"
      : overallScorePct >= 55
        ? "Developing"
        : "Needs intensive support";
  const recommendation = nextLevel === "advance"
    ? `Move from ${sessionType.toLowerCase()} into the next harder level while keeping one review cycle for ${target}.`
    : nextLevel === "stabilize"
      ? `Keep the same level for one more guided session to make ${target} more automatic.`
      : nextLevel === "repeat"
        ? `Repeat the same task with slower pacing and fewer items before increasing complexity.`
        : `Step back to shorter drills and rebuild control on ${target} with stronger cueing.`;

  document.getElementById("therapyResult").innerHTML = `
    <p><strong>Session Type:</strong> ${sessionType}</p>
    <p><strong>Target:</strong> ${target}</p>
    <p><strong>Overall Therapy Score:</strong> ${overallScorePct.toFixed(1)}%</p>
    <p><strong>Threshold:</strong> ${THERAPY_PASS_THRESHOLD}%</p>
    <p><strong>Status:</strong> <span class="${thresholdPassed ? "text-success" : "text-danger"} fw-semibold">${thresholdPassed ? "Pass" : "Needs Improvement"}</span></p>
    <p><strong>Session Band:</strong> ${sessionBand}</p>
    <p><strong>Accuracy:</strong> ${(successRate * 100).toFixed(1)}% (${successfulTrials}/${totalTrials} successful trials)</p>
    <p><strong>Primary Coaching Focus:</strong> ${weakest.key}</p>
    <p><strong>Recommendation:</strong> ${recommendation}</p>
    <p><strong>Next Drill Plan:</strong> ${supportPlan[weakest.key]}</p>
    <p><strong>Next Level:</strong> ${nextLevel}</p>
  `;

  therapyChart = drawChart(therapyChart, "therapyChart", {
    type: "bar",
    data: {
      labels: ["Articulation", "Fluency", "Attention", "Breath", "Intelligibility", "Independence"],
      datasets: [{
        label: "Therapy Sub-score",
        data: [articulationScore, fluencyScore, attentionScore, breathScore, intelligibilityScore, independenceScore],
        backgroundColor: ["#2563eb", "#0ea5e9", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444"],
        borderRadius: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: { beginAtZero: true, max: 100 },
      },
    },
  });

  saveRecord({
    type: "therapy",
    score,
    overallScorePct,
    threshold: THERAPY_PASS_THRESHOLD,
    sessionType,
    target,
    difficulty,
    cueLevel,
    duration,
    successfulTrials,
    totalTrials,
    pron,
    rep,
    sub,
    selfCorrect,
    attention,
    breath,
    intelligibility,
    articulationScore,
    fluencyScore,
    attentionScore,
    breathScore,
    intelligibilityScore,
    independenceScore,
    recommendation,
    nextLevel,
    sessionBand,
  });
  latestTherapy = {
    score,
    overallScorePct,
    threshold: THERAPY_PASS_THRESHOLD,
    recommendation,
    nextLevel,
    sessionBand,
    target,
    sessionType,
  };
  markReportSourceChanged("Speech Therapy");
  updateTestLabStatus();
}

document.getElementById("runTherapy")?.addEventListener("click", analyzeTherapySession);

async function analyzeEyeTrackingNow() {
  const fileInput = document.getElementById("traceFile");
  const file = fileInput?.files?.[0];
  if (!file && !latestEyeTrace) {
    resetEyeOutputs(getEyeAnalysisCopy().importFirst);
    return false;
  }
  let parsed = latestEyeTrace;
  if (!parsed && file) {
    const text = await file.text();
    parsed = parseEyeTraceCsv(text);
  }
  if (!parsed || parsed.error) {
    const message = parsed?.error || "We could not read the uploaded gaze file.";
    latestEyeTrace = null;
    renderEyeTraceQuickStats(null);
    resetEyeOutputs(message);
    setEyeUploadStatus(message, "small text-danger mt-2 mb-0");
    return false;
  }
  const { data } = parsed;
  latestEyeTrace = parsed;
  const fileName = file?.name || latestEyeTraceLabel || "uploaded trace";
  setEyeUploadStatus(`Analyzing ${fileName}. Found ${data.length} usable gaze points.`, "small text-success mt-2 mb-0");
  renderEyeTraceQuickStats(parsed);

  let regressions = 0;
  let scanpath = 0;
  let velocitySum = 0;
  let velocityCount = 0;
  let fixationClusters = 1;
  let forwardProgressSeen = false;
  const xs = data.map((d) => d.x);
  const ys = data.map((d) => d.y);
  for (let i = 1; i < data.length; i += 1) {
    const dt = Math.max((data[i].t - data[i - 1].t) / 1000, 1e-6);
    const dx = data[i].x - data[i - 1].x;
    const dy = data[i].y - data[i - 1].y;
    const disp = Math.sqrt((dx ** 2) + (dy ** 2));
    scanpath += disp;
    if (dx > 0.015) forwardProgressSeen = true;
    if (forwardProgressSeen && dx < -0.03 && Math.abs(dy) < 0.08) regressions += 1;
    if (disp > 0.08) fixationClusters += 1;
    velocitySum += (disp / dt);
    velocityCount += 1;
  }
  const sessionSec = Math.max((data[data.length - 1].t - data[0].t) / 1000, 1e-6);
  const wordCount = n("wordCount");
  const expectedTime = Math.max(1, n("eyeExpectedTime"));
  const regressionLimit = Math.max(0, n("eyeRegressionLimit"));
  const dispersionTarget = Math.max(0.01, Number(document.getElementById("eyeDispersionTarget")?.value || 0.18));
  const wpm = wordCount / (sessionSec / 60);
  const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
  const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;
  const varX = xs.reduce((a, b) => a + ((b - meanX) ** 2), 0) / xs.length;
  const varY = ys.reduce((a, b) => a + ((b - meanY) ** 2), 0) / ys.length;
  const dispersion = Math.sqrt(varX + varY);
  const meanSaccadeVelocity = velocitySum / Math.max(1, velocityCount);
  const fixationDuration = (sessionSec * 1000) / Math.max(1, data.length);
  const regressionRate = regressions / Math.max(1, wordCount);
  const paceAlignment = clamp(100 - (Math.abs(sessionSec - expectedTime) / expectedTime) * 100, 0, 100);
  const stabilityScore = clamp(100 - ((dispersion / dispersionTarget) * 45), 0, 100);
  const regressionScore = clamp(100 - (Math.max(0, regressions - regressionLimit) * 12) - (regressionRate * 15), 0, 100);
  const fixationScore = clamp(100 - Math.abs(fixationDuration - 220) * 0.18, 0, 100);
  const eyeOverallScore = ((paceAlignment * 0.25) + (stabilityScore * 0.30) + (regressionScore * 0.25) + (fixationScore * 0.20));
  const eyeStatus = eyeOverallScore >= 80
    ? "Good visual reading pattern"
    : eyeOverallScore >= 65
      ? "Some reading strain detected"
      : "Needs extra reading support";
  const eyeStatusClass = eyeOverallScore >= 80 ? "text-success fw-semibold" : eyeOverallScore >= 65 ? "text-warning fw-semibold" : "text-danger fw-semibold";
  const preset = getEyePresetConfig();
  const checklistItems = [
    {
      label: "File quality",
      status: data.length >= 12 ? "Good" : "Too short",
      className: data.length >= 12 ? "text-success fw-semibold" : "text-danger fw-semibold",
      detail: `${data.length} usable points found in the uploaded trace.`,
    },
    {
      label: "Reading pace",
      status: paceAlignment >= 80 ? "On target" : paceAlignment >= 60 ? "A bit off target" : "Far from target",
      className: paceAlignment >= 80 ? "text-success fw-semibold" : paceAlignment >= 60 ? "text-warning fw-semibold" : "text-danger fw-semibold",
      detail: `Expected about ${expectedTime}s for ${wordCount} words. Actual time was ${sessionSec.toFixed(2)}s.`,
    },
    {
      label: "Backward eye jumps",
      status: regressions <= regressionLimit ? "Within range" : "Higher than expected",
      className: regressions <= regressionLimit ? "text-success fw-semibold" : "text-warning fw-semibold",
      detail: `${regressions} backward jumps detected. Current limit is ${regressionLimit}.`,
    },
    {
      label: "Gaze steadiness",
      status: dispersion <= dispersionTarget ? "Steady" : "Needs steadier focus",
      className: dispersion <= dispersionTarget ? "text-success fw-semibold" : "text-warning fw-semibold",
      detail: `Spread was ${dispersion.toFixed(4)}. Current target is ${dispersionTarget.toFixed(4)}.`,
    },
  ];
  const weakestArea = [
    { key: "pace", score: paceAlignment },
    { key: "steadiness", score: stabilityScore },
    { key: "backward eye jumps", score: regressionScore },
    { key: "fixation timing", score: fixationScore },
  ].sort((a, b) => a.score - b.score)[0];
  const interpretation = eyeOverallScore >= 80
    ? "The reading eye pattern looks steady and organized for this activity."
    : eyeOverallScore >= 65
      ? "The reading pattern is usable, but it shows some strain or inconsistency."
      : "The reading pattern suggests the user may need slower paced reading support and more guided practice.";
  const nextStep = weakestArea.key === "pace"
    ? "Repeat the same passage at a slower, more even pace and compare the result."
    : weakestArea.key === "steadiness"
      ? "Use a shorter line or sentence and try to keep the eyes centered before moving on."
      : weakestArea.key === "backward eye jumps"
        ? "Try a simpler passage and encourage left-to-right tracking before increasing difficulty."
        : "Use shorter practice items and pause briefly between lines to improve focus timing.";

  setNodeText("eyeOverallScore", `${eyeOverallScore.toFixed(1)}%`);
  setNodeText("eyeOverallStatus", eyeStatus, eyeStatusClass);
  renderEyeChecklist(checklistItems);
  renderEyeRecommendation({
    statusText: `${eyeStatus} for the ${preset.label.toLowerCase()} preset.`,
    interpretation,
    nextStep,
  });

  document.getElementById("eyeResult").innerHTML = `
    <p><strong>File Check:</strong> ${data.length} usable gaze points across ${sessionSec.toFixed(2)} seconds</p>
    <p><strong>Uploaded File:</strong> ${fileName}</p>
    <p><strong>Reading Speed:</strong> ${wpm.toFixed(2)} words per minute</p>
    <p><strong>Backward Eye Jumps:</strong> ${regressions}</p>
    <p><strong>Gaze Steadiness:</strong> ${stabilityScore.toFixed(1)}%</p>
    <p><strong>Focus Time Per Point:</strong> ${fixationDuration.toFixed(2)} ms</p>
    <p><strong>Speed Match:</strong> ${paceAlignment.toFixed(1)}%</p>
    <p><strong>Backward Jump Control:</strong> ${regressionScore.toFixed(1)}%</p>
    <p><strong>Pattern Spread:</strong> ${dispersion.toFixed(4)}</p>
    <p><strong>Eye Movement Distance:</strong> ${scanpath.toFixed(4)}</p>
    <p><strong>Average Eye Movement Speed:</strong> ${meanSaccadeVelocity.toFixed(4)}</p>
    <p><strong>Estimated Focus Groups:</strong> ${fixationClusters}</p>
    <p><strong>Preset Used:</strong> ${preset.label}</p>
    <p><strong>Simple Summary:</strong> ${eyeStatus}.</p>
    <p><strong>Interpretation:</strong> This result is based on reading pace, backward eye jumps, fixation timing, and gaze steadiness from the uploaded file.</p>
  `;

  eyeChart = drawChart(eyeChart, "eyeChart", {
    type: "bar",
    data: {
      labels: ["Pace", "Stability", "Regression", "Fixation"],
      datasets: [{ label: "Eye Tracking Sub-score", data: [paceAlignment, stabilityScore, regressionScore, fixationScore], backgroundColor: ["#2563eb", "#10b981", "#f59e0b", "#8b5cf6"] }],
    },
    options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, max: 100 } } },
  });

  saveRecord({
    type: "eye_tracking",
    preset: preset.label,
    fixationDuration,
    regressions,
    wpm,
    dispersion,
    scanpath,
    meanSaccadeVelocity,
    sessionSec,
    fixationClusters,
    paceAlignment,
    stabilityScore,
    regressionScore,
    fixationScore,
    eyeOverallScore,
    eyeStatus,
  });
  latestEye = { fixationDuration, regressions, wpm, dispersion, scanpath, eyeOverallScore, eyeStatus, stabilityScore, regressionScore };
  markReportSourceChanged("Visual Focus Test");
  updateTestLabStatus();
  return true;
}

document.getElementById("runEye").addEventListener("click", analyzeEyeTrackingNow);

document.getElementById("downloadEyeTemplate")?.addEventListener("click", () => {
  const csv = buildEyeDemoCsv();
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "eye_tracking_template.csv";
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById("startEyeLiveCheck")?.addEventListener("click", startEyeLiveCheck);
document.getElementById("resetEyeLiveCheck")?.addEventListener("click", () => {
  resetEyeLiveCheck(false);
  latestEyeTrace = null;
  latestEyeTraceLabel = "";
  setEyeUploadStatus("Live tracking has been reset. You can start again or upload a CSV.", "small text-muted mt-2 mb-0");
  renderEyeTraceQuickStats(null);
  resetEyeOutputs(getEyeAnalysisCopy().startOrUpload);
});
document.getElementById("eyeLiveTrackArea")?.addEventListener("pointermove", (event) => {
  captureEyeLivePoint(event.clientX, event.clientY);
});
document.getElementById("eyeLiveTrackArea")?.addEventListener("pointerleave", hideEyeLiveCursor);
document.getElementById("eyeLiveTrackArea")?.addEventListener("touchmove", (event) => {
  if (!eyeLiveTraceState.active) return;
  const touch = event.touches?.[0];
  if (!touch) return;
  captureEyeLivePoint(touch.clientX, touch.clientY);
}, { passive: true });

document.getElementById("loadEyeDemo")?.addEventListener("click", async () => {
  const parsed = parseEyeTraceCsv(buildEyeDemoCsv());
  if (parsed.error) {
    setEyeUploadStatus(parsed.error, "small text-danger mt-2 mb-0");
    resetEyeOutputs(parsed.error);
    return;
  }
  latestEyeTrace = parsed;
  latestEyeTraceLabel = "Built-in demo sample";
  setEyeUploadStatus(`Loaded the built-in demo sample. ${parsed.data.length} usable gaze points are ready for analysis.`, "small text-success mt-2 mb-0");
  renderEyeTraceQuickStats(parsed);
  resetEyeOutputs(getEyeAnalysisCopy().demoLoaded);
  await analyzeEyeTrackingNow();
});

document.getElementById("traceFile")?.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) {
    latestEyeTrace = null;
    latestEyeTraceLabel = "";
    setEyeUploadStatus("No CSV file uploaded. You can still run the live on-screen eye-tracking check.");
    renderEyeTraceQuickStats(null);
    resetEyeOutputs(getEyeAnalysisCopy().importFirst);
    return;
  }
  const text = await file.text();
  const parsed = parseEyeTraceCsv(text);
  if (parsed.error) {
    latestEyeTrace = null;
    latestEyeTraceLabel = "";
    setEyeUploadStatus(parsed.error, "small text-danger mt-2 mb-0");
    renderEyeTraceQuickStats(null);
    resetEyeOutputs(parsed.error);
    return;
  }
  latestEyeTrace = parsed;
  latestEyeTraceLabel = file.name;
  setEyeUploadStatus(`Loaded ${file.name}. ${parsed.data.length} usable gaze points are ready for analysis.`, "small text-success mt-2 mb-0");
  renderEyeTraceQuickStats(parsed);
  resetEyeOutputs(getEyeAnalysisCopy().fileLoaded);
  await analyzeEyeTrackingNow();
});

document.getElementById("runBiomarkers").addEventListener("click", async () => {
  const file = document.getElementById("manifestFile").files[0];
  const labelColumn = document.getElementById("labelColumn").value.trim() || "label";
  const topN = clamp(n("biomarkerTopN"), 3, 20);
  const minImportance = clamp(Number(document.getElementById("biomarkerMinImportance")?.value || 0.1), 0, 1);
  const selectedFamily = document.getElementById("biomarkerFamily")?.value || "all";
  const summaryNode = document.getElementById("biomarkerSummary");
  const tableNode = document.getElementById("biomarkerTable");
  if (!file) {
    resetBiomarkerView(bengali ? "প্রথমে একটি ডেটাসেট CSV ফাইল আপলোড করুন।" : "Please upload a dataset CSV file first.");
    return;
  }
  let extractedText = "";
  try {
    extractedText = await readBiomarkerUpload(file);
  } catch (error) {
    resetBiomarkerView(error instanceof Error ? error.message : (bengali ? "ফাইলটি পড়া যায়নি।" : "The file could not be read."));
    return;
  }
  const parsedTable = parseTabularText(extractedText);
  if (parsedTable.error) {
    resetBiomarkerView(bengali ? "আপলোড করা ফাইলটি সঠিকভাবে পড়া যায়নি। অনুগ্রহ করে শিরোনামসহ স্পষ্ট টেবিল ব্যবহার করুন।" : parsedTable.error);
    return;
  }
  const header = parsedTable.header;
  const labelIdx = header.indexOf(labelColumn);
  if (labelIdx < 0) {
    resetBiomarkerView(bengali
      ? `লেবেল কলাম "${labelColumn}" খুঁজে পাওয়া যায়নি। আপলোড প্যানেলে দেখানো প্রস্তাবিত নামগুলোর একটি দিন।`
      : `The label column "${labelColumn}" was not found. Try one of the suggested label names from the upload panel.`);
    return;
  }

  const numericCols = header
    .map((name, idx) => ({ name, idx }))
    .filter(({ idx }) => idx !== labelIdx)
    .filter(({ name }) => /^((sp|rd|hw|eye)_|.*errors|.*count|.*time|.*rate|.*speed|.*dispersion|.*gaze|.*fix)/i.test(name));
  if (!numericCols.length) {
    resetBiomarkerView(bengali
      ? "কোনো সমর্থিত সংখ্যাসূচক বায়োমার্কার কলাম পাওয়া যায়নি। পড়ার গতি, ত্রুটি সংখ্যা, সময়ের মান, gaze মান, বা অন্য পরিমাপযোগ্য ফিচার যোগ করুন।"
      : "No supported numeric biomarker columns were detected. Add columns such as reading speed, error counts, timing values, gaze values, or other measurable features.");
    return;
  }
  const samples = parsedTable.rows.map((cells) => header.map((_, idx) => cells[idx] ?? ""));
  if (samples.length < 2) {
    resetBiomarkerView(bengali ? "বায়োমার্কার বিশ্লেষণের জন্য অন্তত দুটি ডেটা সারি দরকার।" : "At least two data rows are needed for biomarker analysis.");
    return;
  }
  const labels = samples.map((row) => Number(row[labelIdx])).map((v) => (Number.isFinite(v) ? v : 0));
  const meanLabel = labels.reduce((a, b) => a + b, 0) / Math.max(1, labels.length);
  const varLabel = labels.reduce((a, b) => a + ((b - meanLabel) ** 2), 0) / Math.max(1, labels.length);
  if (varLabel === 0) {
    resetBiomarkerView(bengali
      ? `লেবেল কলাম "${labelColumn}"-এ শুধু একটি মান আছে। অন্তত দুই ধরনের ক্লাস বা ঝুঁকি স্তর আছে এমন কলাম ব্যবহার করুন।`
      : `The label column "${labelColumn}" contains only one value. Please use a label column with at least two different classes or risk levels.`);
    return;
  }
  const stdLabel = Math.sqrt(varLabel) || 1;

  const results = numericCols.map(({ name, idx }) => {
    const values = samples.map((row) => Number(row[idx])).map((v) => (Number.isFinite(v) ? v : 0));
    const meanX = values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
    const varX = values.reduce((a, b) => a + ((b - meanX) ** 2), 0) / Math.max(1, values.length);
    const stdX = Math.sqrt(varX) || 1;
    let cov = 0;
    for (let i = 0; i < values.length; i += 1) cov += (values[i] - meanX) * (labels[i] - meanLabel);
    cov /= Math.max(1, values.length);
    const corr = cov / (stdX * stdLabel);
    const importance = Math.abs(corr);
    const family = classifyBiomarkerFamily(name);
    return { biomarker: name, family, correlation: corr, importance, interpretation: biomarkerInterpretation({ correlation: corr, importance }) };
  }).sort((a, b) => b.importance - a.importance);

  const familyFiltered = selectedFamily === "all"
    ? results
    : results.filter((row) => row.family.toLowerCase().replace(/\s+/g, "_") === selectedFamily || row.family.toLowerCase() === selectedFamily.toLowerCase());
  const filtered = familyFiltered.filter((row) => row.importance >= minImportance);
  const top = filtered.slice(0, topN);
  const strongest = top[0];
  setBiomarkerMetric("biomarkerSamplesMetric", String(samples.length));
  setBiomarkerMetric("biomarkerEvaluatedMetric", String(results.length));
  setBiomarkerMetric("biomarkerShownMetric", String(top.length));
  setBiomarkerMetric("biomarkerStrongestMetric", strongest ? strongest.biomarker : (bengali ? "কোনোটিই নয়" : "None"));
  summaryNode.innerHTML = bengali
    ? `
      <p><strong>এর মানে কী:</strong> এই ড্যাশবোর্ডটি ${samples.length}টি নমুনাজুড়ে ${results.length}টি পরিমাপযোগ্য ফিচার পরীক্ষা করেছে এবং আপনার ফিল্টারের পরে সবচেয়ে শক্তিশালী ${top.length}টি সিগন্যাল রেখেছে।</p>
      <p><strong>সবচেয়ে শক্তিশালী সিগন্যাল:</strong> ${strongest ? `${strongest.biomarker} (${strongest.family} পরিবার থেকে)` : "বর্তমান ফিল্টারে কোনো বায়োমার্কার উত্তীর্ণ হয়নি"}</p>
      <p><strong>সহজ ভাষার নোট:</strong> বেশি গুরুত্বের বায়োমার্কারগুলো এই ডেটাসেটে নির্বাচিত ঝুঁকি লেবেলের সঙ্গে বেশি শক্তভাবে যুক্ত। এতে কোন ফিচার গ্রুপ সবচেয়ে গুরুত্বপূর্ণ তা সহজে বোঝা যায়।</p>
    `
    : `
      <p><strong>What this means:</strong> The dashboard checked ${results.length} measurable features across ${samples.length} samples and kept the strongest ${top.length} signals after your filters.</p>
      <p><strong>Strongest signal:</strong> ${strongest ? `${strongest.biomarker} from the ${strongest.family} family` : "No biomarker passed the current filter"}</p>
      <p><strong>Plain-language note:</strong> Biomarkers with higher importance are more strongly linked with the selected risk label in this dataset. This helps you see which feature groups matter most in the uploaded file.</p>
    `;
  tableNode.innerHTML = top.length
    ? top.map((row) => `<tr><td>${row.biomarker}</td><td>${row.family}</td><td>${row.correlation.toFixed(4)}</td><td>${row.importance.toFixed(4)}</td><td>${row.interpretation}</td></tr>`).join("")
    : `<tr><td colspan="5" class="text-muted">${bengali ? "কোনো বায়োমার্কার বর্তমান ফিল্টারে উত্তীর্ণ হয়নি।" : "No biomarkers passed the current filters."}</td></tr>`;

  biomarkerChart = drawChart(biomarkerChart, "biomarkerChart", {
    type: "bar",
    data: {
      labels: top.map((x) => x.biomarker),
      datasets: [{ label: bengali ? "গুরুত্ব" : "Importance", data: top.map((x) => x.importance), backgroundColor: "#0891b2" }],
    },
    options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, max: 1 } } },
  });

  saveRecord({ type: "biomarkers", analyzed_samples: samples.length, total_biomarkers: results.length, selectedFamily, minImportance, topN, biomarkers: top });
});

document.getElementById("manifestFile")?.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) {
    updateBiomarkerFileInfo(null);
    resetBiomarkerView();
    return;
  }
  try {
    const extractedText = await readBiomarkerUpload(file);
    const parsedTable = parseTabularText(extractedText);
    if (parsedTable.error) {
      updateBiomarkerFileInfo(file, [], 0);
      resetBiomarkerView(bengali ? "আপলোড করা ফাইলটি সঠিকভাবে পড়া যায়নি। অনুগ্রহ করে শিরোনামসহ স্পষ্ট টেবিল ব্যবহার করুন।" : parsedTable.error);
      return;
    }
    updateBiomarkerFileInfo(file, parsedTable.header, parsedTable.rows.length);
    resetBiomarkerView(bengali ? "ডেটাসেট লোড হয়েছে। সনাক্ত হওয়া লেবেল সাজেশন দেখে তারপর বায়োমার্কার বিশ্লেষণ করুন চাপুন।" : "Dataset loaded. Review the detected label suggestion, then click Analyze Biomarkers.");
  } catch (error) {
    updateBiomarkerFileInfo(file, [], 0);
    resetBiomarkerView(error instanceof Error ? error.message : (bengali ? "ফাইলটি পড়া যায়নি।" : "The file could not be read."));
  }
});

document.getElementById("resetBiomarkers")?.addEventListener("click", () => {
  const fileInput = document.getElementById("manifestFile");
  const labelInput = document.getElementById("labelColumn");
  const familySelect = document.getElementById("biomarkerFamily");
  const topNInput = document.getElementById("biomarkerTopN");
  const minImportanceInput = document.getElementById("biomarkerMinImportance");
  if (fileInput) fileInput.value = "";
  if (labelInput) labelInput.value = "label";
  if (familySelect) familySelect.value = "all";
  if (topNInput) topNInput.value = "10";
  if (minImportanceInput) minImportanceInput.value = "0.10";
  updateBiomarkerFileInfo(null);
  resetBiomarkerView();
});

document.getElementById("exportJson").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(loadRecords(), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "learning_disorder_records.json";
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById("clearRecords").addEventListener("click", () => {
  localStorage.removeItem(storeKey);
  renderRecords();
});

document.getElementById("recordTypeFilter")?.addEventListener("change", renderRecords);
document.getElementById("recordSearch")?.addEventListener("input", renderRecords);

renderRecords();

function updateTestLabStatus() {
  const sources = hydrateLatestComparisonSources();
  const screeningReady = !!sources.screening;
  const therapyReady = !!sources.therapy;
  const eyeReady = !!sources.eye;
  const { screeningDone, therapyDone, eyeDone, ready } = {
    screeningDone: screeningReady,
    therapyDone: therapyReady,
    eyeDone: eyeReady,
    ready: screeningReady && therapyReady && eyeReady,
  };
  const node = document.getElementById("testStatus");
  if (!node) return;
  const bengali = isBengaliUi();
  const screeningSummary = screeningDone
    ? `${sources.screening.label} (${(sources.screening.confidence * 100).toFixed(1)}%)`
    : (bengali ? "চালানো হয়নি" : "Not run");
  const therapySummary = therapyDone ? `${sources.therapy.sessionBand} (${(sources.therapy.overallScorePct || sources.therapy.score * 100).toFixed(1)}%)` : (bengali ? "অপেক্ষমাণ" : "Pending");
  const eyeSummary = eyeDone ? `${localizeEyeStatusSummary(sources.eye.eyeStatus, bengali ? "Bengali" : "English") || (bengali ? "সম্পন্ন" : "Done")} (${(sources.eye.eyeOverallScore || 0).toFixed(1)}%)` : (bengali ? "অপেক্ষমাণ" : "Pending");
  const comparisonReady = ready;
  const comparisonStatusText = isComparisonCurrent()
    ? (bengali ? "হালনাগাদ" : "Current")
    : (ready ? (bengali ? "তৈরির জন্য প্রস্তুত" : "Ready to run") : (bengali ? "চালাতে/হালনাগাদ করতে হবে" : "Needs run/update"));
  const consensusLevelLabel = document.getElementById("labConsensusLevelLabel");
  if (consensusLevelLabel) consensusLevelLabel.textContent = bengali ? "সম্মতির স্তর:" : "Consensus Level:";
  const averageRiskLabel = document.getElementById("labAverageRiskLabel");
  if (averageRiskLabel) averageRiskLabel.textContent = bengali ? "গড় ঝুঁকি:" : "Average Risk:";
  const mostCautiousLabel = document.getElementById("labMostCautiousLabel");
  if (mostCautiousLabel) mostCautiousLabel.textContent = bengali ? "সবচেয়ে সাবধানী মডেল:" : "Most Cautious Model:";
  const mostConfidentLabel = document.getElementById("labMostConfidentLabel");
  if (mostConfidentLabel) mostConfidentLabel.textContent = bengali ? "সবচেয়ে আত্মবিশ্বাসী মডেল:" : "Most Confident Model:";
  const decisionStabilityLabel = document.getElementById("labDecisionStabilityLabel");
  if (decisionStabilityLabel) decisionStabilityLabel.textContent = bengali ? "সিদ্ধান্তের স্থায়িত্ব:" : "Decision Stability:";
  const readinessStatusLabel = document.getElementById("labReadinessStatusLabel");
  if (readinessStatusLabel) readinessStatusLabel.textContent = bengali ? "প্রস্তুতি:" : "Readiness:";
  node.innerHTML = `
    <p><strong>${bengali ? "চেকলিস্ট" : "Checklist"}</strong></p>
    <p>${bengali ? "স্ক্রিনিং" : "Screening"}: ${screeningSummary}</p>
    <p>${bengali ? "স্পিচ থেরাপি" : "Speech Therapy"}: ${therapySummary}</p>
    <p>${bengali ? "ভিজ্যুয়াল ফোকাস টেস্ট" : "Visual Focus Test"}: ${eyeSummary}</p>
    <p><strong>${bengali ? "মডেল তুলনার জন্য প্রস্তুত:" : "Ready for model comparison:"}</strong> <span class="${ready ? "text-success" : "text-danger"} fw-semibold">${ready ? (bengali ? "হ্যাঁ" : "Yes") : (bengali ? "না" : "No")}</span></p>
    <p><strong>${bengali ? "তুলনার অবস্থা:" : "Comparison Status:"}</strong> <span class="${comparisonReady ? "text-success" : "text-secondary"} fw-semibold">${comparisonStatusText}</span></p>
  `;
}

async function fetchComparisonFromBackend(sources) {
  const response = await fetch(apiUrl("/api/comparison"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...sources,
      language: isBengaliUi() ? "Bengali" : "English",
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Comparison failed");
  }
  return data;
}

async function fetchFinalReportFromBackend(sources, studentInfo) {
  const response = await fetch(apiUrl("/api/final-report"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      studentInfo,
      screening: sources.screening,
      therapy: sources.therapy,
      eye: sources.eye,
      biomarkers: null,
      language: isBengaliUi() ? "Bengali" : "English",
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Final report failed");
  }
  return data;
}

async function runModelComparison() {
  const copy = getReportFlowCopy();
  const sources = normalizeComparisonSources();
  const hydratedSources = hydrateLatestComparisonSources();
  if (!hydratedSources.therapy || !hydratedSources.eye) {
    renderFinalReportPanel(null, copy.compareFirst);
    setDownloadReportEnabled(false);
    updateTestLabStatus();
    return false;
  }
  let comparison;
  try {
    comparison = await fetchComparisonFromBackend(hydratedSources);
  } catch (error) {
    console.warn("Backend comparison unavailable.", error);
    comparison = buildLocalComparison(hydratedSources);
  }
  const { predictions, averageRisk, consensusLevel, mostCautious, mostConfident, stabilitySpread, localizedDecisionStability, localizedReadinessStatus, decisionStability } = comparison;

  const table = document.getElementById("modelCompareTable");
  table.innerHTML = predictions
    .map((p) => {
      const note = p.risk >= 0.66
        ? "Flags high support need."
        : p.risk >= 0.33
          ? "Suggests guided intervention."
          : "Leans toward mild support need.";
      return `<tr><td>${p.modelName}</td><td>${p.level}</td><td>${(p.confidence * 100).toFixed(1)}%</td><td>${p.risk.toFixed(3)}</td><td>${note}</td></tr>`;
    })
    .join("");

  setNodeText("labConsensusLevel", consensusLevel);
  setNodeText("labAverageRisk", averageRisk.toFixed(3));
  setNodeText("labMostCautious", `${mostCautious.modelName} (${mostCautious.level})`);
  setNodeText("labMostConfident", `${mostConfident.modelName} (${(mostConfident.confidence * 100).toFixed(1)}%)`);
  setNodeText("labDecisionStability", localizedDecisionStability, stabilitySpread < 0.16 ? "text-success fw-semibold" : "text-warning fw-semibold");
  setNodeText("labReadinessStatus", localizedReadinessStatus, averageRisk < 0.66 ? "text-success fw-semibold" : "text-danger fw-semibold");

  modelCompareChart = drawChart(modelCompareChart, "modelCompareChart", {
    type: "bar",
    data: {
      labels: predictions.map((p) => p.modelName),
      datasets: [{ label: "Risk Score", data: predictions.map((p) => p.risk), backgroundColor: "#0d6efd" }],
    },
    options: { responsive: true, maintainAspectRatio: false, scales: { y: { min: 0, max: 1 } } },
  });

  window.__latestModelPredictions = predictions;
  window.__latestConsensus = { consensusLevel, averageRisk, decisionStability, mostCautious, mostConfident };
  window.__latestComparisonVersion = reportSourceVersion;
  window.__latestFinalReport = null;
  saveRecord({
    type: "model_selection",
    source: "testlab",
    selectedModel: mostConfident.modelName,
    selectedLevel: mostConfident.level,
    selectedConfidence: mostConfident.confidence,
    consensusLevel,
    averageRisk,
    decisionStability,
    stabilitySpread,
    predictions,
    comparisonVersion: reportSourceVersion,
  });
  setDownloadReportEnabled(false);
  renderFinalReportPanel(null, copy.comparisonDone(consensusLevel));
  renderModelStatisticsPage();
  updateTestLabStatus();
  return true;
}

async function generateFinalReport() {
  const copy = getReportFlowCopy();
  const hydratedSources = hydrateLatestComparisonSources();
  if (!hydratedSources.therapy || !hydratedSources.eye) {
    renderFinalReportPanel(null, copy.compareFirst);
    setDownloadReportEnabled(false);
    updateTestLabStatus();
    return false;
  }
  let comparison = null;
  if (!isComparisonCurrent()) {
    try {
      comparison = await fetchComparisonFromBackend(hydratedSources);
    } catch (error) {
      console.warn("Backend comparison unavailable.", error);
      comparison = buildLocalComparison(hydratedSources);
    }
    window.__latestModelPredictions = comparison.predictions;
    window.__latestConsensus = {
      consensusLevel: comparison.consensusLevel,
      averageRisk: comparison.averageRisk,
      decisionStability: comparison.decisionStability,
      mostCautious: comparison.mostCautious,
      mostConfident: comparison.mostConfident,
    };
    window.__latestComparisonVersion = reportSourceVersion;
    renderFinalReportPanel(null, getReportFlowCopy().comparisonDone(comparison.consensusLevel));
    renderModelStatisticsPage();
  }
  const predictions = (comparison?.predictions || window.__latestModelPredictions || []);
  const { info: studentInfo, missing } = validateStudentReportInfo();
  if (missing.length) {
    renderFinalReportPanel(null, copy.completeFields(missing));
    setDownloadReportEnabled(false);
    document.getElementById("reportStudentCard")?.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  let reportData;
  try {
    reportData = await fetchFinalReportFromBackend(hydratedSources, studentInfo);
  } catch (error) {
    console.warn("Backend final report unavailable.", error);
    reportData = buildLocalFinalReport(hydratedSources, studentInfo, comparison || buildLocalComparison(hydratedSources));
  }

  reportData.comparisonVersion = reportSourceVersion;
  window.__latestFinalReport = reportData;
  window.__latestModelPredictions = reportData.predictions || [];
  window.__latestConsensus = reportData.consensus || null;
  renderFinalReportPanel(reportData);
  renderModelStatisticsPage();
  setDownloadReportEnabled(true);
  saveRecord({
    type: "final_report",
    finalLevel: reportData.finalLevel,
    avgRisk: reportData.avgRisk,
    severeVotes: reportData.severeVotes,
    moderateVotes: reportData.moderateVotes,
    predictions: reportData.predictions,
    studentInfo,
    generatedAt: reportData.generatedAt,
    comparisonVersion: reportSourceVersion,
  });
  updateTestLabStatus();
  return true;
}

document.getElementById("runComparison")?.addEventListener("click", () => {
  runModelComparison();
});

document.getElementById("generateFinal")?.addEventListener("click", () => {
  generateFinalReport();
});

document.getElementById("downloadFinalPdf")?.addEventListener("click", () => {
  const button = document.getElementById("downloadFinalPdf");
  const isReady = button?.dataset.ready === "true";
  if (!isReady) {
    const copy = getReportFlowCopy();
    renderFinalReportPanel(null, copy.generateFirst);
    document.getElementById("reportStudentCard")?.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  const report = window.__latestFinalReport;
  const copy = getReportFlowCopy();
  if (!report) {
    renderFinalReportPanel(null, copy.generateFirst);
    setDownloadReportEnabled(false);
    return;
  }
  if (report.comparisonVersion && report.comparisonVersion !== reportSourceVersion && !isComparisonCurrent()) {
    invalidateReportFlow(isBengaliUi()
      ? "রিপোর্ট প্রস্তুত হওয়ার পরে টেস্ট ফলাফল পরিবর্তিত হয়েছে। মডেল তুলনা আবার চালিয়ে রিপোর্ট পুনরায় তৈরি করুন।"
      : "Test results changed after the report was prepared. Run model comparison and generate the report again.");
    return;
  }
  const { info: currentStudentInfo, missing } = validateStudentReportInfo();
  if (missing.length) {
    renderFinalReportPanel(null, copy.completeFields(missing));
    setDownloadReportEnabled(false);
    document.getElementById("reportStudentCard")?.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  report.studentInfo = currentStudentInfo;
  if (!window.jspdf?.jsPDF) {
    renderFinalReportPanel(null, copy.pdfUnavailable);
    setDownloadReportEnabled(false);
    return;
  }
  const originalLabel = button?.textContent || "Download Report PDF";
  if (button) {
    button.disabled = true;
    button.textContent = isBengaliUi() ? "পিডিএফ প্রস্তুত হচ্ছে..." : "Downloading PDF...";
  }
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const bengali = isBengaliUi();
    const consensus = report.consensus || {};
    const screening = report.screening || null;
    const therapy = report.therapy || null;
    const visualFocus = report.visualFocus || null;
    const finalLevelText = report.finalLevel || "-";
    const localizedFinalLevel = bengali
      ? ({
          Severe: "গুরুতর",
          Moderate: "মাঝারি",
          Mild: "হালকা",
        }[finalLevelText] || finalLevelText)
      : finalLevelText;
    const localizedDecisionStability = bengali
      ? ({
          "High agreement": "উচ্চ সম্মতি",
          "Moderate agreement": "মাঝারি সম্মতি",
          "Low agreement": "কম সম্মতি",
        }[consensus.decisionStability || "-"] || (consensus.decisionStability || "-"))
      : (consensus.decisionStability || "-");
    const localizedRecommendation = bengali
      ? ({
          Severe: "উচ্চ অগ্রাধিকার হস্তক্ষেপ: তীব্র রিডিং, উচ্চারণ, এবং বানান পরিকল্পনা এবং বিশেষজ্ঞ পর্যালোচনা।",
          Moderate: "গঠিত হস্তক্ষেপ: সপ্তাহে ৪-৫ দিন নির্দেশিত অনুশীলন এবং অগ্রগতি ট্র্যাকিং।",
          Mild: "ভিত্তি সহায়তা: নিয়মিত নির্দেশিত অনুশীলন এবং পর্যায়ক্রমিক পুনর্মূল্যায়ন।",
        }[finalLevelText] || report.recommendation)
      : report.recommendation;
    const totalVotes = Array.isArray(report.predictions) ? report.predictions.length : 0;
    const severeVotes = Number(report.severeVotes || 0);
    const moderateVotes = Number(report.moderateVotes || 0);
    const mildVotes = Math.max(0, totalVotes - severeVotes - moderateVotes);
    const averageRisk = Number.isFinite(Number(report.avgRisk)) ? Number(report.avgRisk) : 0;
    const lines = [
      bengali ? "ডিসলেক্সিয়া সনাক্তকরণ চূড়ান্ত রিপোর্ট" : "Dyslexia Detection Final Report",
      "",
      `${bengali ? "শিক্ষার্থীর নাম" : "Student Name"}: ${report.studentInfo.name}`,
      `${bengali ? "বয়স" : "Age"}: ${report.studentInfo.age}`,
      `${bengali ? "শ্রেণি" : "Class"}: ${report.studentInfo.studentClass}`,
      `${bengali ? "রোল নং" : "Roll No"}: ${report.studentInfo.rollNo}`,
      `${bengali ? "সেকশন" : "Section"}: ${report.studentInfo.section}`,
      `${bengali ? "বিদ্যালয়ের নাম" : "School Name"}: ${report.studentInfo.schoolName}`,
      "",
      `${bengali ? "চূড়ান্ত সমন্বিত ফল" : "Final Aggregated Outcome"}: ${localizedFinalLevel}`,
      `${bengali ? "গড় ঝুঁকি স্কোর" : "Average Risk Score"}: ${averageRisk.toFixed(3)}`,
      `${bengali ? "মডেল সম্মতি" : "Model Agreement"}: ${bengali ? `তীব্র ভোট ${severeVotes}, মাঝারি ভোট ${moderateVotes}, মৃদু ভোট ${mildVotes}` : `Severe votes ${severeVotes}, Moderate votes ${moderateVotes}, Mild votes ${mildVotes}`}`,
      `${bengali ? "সিদ্ধান্তের স্থায়িত্ব" : "Decision Stability"}: ${localizedDecisionStability}`,
      `${bengali ? "সবচেয়ে সাবধানী মডেল" : "Most Cautious Model"}: ${consensus.mostCautious ? `${consensus.mostCautious.modelName} (${consensus.mostCautious.level})` : "-"}`,
      `${bengali ? "সবচেয়ে আত্মবিশ্বাসী মডেল" : "Most Confident Model"}: ${consensus.mostConfident ? `${consensus.mostConfident.modelName} (${consensus.mostConfident.level})` : "-"}`,
      "",
      `${bengali ? "স্ক্রিনিং সারাংশ" : "Screening Summary"}: ${screening ? `${screening.label || "-"} (${(Number(screening.confidence || 0) * 100).toFixed(1)}%)` : (bengali ? "চালানো হয়নি" : "Not run")}`,
      `${bengali ? "পড়ার ক্ষমতা" : "Reading ability"}: ${screening && screening.readingDecodingScore !== undefined ? `${Number(screening.readingDecodingScore).toFixed(1)}%` : "-"}`,
      `${bengali ? "ডিসলেক্সিয়া ঝুঁকি" : "Dyslexia risk"}: ${screening && screening.readingRisk !== undefined ? `${(Number(screening.readingRisk) * 100).toFixed(1)}%` : "-"}`,
      `${bengali ? "বক্তৃতা ফ্লুয়েন্সি" : "Speech fluency"}: ${screening && screening.speechFluencyScore !== undefined ? `${Number(screening.speechFluencyScore).toFixed(1)}%` : "-"}`,
      `${bengali ? "বক্তৃতা অনুসরণ প্রয়োজন" : "Speech follow-up needed"}: ${screening && screening.speechFluencyRisk !== undefined ? `${(Number(screening.speechFluencyRisk) * 100).toFixed(1)}%` : "-"}`,
      `${bengali ? "ডিকোডিং স্কোর" : "Decoding Score"}: ${screening && screening.readingDecodingScore !== undefined ? `${Number(screening.readingDecodingScore).toFixed(1)}%` : "-"}`,
      `${bengali ? "প্রধান উদ্বেগ" : "Primary Concern"}: ${screening ? (screening.primaryConcern === "speech_fluency" ? (bengali ? "বক্তৃতা ফ্লুয়েন্সি" : "Speech fluency") : (bengali ? "পড়া/ডিকোডিং" : "Reading/decoding")) : "-"}`,
      `${bengali ? "স্পিচ থেরাপি সারাংশ" : "Speech Therapy Summary"}: ${therapy ? `${therapy.sessionBand || "-"} (${(therapy.overallScorePct || therapy.score * 100 || 0).toFixed(1)}%)` : "-"}`,
      `${bengali ? "ভিজ্যুয়াল ফোকাস সারাংশ" : "Visual Focus Summary"}: ${visualFocus ? `${localizeEyeStatusSummary(visualFocus.eyeStatus, bengali ? "Bengali" : "English")} (${(visualFocus.eyeOverallScore || 0).toFixed(1)}%)` : "-"}`,
      "",
      `${bengali ? "পরবর্তী করণীয়" : "Recommended Next Step"}: ${localizedRecommendation}`,
      `${bengali ? "তৈরির সময়" : "Generated At"}: ${new Date(report.generatedAt).toLocaleString()}`,
    ];
    doc.setFont("helvetica", "normal");
    doc.setFontSize(12);
    let y = 20;
    lines.forEach((line, index) => {
      const split = doc.splitTextToSize(line, 170);
      if (index === 0) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(16);
      } else {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(12);
      }
      doc.text(split, 20, y);
      y += split.length * (index === 0 ? 8 : 7);
      if (y > 270) {
        doc.addPage();
        y = 20;
      }
    });
    const safeName = String(report.studentInfo.name || "student").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "") || "student";
    try {
      doc.save(`${safeName}_final_report.pdf`);
    } catch (_saveError) {
      triggerPdfBlobDownload(doc, `${safeName}_final_report.pdf`);
    }
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  }
});

[
  "reportStudentName",
  "reportStudentAge",
  "reportStudentClass",
  "reportStudentRoll",
  "reportStudentSection",
  "reportSchoolName",
].forEach((id) => {
  document.getElementById(id)?.addEventListener("input", () => {
    const { missing } = validateStudentReportInfo();
    setDownloadReportEnabled(!!window.__latestFinalReport && !missing.length);
    if (window.__latestFinalReport) {
      window.__latestFinalReport.studentInfo = getStudentReportInfo();
      renderFinalReportPanel(window.__latestFinalReport);
      return;
    }
    renderFinalReportPanel();
  });
});

function setVisualFocusSessionStatus(message, className = "small text-muted mt-3 mb-0") {
  const node = document.getElementById("eyeSessionStatus");
  if (!node) return;
  node.textContent = message;
  node.className = className;
}

function getVisualFocusIdleCopy(language = getDashboardLanguage()) {
  const bengali = isBengaliUi(language);
  return {
    sessionStatus: bengali ? "এখনও কোনো পরীক্ষা সম্পন্ন হয়নি।" : "No test completed yet.",
    quickStats: bengali
      ? "পরীক্ষার পরে এখানে রাউন্ড সংখ্যা, প্রতিক্রিয়ার গতি, এবং প্রথম চেষ্টায় সাফল্য দেখাবে।"
      : "After a test, this area will show round count, response speed, and first-try success.",
    checklist: bengali
      ? "বিশ্লেষণের পরে এখানে গতি, নির্ভুলতা, নিয়ন্ত্রণ, এবং সামঞ্জস্যের সহজ চেক দেখাবে।"
      : "After analysis, this area will show simple checks for speed, accuracy, control, and consistency.",
    recommendation: bengali
      ? "পরীক্ষা বিশ্লেষণের পরে এখানে সহজ ভাষায় সুপারিশ দেখাবে।"
      : "A plain-language recommendation will appear here after the test is analyzed.",
    resultMessage: bengali
      ? "ফল তৈরি করতে ভিজ্যুয়াল ফোকাস টেস্ট শুরু করুন।"
      : "Start the visual focus test to generate a result.",
    inProgressMessage: bengali
      ? "পরীক্ষা চলছে। চূড়ান্ত রাউন্ড শেষ হলে ফলাফল স্বয়ংক্রিয়ভাবে দেখাবে।"
      : "Test in progress. Results will appear automatically when the final round ends.",
  };
}

function renderVisualFocusQuickStats(summary, language = getDashboardLanguage()) {
  const node = document.getElementById("eyeTraceQuickStats");
  if (!node) return;
  const bengali = isBengaliUi(language);
  if (!summary) {
    node.innerHTML = `<p class="mb-0 text-muted small">${getVisualFocusIdleCopy(language).quickStats}</p>`;
    return;
  }
  node.innerHTML = `
    <div class="row g-2 small">
      <div class="col-md-4"><strong>${bengali ? "রাউন্ড:" : "Rounds:"}</strong> ${summary.totalRounds}</div>
      <div class="col-md-4"><strong>${bengali ? "গড় প্রতিক্রিয়া:" : "Avg Response:"}</strong> ${summary.averageResponseMs.toFixed(0)} ms</div>
      <div class="col-md-4"><strong>${bengali ? "প্রতি মিনিটে আইটেম:" : "Items/Minute:"}</strong> ${summary.itemsPerMinute.toFixed(1)}</div>
      <div class="col-md-4"><strong>${bengali ? "প্রথম চেষ্টায় সঠিক:" : "First-Try Correct:"}</strong> ${summary.firstTryCorrectCount}/${summary.totalRounds}</div>
      <div class="col-md-4"><strong>${bengali ? "ভুল ট্যাপ:" : "Wrong Taps:"}</strong> ${summary.totalWrongClicks}</div>
      <div class="col-md-4"><strong>${bengali ? "মোট সময়:" : "Total Time:"}</strong> ${summary.sessionSec.toFixed(2)}s</div>
    </div>
  `;
}

function resetVisualFocusOutputs(message, language = getDashboardLanguage()) {
  const copy = getVisualFocusIdleCopy(language);
  const resultNode = document.getElementById("eyeResult");
  if (resultNode) resultNode.innerHTML = `<p>${message}</p>`;
  const checklistNode = document.getElementById("eyeChecklist");
  if (checklistNode) checklistNode.innerHTML = `<p class="mb-0 text-muted small">${copy.checklist}</p>`;
  const recommendationNode = document.getElementById("eyeRecommendation");
  if (recommendationNode) recommendationNode.innerHTML = `<p class="mb-0 text-muted">${copy.recommendation}</p>`;
  setNodeText("eyeOverallScore", "-");
  setNodeText("eyeOverallStatus", language === "Bengali" ? "অপেক্ষমাণ" : "Pending", "text-secondary fw-semibold");
  if (eyeChart) {
    eyeChart.destroy();
    eyeChart = null;
  }
}

function refreshVisualFocusIdleState(language = getDashboardLanguage(), message) {
  const copy = getVisualFocusIdleCopy(language);
  resetVisualFocusOutputs(message ?? copy.resultMessage, language);
  setVisualFocusSessionStatus(copy.sessionStatus);
  renderVisualFocusQuickStats(null, language);
}

function getVisualFocusPreset() {
  const presetKey = document.getElementById("eyePreset")?.value || "letters";
  return EYE_PRESETS[presetKey] || EYE_PRESETS.letters;
}

function applyVisualFocusPreset(presetKey) {
  const preset = EYE_PRESETS[presetKey] || EYE_PRESETS.letters;
  const hintNode = document.getElementById("eyePresetHint");
  if (hintNode) {
    hintNode.value = isBengaliUi()
      ? (presetKey === "letters"
        ? "২০ রাউন্ড জুড়ে বাংলা অক্ষর দ্রুত খুঁজুন, যাতে একটি নির্ভরযোগ্য শ্রেণিকক্ষ মনোযোগ যাচাই হয়।"
        : presetKey === "digits"
          ? "২০ রাউন্ড জুড়ে বাংলা সংখ্যা দ্রুত খুঁজুন, যাতে একটি নির্ভরযোগ্য গতি যাচাই হয়।"
          : "বাংলা অক্ষর এবং বাংলা সংখ্যা মিশিয়ে ২৪ রাউন্ডের আরও কঠিন সামঞ্জস্য পরীক্ষা।")
      : preset.description;
  }
  if (!eyeTestState.active) {
    const targetNode = document.getElementById("eyeTargetSymbol");
    if (targetNode) targetNode.textContent = "";
  }
}

function resetVisualFocusState() {
  const preset = getVisualFocusPreset();
  const presetKey = document.getElementById("eyePreset")?.value || "letters";
  eyeTestState = {
    active: false,
    roundIndex: 0,
    totalRounds: preset.totalRounds,
    roundTypes: presetKey === "mixed" ? buildVisualFocusRoundTypes(preset.totalRounds) : [],
    results: [],
    startedAt: 0,
    roundStartedAt: 0,
    target: "",
    choices: [],
    wrongClicks: 0,
    locked: false,
  };
}

function updateVisualFocusButtons() {
  const startBtn = document.getElementById("startEyeVisualTest");
  const resetBtn = document.getElementById("resetEyeVisualTest");
  if (startBtn) startBtn.disabled = eyeTestState.active;
  if (resetBtn) resetBtn.disabled = false;
}

function setVisualFocusPanelsActive(active) {
  document.querySelector(".eye-target-card")?.classList.toggle("active", active);
  document.querySelector(".eye-test-board")?.classList.toggle("active", active);
}

function getVisualFocusRoundPool(preset, roundIndex = eyeTestState.roundIndex, phase = "idle") {
  const presetKey = document.getElementById("eyePreset")?.value || "letters";
  const bengali = isBengaliUi();
  if (bengali && presetKey === "letters" && preset.bengaliSymbolPool?.length) {
    return preset.bengaliSymbolPool;
  }
  if (bengali && presetKey === "digits" && preset.bengaliDigitPool?.length) {
    return preset.bengaliDigitPool;
  }
  if (bengali && presetKey === "mixed" && preset.bengaliLetterPool?.length && preset.bengaliDigitPool?.length) {
    if (phase === "active") {
      const roundType = eyeTestState.roundTypes?.[roundIndex] || "letter";
      return roundType === "digit" ? preset.bengaliDigitPool : preset.bengaliLetterPool;
    }
    return preset.bengaliLetterPool;
  }
  if (presetKey === "mixed" && preset.letterPool && preset.digitPool) {
    if (phase === "active") {
      const roundType = eyeTestState.roundTypes?.[roundIndex] || "letter";
      return roundType === "digit" ? preset.digitPool : preset.letterPool;
    }
    return preset.letterPool;
  }
  return preset.symbolPool;
}

function buildVisualFocusRoundTypes(totalRounds) {
  const letterCount = Math.ceil(totalRounds / 2);
  const digitCount = Math.floor(totalRounds / 2);
  return shuffle([
    ...Array.from({ length: letterCount }, () => "letter"),
    ...Array.from({ length: digitCount }, () => "digit"),
  ]);
}

function renderVisualFocusGrid() {
  const node = document.getElementById("eyeChoiceGrid");
  if (!node) return;
  if (!eyeTestState.choices.length) {
    node.innerHTML = Array.from({ length: 9 }, () => `<button type="button" class="eye-choice-btn" disabled></button>`).join("");
    return;
  }
  node.innerHTML = eyeTestState.choices.map((choice) => `<button type="button" class="eye-choice-btn" data-eye-choice="${choice}">${choice}</button>`).join("");
}

function updateVisualFocusProgress() {
  const progressNode = document.getElementById("eyeTestProgress");
  if (!progressNode) return;
  progressNode.textContent = eyeTestState.active
    ? (isBengaliUi()
      ? `রাউন্ড ${eyeTestState.roundIndex + 1} / ${eyeTestState.totalRounds}`
      : `Round ${eyeTestState.roundIndex + 1} of ${eyeTestState.totalRounds}`)
    : (isBengaliUi() ? "শুরু করতে Start Test চাপুন।" : "Press Start Test to begin.");
}

function buildVisualFocusChoices(target, pool) {
  const distractors = shuffle(pool.filter((item) => item !== target)).slice(0, 8);
  return shuffle([target, ...distractors]);
}

function startVisualFocusRound() {
  const preset = getVisualFocusPreset();
  const pool = getVisualFocusRoundPool(preset, eyeTestState.roundIndex, "active");
  eyeTestState.target = pool[Math.floor(Math.random() * pool.length)];
  eyeTestState.choices = buildVisualFocusChoices(eyeTestState.target, pool);
  eyeTestState.roundStartedAt = performance.now();
  eyeTestState.wrongClicks = 0;
  eyeTestState.locked = false;
  const targetNode = document.getElementById("eyeTargetSymbol");
  if (targetNode) targetNode.textContent = eyeTestState.target;
  const statusNode = document.getElementById("eyeTestStatus");
  if (statusNode) statusNode.textContent = isBengaliUi()
    ? `উত্তর গ্রিডে ${eyeTestState.target} খুঁজে ট্যাপ করুন।`
    : `Find ${eyeTestState.target} and tap it in the answer grid.`;
  renderVisualFocusGrid();
  updateVisualFocusProgress();
}

function renderVisualFocusChecklist(items) {
  const node = document.getElementById("eyeChecklist");
  if (!node) return;
  node.innerHTML = `
    <div class="row g-2 small">
      ${items.map((item) => `
        <div class="col-md-6">
          <div><strong>${item.label}:</strong> <span class="${item.className}">${item.status}</span></div>
          <div class="text-muted">${item.detail}</div>
        </div>
      `).join("")}
    </div>
  `;
}

function renderVisualFocusRecommendation(summary) {
  const node = document.getElementById("eyeRecommendation");
  if (!node) return;
  const bengali = isBengaliUi();
  node.innerHTML = `
    <p><strong>${bengali ? "ব্যবহারকারীর সারাংশ" : "End-User Summary"}:</strong> ${summary.statusText}</p>
    <p><strong>${bengali ? "এর মানে কী" : "What this means"}:</strong> ${summary.interpretation}</p>
    <p class="mb-0"><strong>${bengali ? "পরবর্তী করণীয়" : "Recommended next step"}:</strong> ${summary.nextStep}</p>
  `;
}

function finishVisualFocusTest() {
  const preset = getVisualFocusPreset();
  eyeTestState.active = false;
  updateVisualFocusButtons();
  setVisualFocusPanelsActive(false);
  const results = eyeTestState.results;
  if (!results.length) {
    setVisualFocusSessionStatus(isBengaliUi() ? "কোনো ব্যবহারযোগ্য রাউন্ড রেকর্ড হয়নি।" : "No usable rounds were recorded.", "small text-warning mt-3 mb-0");
    resetVisualFocusOutputs(getVisualFocusIdleCopy().resultMessage);
    return false;
  }
  const totalRounds = results.length;
  const totalWrongClicks = results.reduce((sum, row) => sum + row.wrongClicks, 0);
  const firstTryCorrectCount = results.filter((row) => row.wrongClicks === 0).length;
  const responseTimes = results.map((row) => row.responseMs);
  const averageResponseMs = responseTimes.reduce((sum, value) => sum + value, 0) / totalRounds;
  const variance = responseTimes.reduce((sum, value) => sum + ((value - averageResponseMs) ** 2), 0) / totalRounds;
  const responseStdMs = Math.sqrt(variance);
  const consistencyValue = responseStdMs / Math.max(averageResponseMs, 1);
  const sessionSec = Math.max((performance.now() - eyeTestState.startedAt) / 1000, 1e-6);
  const itemsPerMinute = totalRounds / (sessionSec / 60);
  const accuracyScore = (firstTryCorrectCount / totalRounds) * 100;
  const speedScore = clamp(100 - (((averageResponseMs - preset.targetResponseMs) / preset.targetResponseMs) * 55), 0, 100);
  const controlScore = clamp(100 - ((totalWrongClicks / totalRounds) * 28), 0, 100);
  const consistencyScore = clamp(100 - (consistencyValue * 150), 0, 100);
  const eyeOverallScore = (accuracyScore * 0.35) + (speedScore * 0.25) + (controlScore * 0.20) + (consistencyScore * 0.20);
  const eyeStatus = eyeOverallScore >= 80
    ? (isBengaliUi() ? "দৃঢ় ভিজ্যুয়াল ফোকাস প্যাটার্ন" : "Strong visual focus pattern")
    : eyeOverallScore >= 65
      ? (isBengaliUi() ? "হালকা চাপসহ ব্যবহারযোগ্য ভিজ্যুয়াল ফোকাস" : "Usable visual focus with mild strain")
      : (isBengaliUi() ? "অতিরিক্ত ভিজ্যুয়াল সহায়তা দরকার" : "Needs extra visual support");
  const eyeStatusClass = eyeOverallScore >= 80 ? "text-success fw-semibold" : eyeOverallScore >= 65 ? "text-warning fw-semibold" : "text-danger fw-semibold";
  const checklistItems = [
    {
      label: isBengaliUi() ? "প্রথম চেষ্টার নির্ভুলতা" : "First-try accuracy",
      status: accuracyScore >= 85 ? (isBengaliUi() ? "দৃঢ়" : "Strong") : accuracyScore >= 65 ? (isBengaliUi() ? "মোটামুটি" : "Fair") : (isBengaliUi() ? "সহায়তা দরকার" : "Needs support"),
      className: accuracyScore >= 85 ? "text-success fw-semibold" : accuracyScore >= 65 ? "text-warning fw-semibold" : "text-danger fw-semibold",
      detail: isBengaliUi()
        ? `${totalRounds}টির মধ্যে ${firstTryCorrectCount}টি লক্ষ্য প্রথম ট্যাপে ঠিকভাবে বেছে নেওয়া হয়েছে।`
        : `${firstTryCorrectCount} of ${totalRounds} targets were chosen correctly on the first tap.`,
    },
    {
      label: isBengaliUi() ? "প্রতিক্রিয়ার গতি" : "Response speed",
      status: speedScore >= 80 ? (isBengaliUi() ? "লক্ষ্যে" : "On target") : speedScore >= 60 ? (isBengaliUi() ? "সামান্য ধীর" : "Slightly slow") : (isBengaliUi() ? "এই মোডের জন্য ধীর" : "Slow for this mode"),
      className: speedScore >= 80 ? "text-success fw-semibold" : speedScore >= 60 ? "text-warning fw-semibold" : "text-danger fw-semibold",
      detail: isBengaliUi()
        ? `গড় প্রতিক্রিয়া সময় ছিল ${averageResponseMs.toFixed(0)} ms। এই মোডের লক্ষ্য প্রায় ${preset.targetResponseMs} ms।`
        : `Average response time was ${averageResponseMs.toFixed(0)} ms. Target for this mode is about ${preset.targetResponseMs} ms.`,
    },
    {
      label: isBengaliUi() ? "ট্যাপ নিয়ন্ত্রণ" : "Tap control",
      status: totalWrongClicks <= Math.ceil(totalRounds / 3) ? (isBengaliUi() ? "নিয়ন্ত্রিত" : "Controlled") : (isBengaliUi() ? "অনেক বেশি অতিরিক্ত ট্যাপ" : "Too many extra taps"),
      className: totalWrongClicks <= Math.ceil(totalRounds / 3) ? "text-success fw-semibold" : "text-warning fw-semibold",
      detail: isBengaliUi()
        ? `${totalRounds} রাউন্ডে ${totalWrongClicks}টি ভুল ট্যাপ হয়েছে।`
        : `${totalWrongClicks} wrong taps were made across ${totalRounds} rounds.`,
    },
    {
      label: isBengaliUi() ? "সামঞ্জস্য" : "Consistency",
      status: consistencyScore >= 80 ? (isBengaliUi() ? "সামঞ্জস্যপূর্ণ" : "Consistent") : consistencyScore >= 60 ? (isBengaliUi() ? "কিছু তারতম্য" : "Some variation") : (isBengaliUi() ? "বড় তারতম্য" : "Large variation"),
      className: consistencyScore >= 80 ? "text-success fw-semibold" : consistencyScore >= 60 ? "text-warning fw-semibold" : "text-danger fw-semibold",
      detail: isBengaliUi()
        ? `প্রতিক্রিয়া-সময়ের তারতম্য স্কোর ${consistencyScore.toFixed(1)}%।`
        : `Response-time variation score is ${consistencyScore.toFixed(1)}%.`,
    },
  ];
  const weakestArea = [
    { key: "accuracy", score: accuracyScore },
    { key: "speed", score: speedScore },
    { key: "control", score: controlScore },
    { key: "consistency", score: consistencyScore },
  ].sort((a, b) => a.score - b.score)[0];
  const interpretation = eyeOverallScore >= 80
    ? (isBengaliUi() ? "ব্যবহারকারী ভিজ্যুয়ালি সংগঠিত ছিল এবং এই ছোট মিল খোঁজার কাজে ভালো নিয়ন্ত্রণ দেখিয়েছে।" : "The user stayed visually organized and responded with strong control in this short matching task.")
    : eyeOverallScore >= 65
      ? (isBengaliUi() ? "কাজটি সফলভাবে সম্পন্ন হয়েছে, তবে প্রতিক্রিয়ার ধরণে সামান্য ধীরগতি বা অসামঞ্জস্য দেখা গেছে।" : "The task was completed successfully, but the response pattern showed mild slowing or inconsistency.")
      : (isBengaliUi() ? "প্রতিক্রিয়ার ধরণ বলছে ছোট ভিজ্যুয়াল কাজ এবং আরও নির্দেশিত অনুশীলন উপকারী হতে পারে।" : "The response pattern suggests the user may benefit from shorter visual tasks and more guided practice.");
  const nextStep = weakestArea.key === "accuracy"
    ? (isBengaliUi() ? "কম বিভ্রান্তি রেখে একই মোড আবার করুন, এবং ট্যাপের আগে ভালোভাবে মিলিয়ে নিন।" : "Repeat the same mode with fewer distractors and encourage careful matching before tapping.")
    : weakestArea.key === "speed"
      ? (isBengaliUi() ? "প্রথমে একটি ছোট রাউন্ড করুন, তারপর এই মোডটি আবার করে আরও স্থির প্রতিক্রিয়া গতি রাখুন।" : "Try one shorter round first, then repeat this mode and aim for steadier response speed.")
      : weakestArea.key === "control"
        ? (isBengaliUi() ? "ট্যাপ করার আগে একটু থামতে বলুন, যাতে ব্যবহারকারী আগে লক্ষ্যটি নিশ্চিত করতে পারে।" : "Encourage a brief pause before tapping so the user confirms the target first.")
        : (isBengaliUi() ? "একটি ছোট বিরতির পরে কাজটি আবার করুন এবং আরও সমান প্রতিক্রিয়া গতি লক্ষ্য করুন।" : "Repeat the task after a short break and watch for a more even response pace.");

  setVisualFocusSessionStatus(isBengaliUi()
    ? `${preset.label} সম্পন্ন হয়েছে। ফলাফল ব্যাকগ্রাউন্ডে স্বয়ংক্রিয়ভাবে সংরক্ষিত হয়েছে।`
    : `Completed ${preset.label}. The result has been saved automatically in the background.`, "small text-success mt-3 mb-0");
  renderVisualFocusQuickStats({ totalRounds, averageResponseMs, itemsPerMinute, firstTryCorrectCount, totalWrongClicks, sessionSec });
  renderVisualFocusChecklist(checklistItems);
  renderVisualFocusRecommendation({
    statusText: isBengaliUi() ? `${preset.label} মোডে ${eyeStatus}.` : `${eyeStatus} in ${preset.label.toLowerCase()}.`,
    interpretation,
    nextStep,
  });
  setNodeText("eyeOverallScore", `${eyeOverallScore.toFixed(1)}%`);
  setNodeText("eyeOverallStatus", eyeStatus, eyeStatusClass);
  const resultNode = document.getElementById("eyeResult");
  if (resultNode) {
    resultNode.innerHTML = isBengaliUi()
      ? `
    <p><strong>পরীক্ষার ধরন:</strong> ${preset.label}</p>
      <p><strong>মোট রাউন্ড:</strong> ${totalRounds}</p>
      <p><strong>প্রতি মিনিটে আইটেম:</strong> ${itemsPerMinute.toFixed(1)}</p>
      <p><strong>গড় প্রতিক্রিয়া সময়:</strong> ${averageResponseMs.toFixed(0)} ms</p>
      <p><strong>ভুল ট্যাপ:</strong> ${totalWrongClicks}</p>
      <p><strong>প্রথম চেষ্টায় সঠিকতা:</strong> ${accuracyScore.toFixed(1)}%</p>
      <p><strong>সামঞ্জস্য স্কোর:</strong> ${consistencyScore.toFixed(1)}%</p>
      <p><strong>ট্যাপ নিয়ন্ত্রণ স্কোর:</strong> ${controlScore.toFixed(1)}%</p>
      <p><strong>গতি স্কোর:</strong> ${speedScore.toFixed(1)}%</p>
      <p><strong>সহজ সারাংশ:</strong> ${eyeStatus}.</p>
      <p><strong>ব্যাখ্যা:</strong> এই ফলাফল প্রথম চেষ্টায় সঠিকতা, প্রতিক্রিয়ার গতি, ভুল ট্যাপ, এবং প্রতিক্রিয়া-সামঞ্জস্যের ভিত্তিতে তৈরি।</p>
    `
      : `
    <p><strong>Test Mode:</strong> ${preset.label}</p>
      <p><strong>Rounds Completed:</strong> ${totalRounds}</p>
      <p><strong>Items Per Minute:</strong> ${itemsPerMinute.toFixed(1)}</p>
      <p><strong>Average Response Time:</strong> ${averageResponseMs.toFixed(0)} ms</p>
      <p><strong>Wrong Taps:</strong> ${totalWrongClicks}</p>
      <p><strong>First-Try Accuracy:</strong> ${accuracyScore.toFixed(1)}%</p>
      <p><strong>Consistency Score:</strong> ${consistencyScore.toFixed(1)}%</p>
      <p><strong>Tap Control Score:</strong> ${controlScore.toFixed(1)}%</p>
      <p><strong>Speed Score:</strong> ${speedScore.toFixed(1)}%</p>
      <p><strong>Simple Summary:</strong> ${eyeStatus}.</p>
      <p><strong>Interpretation:</strong> This result is based on first-try accuracy, response speed, wrong taps, and response consistency.</p>
    `;
  }
  eyeChart = drawChart(eyeChart, "eyeChart", {
    type: "bar",
    data: {
      labels: ["Accuracy", "Speed", "Control", "Consistency"],
      datasets: [{ label: "Visual Test Sub-score", data: [accuracyScore, speedScore, controlScore, consistencyScore], backgroundColor: ["#2563eb", "#10b981", "#f59e0b", "#8b5cf6"] }],
    },
    options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, max: 100 } } },
  });
  saveRecord({
    type: "eye_tracking",
    preset: preset.label,
    testMode: preset.label,
    fixationDuration: averageResponseMs,
    regressions: totalWrongClicks,
    wpm: itemsPerMinute,
    dispersion: consistencyValue,
    scanpath: totalWrongClicks + totalRounds,
    meanSaccadeVelocity: totalRounds / Math.max(sessionSec, 1e-6),
    sessionSec,
    fixationClusters: firstTryCorrectCount,
    paceAlignment: speedScore,
    stabilityScore: consistencyScore,
    regressionScore: controlScore,
    fixationScore: accuracyScore,
    eyeOverallScore,
    eyeStatus,
    totalRounds,
    averageResponseMs,
    totalWrongClicks,
    firstTryCorrectCount,
    consistencyValue,
  });
  latestEye = {
    fixationDuration: averageResponseMs,
    regressions: totalWrongClicks,
    wpm: itemsPerMinute,
    dispersion: consistencyValue,
    scanpath: totalWrongClicks + totalRounds,
    eyeOverallScore,
    eyeStatus,
    stabilityScore: consistencyScore,
    regressionScore: controlScore,
    fixationScore: accuracyScore,
    totalWrongClicks,
    consistencyValue,
  };
  updateTestLabStatus();
  return true;
}

function handleVisualFocusChoice(choice, button) {
  if (!eyeTestState.active || eyeTestState.locked) return;
  if (choice !== eyeTestState.target) {
    eyeTestState.wrongClicks += 1;
    if (button) {
      button.disabled = true;
      button.classList.add("wrong");
    }
    const statusNode = document.getElementById("eyeTestStatus");
    if (statusNode) statusNode.textContent = `${choice} is not the target. Try again.`;
    return;
  }
  eyeTestState.locked = true;
  const responseMs = performance.now() - eyeTestState.roundStartedAt;
  eyeTestState.results.push({
    target: eyeTestState.target,
    responseMs,
    wrongClicks: eyeTestState.wrongClicks,
  });
  if (button) button.classList.add("correct");
  const statusNode = document.getElementById("eyeTestStatus");
  if (statusNode) statusNode.textContent = "Correct. Loading the next round...";
  window.setTimeout(() => {
    eyeTestState.roundIndex += 1;
    if (eyeTestState.roundIndex >= eyeTestState.totalRounds) {
      finishVisualFocusTest();
      return;
    }
    startVisualFocusRound();
  }, 320);
}

function startVisualFocusTest() {
  resetVisualFocusState();
  eyeTestState.active = true;
  eyeTestState.startedAt = performance.now();
  updateVisualFocusButtons();
  setVisualFocusPanelsActive(true);
  setVisualFocusSessionStatus(isBengaliUi() ? "ভিজ্যুয়াল ফোকাস টেস্ট শুরু হয়েছে। শেষ রাউন্ডের পরে ফলাফল স্বয়ংক্রিয়ভাবে সংরক্ষিত হবে।" : "Visual focus test started. Results will be saved automatically after the last round.", "small text-primary mt-3 mb-0");
  resetVisualFocusOutputs(getVisualFocusIdleCopy().inProgressMessage);
  renderVisualFocusQuickStats(null);
  startVisualFocusRound();
}

function resetVisualFocusTest() {
  resetVisualFocusState();
  updateVisualFocusButtons();
  setVisualFocusPanelsActive(false);
  const targetNode = document.getElementById("eyeTargetSymbol");
  if (targetNode) targetNode.textContent = "";
  renderVisualFocusGrid();
  updateVisualFocusProgress();
  applyVisualFocusPreset(document.getElementById("eyePreset")?.value || "letters");
  const statusNode = document.getElementById("eyeTestStatus");
  if (statusNode) statusNode.textContent = isBengaliUi() ? "নতুন ভিজ্যুয়াল ফোকাস টেস্টের জন্য প্রস্তুত।" : "Ready for a new visual focus test.";
  refreshVisualFocusIdleState();
}

updateTestLabStatus();
async function initializeDashboard() {
  const language = document.getElementById("sampleLanguage")?.value || "English";
  const therapyLanguage = document.getElementById("therapyLanguage")?.value || "English";
  const therapySessionType = document.getElementById("therapyType")?.value || "Sound Drill";
  const eyePreset = document.getElementById("eyePreset")?.value || "letters";
  applyDashboardLanguage(language);
  const therapyLanguageNode = document.getElementById("therapyLanguage");
  if (therapyLanguageNode) therapyLanguageNode.value = language;
  await loadBengaliListeningSet();
  pickListeningParagraph(language);
  renderRandomSpellingWords(language);
  renderRandomReadingPrompt(language);
  renderTherapyTargetOptions(therapyLanguage, therapySessionType);
  applyVisualFocusPreset(eyePreset);
  updateTherapyPromptUI();
  setTherapyRoundStatus(isBengaliUi(language) ? "সিস্টেম প্রতিটি উচ্চারিত উত্তর শুনবে এবং নীচের থেরাপি মেট্রিক স্বয়ংক্রিয়ভাবে পূরণ করবে।" : "The system will listen to each spoken response and auto-fill the therapy metrics below.");
  const initTherapy = (id, value) => {
    const node = document.getElementById(id);
    if (node) node.value = value;
  };
  initTherapy("therapyDuration", "0.0");
  initTherapy("therapySuccess", "0");
  initTherapy("therapyTrials", "0");
  setNodeText("readingPassThreshold", `${READING_PASS_THRESHOLD}%`);
  setNodeText("audioPassThreshold", `${AUDIO_PASS_THRESHOLD}%`);
  setNodeText("spellingPassThreshold", `${SPELLING_PASS_THRESHOLD}%`);
  refreshVisualFocusIdleState(language);
  updateVisualFocusButtons();
  renderVisualFocusGrid();
  updateVisualFocusProgress();
  renderFinalReportPanel();
  renderModelStatisticsPage();
  setDownloadReportEnabled(false);
  updateSegmentScoreMatrix();
}
initializeDashboard();
renderSecurityBanner();

document.getElementById("eyeChoiceGrid")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-eye-choice]");
  if (!button) return;
  handleVisualFocusChoice(button.dataset.eyeChoice, button);
});
document.getElementById("startEyeVisualTest")?.addEventListener("click", startVisualFocusTest);
document.getElementById("resetEyeVisualTest")?.addEventListener("click", resetVisualFocusTest);
document.getElementById("eyePreset")?.addEventListener("change", (event) => {
  applyVisualFocusPreset(event.target.value);
  resetVisualFocusTest();
});
applyVisualFocusPreset(document.getElementById("eyePreset")?.value || "letters");
resetVisualFocusTest();

document.querySelectorAll(".user-guide-btn").forEach((button) => {
  button.addEventListener("click", () => openGuideModal(button.dataset.guide));
});
document.getElementById("closeGuideModal")?.addEventListener("click", closeGuideModal);
document.querySelector(".guide-modal-backdrop")?.addEventListener("click", closeGuideModal);
document.querySelectorAll("#modelstats .sortable-th").forEach((header) => {
  header.addEventListener("click", () => setModelStatsSort(header.dataset.sortKey));
});
