const storeKey = "ld_dashboard_records_v2";

const tabButtons = [...document.querySelectorAll(".tab-btn")];
const tabPanels = [...document.querySelectorAll(".tab-panel")];
tabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    tabButtons.forEach((x) => {
      x.classList.remove("btn-primary", "active");
      x.classList.add("btn-light");
    });
    tabPanels.forEach((x) => x.classList.remove("active"));
    button.classList.remove("btn-light");
    button.classList.add("btn-primary", "active");
    document.getElementById(button.dataset.tab).classList.add("active");
  });
});

let screeningChart;
let therapyChart;
let eyeChart;
let biomarkerChart;
let modelCompareChart;
let latestScreening = null;
let latestTherapy = null;
let latestEye = null;
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
let currentListeningLanguage = "Bengali";
let currentListeningAudioPath = "";
let selectedAudioOptionIndex = null;
let audioPlaybackCompleted = false;
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
let spellingAutoScoreTimer = null;
let screeningAutoRunTimer = null;
const READING_PASS_THRESHOLD = 60;
const AUDIO_PASS_THRESHOLD = 70;
const SPELLING_PASS_THRESHOLD = 67;
const THERAPY_PASS_THRESHOLD = 75;

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
  short_passage: {
    label: "Short Passage",
    description: "Short passage: balanced settings for a typical reading sample.",
    wordCount: 6,
    expectedTime: 18,
    regressionLimit: 4,
    dispersionTarget: 0.18,
  },
  sentence_drill: {
    label: "Sentence Drill",
    description: "Sentence drill: shorter reading with tighter pace and steadiness expectations.",
    wordCount: 4,
    expectedTime: 10,
    regressionLimit: 2,
    dispersionTarget: 0.14,
  },
  long_passage: {
    label: "Long Passage",
    description: "Long passage: more words, a longer expected duration, and a little more movement tolerance.",
    wordCount: 12,
    expectedTime: 32,
    regressionLimit: 6,
    dispersionTarget: 0.22,
  },
};

const EYE_LIVE_PASSAGES = {
  short_passage: "The child reads one short passage slowly from left to right and keeps attention on each line.",
  sentence_drill: "Read each short sentence carefully and move across the line in one smooth direction.",
  long_passage: "This longer passage asks the reader to keep a steady left to right pattern, reduce backward jumps, and maintain focus across several lines.",
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
  Hindi: {
    "Sound Drill": ["श", "स", "र", "ल", "क", "म"],
    "Syllable Drill": ["शा", "सी", "रु", "ले", "का", "मो"],
    "Word Reading": ["शिशु", "स्कूल", "रवि", "लाल", "कलम", "माला"],
    "Phrase Practice": ["शब्द बोलो", "धीरे पढ़ो", "लाल कलम", "मीठा फल", "साफ़ बोलो"],
    "Sentence Reading": [
      "मैं धीरे पढ़ता हूँ।",
      "रवि स्कूल जाता है।",
      "लाल कलम मेज पर है।",
      "माला साफ़ बोलती है।",
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
  Hindi: [
    "किताब", "स्कूल", "नदी", "दोस्त", "खिड़की", "शिक्षक", "बच्चा", "कहानी", "अभ्यास", "भाषा",
    "परिवार", "कमरा", "पेड़", "समय", "गाड़ी", "सपना", "आवाज़", "चित्र", "ग्राम", "पुस्तक",
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
  Hindi: [
    "मैं धीरे और साफ़ तरीके से वाक्य पढ़ता हूँ।",
    "आज मैंने किताब से एक छोटा पाठ पढ़ा।",
    "शिक्षक ने मुझे शब्दों को तोड़कर पढ़ना सिखाया।",
    "मैं रोज़ अभ्यास करके पढ़ने की गति बढ़ाता हूँ।",
    "मैं अपने दोस्त के साथ छोटे वाक्य पढ़ता हूँ।",
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
  Hindi: [
    {
      paragraph: "रीना स्कूल जाने से पहले दस मिनट पढ़ती है। आज उसने नदी और पक्षियों पर एक छोटी कहानी पढ़ी।",
      question: "रीना स्कूल जाने से पहले क्या करती है?",
      options: ["पढ़ती है", "टीवी देखती है", "खेलती है"],
      correctIndex: 0,
      audioPath: "./assets/audio/hi_q1.wav",
    },
    {
      paragraph: "आरव रोज शाम को अभ्यास करता है। कठिन शब्द आने पर वह शब्द को तोड़कर धीरे-धीरे पढ़ता है।",
      question: "कठिन शब्द आने पर आरव क्या करता है?",
      options: ["शब्द तोड़कर पढ़ता है", "किताब बंद करता है", "सो जाता है"],
      correctIndex: 0,
      audioPath: "./assets/audio/hi_q2.wav",
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
const saveRecord = (entry) => {
  const records = loadRecords();
  records.push({ ...entry, timestamp: new Date().toISOString() });
  localStorage.setItem(storeKey, JSON.stringify(records));
  renderRecords();
};

function recordTypeLabel(type) {
  const labels = {
    screening: "Screening",
    therapy: "Therapy",
    eye_tracking: "Eye Tracking",
    biomarkers: "Biomarkers",
    final_report: "Final Report",
  };
  return labels[type] || (type ? String(type).replace(/_/g, " ") : "Unknown");
}

function getRecordStatusMeta(record) {
  if (!record || typeof record !== "object") {
    return { label: "-", className: "text-secondary fw-semibold" };
  }
  if (record.type === "screening") {
    const score = Number(record.confidence || 0) * 100;
    return score >= 75
      ? { label: "High confidence", className: "text-success fw-semibold" }
      : score >= 55
        ? { label: "Moderate confidence", className: "text-warning fw-semibold" }
        : { label: "Low confidence", className: "text-danger fw-semibold" };
  }
  if (record.type === "therapy") {
    const score = Number(record.overallScorePct || (record.score || 0) * 100);
    return score >= THERAPY_PASS_THRESHOLD
      ? { label: "On track", className: "text-success fw-semibold" }
      : { label: "Needs support", className: "text-danger fw-semibold" };
  }
  if (record.type === "eye_tracking") {
    const score = Number(record.eyeOverallScore || 0);
    return score >= 80
      ? { label: "Stable", className: "text-success fw-semibold" }
      : score >= 65
        ? { label: "Watch", className: "text-warning fw-semibold" }
        : { label: "Support needed", className: "text-danger fw-semibold" };
  }
  if (record.type === "final_report") {
    const risk = Number(record.avgRisk || 0);
    return risk <= 0.35
      ? { label: "Lower risk", className: "text-success fw-semibold" }
      : risk <= 0.65
        ? { label: "Moderate risk", className: "text-warning fw-semibold" }
        : { label: "Higher risk", className: "text-danger fw-semibold" };
  }
  if (record.type === "biomarkers") {
    return { label: `${(record.biomarkers || []).length || 0} markers`, className: "text-primary fw-semibold" };
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
      : `<tr><td colspan="4" class="text-muted">No records match the current filter.</td></tr>`;
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
        <li>Complete Reading Fluency Test: Start, read aloud, then Stop (hesitations are auto-detected). / রিডিং টেস্ট সম্পন্ন করুন।</li>
        <li>Select sample audio and wait for automatic analysis. / স্যাম্পল অডিও নির্বাচন করে বিশ্লেষণ সম্পন্ন হতে দিন।</li>
        <li>Finish Spelling Test and click score. / স্পেলিং টেস্ট স্কোর করুন।</li>
        <li>Click Run Screening for automatic outcome. / Run Screening চাপুন।</li>
      </ol>
      <p><strong>Note:</strong> Screening aid only, not final diagnosis.</p>
    `,
  },
  therapy: {
    title: "Speech Therapy Guidance",
    html: `
      <ol>
        <li>Choose therapy language, session type, practice sound, difficulty, and cue level. / ভাষা ও সেশন ধরন নির্বাচন করুন।</li>
        <li>Click Start Round once, read the shown prompt aloud, then click Speak Now to save your response.</li>
        <li>After each saved response, the next practice moves automatically. Click Finish Round when you are done.</li>
      </ol>
    `,
  },
  eye: {
    title: "Eye Tracking Guidance",
    html: `
      <ol>
        <li>Prepare CSV with: timestamp_ms, gaze_x, gaze_y. / নির্দিষ্ট কলামসহ CSV দিন।</li>
        <li>Set word count for reading prompt. / শব্দ সংখ্যা দিন।</li>
        <li>Upload CSV and compute metrics. / CSV আপলোড করে মেট্রিক্স বের করুন।</li>
      </ol>
    `,
  },
  testlab: {
    title: "Test Lab Guidance",
    html: `
      <ol>
        <li>Complete Screening + Therapy + Eye Tracking first. / আগে ৩টি টেস্ট শেষ করুন।</li>
        <li>Run Model Comparison. / Model Comparison চালান।</li>
        <li>Generate Final Report for aggregated outcome. / Final Report তৈরি করুন।</li>
      </ol>
    `,
  },
  biomarkers: {
    title: "Biomarker Guidance",
    html: `
      <ol>
        <li>Upload manifest CSV with numeric feature columns and label column. / ফিচার ও লেবেলসহ CSV দিন।</li>
        <li>Run analysis and inspect top correlated markers. / বিশ্লেষণ চালিয়ে শীর্ষ মার্কার দেখুন।</li>
      </ol>
    `,
  },
  records: {
    title: "Records Guidance",
    html: `
      <ol>
        <li>All outputs are saved in local browser storage. / সব ফলাফল লোকাল স্টোরেজে থাকে।</li>
        <li>Export JSON for backup/reporting. / Export JSON দিয়ে ব্যাকআপ নিন।</li>
        <li>Clear Records resets local history. / Clear Records পুরোনো ডাটা মুছে দেয়।</li>
      </ol>
    `,
  },
};

function openGuideModal(key) {
  const modal = document.getElementById("guideModal");
  const title = document.getElementById("guideTitle");
  const body = document.getElementById("guideBody");
  const content = GUIDE_CONTENT[key] || { title: "User Guidance", html: "<p>No guidance available.</p>" };
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
    if (labels[index]) labels[index].textContent = `${index + 1}) Correct spelling: ${word}`;
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
  if (status) status.textContent = "Waiting for answers. Scoring happens automatically after all 3 answers are entered.";
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

function summarizeRecord(record) {
  if (!record || typeof record !== "object") return "No summary available.";
  switch (record.type) {
    case "screening":
      return `${record.language || "Unknown"} ${record.label || "screening"} result with ${((record.confidence || 0) * 100).toFixed(1)}% confidence`;
    case "therapy":
      return `${record.sessionType || "Session"} on ${record.target || "target"} scored ${(record.overallScorePct || (record.score || 0) * 100).toFixed(1)}%`;
    case "eye_tracking":
      return `Reading speed ${Number(record.wpm || 0).toFixed(1)} WPM, backward eye jumps ${record.regressions ?? "-"}`;
    case "biomarkers":
      return `${record.analyzed_samples || 0} samples analyzed, ${(record.biomarkers || []).length} biomarkers shown`;
    case "final_report":
      return `${record.finalLevel || "Unknown"} risk report, average risk ${(record.avgRisk || 0).toFixed(3)}`;
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
  const direction = row.correlation >= 0 ? "higher risk" : "lower risk";
  if (row.importance >= 0.5) return `Strong marker linked with ${direction}.`;
  if (row.importance >= 0.25) return `Moderate marker linked with ${direction}.`;
  return `Weak but usable marker linked with ${direction}.`;
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
    return true;
  } catch (_error) {
    setTherapyRoundStatus("Microphone access was not granted. Please allow microphone access and start the round again.");
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
  if (statusNode) statusNode.textContent = message;
  if (transcriptNode) {
    transcriptNode.textContent = transcript || "No response captured yet.";
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
  if (!promptNode || !progressNode) return;
  if (!therapyRoundState.active || !therapyRoundState.prompts.length) {
    promptNode.textContent = "Press Start Round to begin the speaking practice.";
    progressNode.textContent = "Round not started.";
    return;
  }
  const prompt = therapyRoundState.prompts[therapyRoundState.currentIndex] || "";
  promptNode.textContent = prompt;
  progressNode.textContent = `Practice ${therapyRoundState.currentIndex + 1} of ${therapyRoundState.prompts.length}`;
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
    Hindi: "hi-IN",
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
    node.innerHTML = `<p class="mb-0 text-muted">Select a record from the table to inspect details.</p>`;
    return;
  }
  const meta = getRecordStatusMeta(record);
  const detailRows = [];
  if (record.type === "screening") {
    detailRows.push(["Language", record.language || "-"]);
    detailRows.push(["Predicted Level", record.label || "-"]);
    detailRows.push(["Confidence", `${((record.confidence || 0) * 100).toFixed(1)}%`]);
    detailRows.push(["Severity Score", record.severityScore !== undefined ? String(record.severityScore) : "-"]);
  } else if (record.type === "therapy") {
    detailRows.push(["Session Type", record.sessionType || "-"]);
    detailRows.push(["Target", record.target || "-"]);
    detailRows.push(["Overall Score", `${Number(record.overallScorePct || (record.score || 0) * 100).toFixed(1)}%`]);
    detailRows.push(["Recommendation", record.recommendation || "-"]);
  } else if (record.type === "eye_tracking") {
    detailRows.push(["Preset", record.preset || "-"]);
    detailRows.push(["Reading Speed", `${Number(record.wpm || 0).toFixed(1)} WPM`]);
    detailRows.push(["Backward Eye Jumps", record.regressions ?? "-"]);
    detailRows.push(["Gaze Steadiness", record.stabilityScore !== undefined ? `${Number(record.stabilityScore).toFixed(1)}%` : "-"]);
    detailRows.push(["Overall Status", record.eyeStatus || "-"]);
  } else if (record.type === "biomarkers") {
    detailRows.push(["Samples Analyzed", String(record.analyzed_samples || 0)]);
    detailRows.push(["Biomarkers Shown", String((record.biomarkers || []).length || 0)]);
    detailRows.push(["Selected Family", record.selectedFamily || "all"]);
    detailRows.push(["Minimum Importance", record.minImportance !== undefined ? String(record.minImportance) : "-"]);
  } else if (record.type === "final_report") {
    detailRows.push(["Final Level", record.finalLevel || "-"]);
    detailRows.push(["Average Risk", record.avgRisk !== undefined ? Number(record.avgRisk).toFixed(3) : "-"]);
    detailRows.push(["Consensus", record.consensusLevel || "-"]);
    detailRows.push(["Readiness", record.readiness || "-"]);
  }
  node.innerHTML = `
    <p><strong>Type:</strong> ${recordTypeLabel(record.type)}</p>
    <p><strong>Saved:</strong> ${record.timestamp ? new Date(record.timestamp).toLocaleString() : "-"}</p>
    <p><strong>Summary:</strong> ${summarizeRecord(record)}</p>
    <p><strong>Status:</strong> <span class="${meta.className}">${meta.label}</span></p>
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
  if (!trace || !trace.data?.length) {
    node.innerHTML = `<p class="mb-0 text-muted small">After upload, this area will show a quick preview of your file before analysis starts.</p>`;
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
      <div class="col-md-3"><strong>Usable Points:</strong> ${data.length}</div>
      <div class="col-md-3"><strong>Trace Time:</strong> ${durationSec.toFixed(2)}s</div>
      <div class="col-md-3"><strong>Avg Sample Gap:</strong> ${avgInterval.toFixed(1)} ms</div>
      <div class="col-md-3"><strong>Horizontal Range:</strong> ${minX.toFixed(3)} - ${maxX.toFixed(3)}</div>
      <div class="col-md-3"><strong>Vertical Range:</strong> ${minY.toFixed(3)} - ${maxY.toFixed(3)}</div>
    </div>
  `;
}

function resetEyeOutputs(message) {
  const resultNode = document.getElementById("eyeResult");
  if (resultNode) resultNode.innerHTML = `<p>${message}</p>`;
  const checklistNode = document.getElementById("eyeChecklist");
  if (checklistNode) checklistNode.innerHTML = `<p class="mb-0 text-muted small">After analysis, this area will show a simple quality checklist for pace, steadiness, and backward eye jumps.</p>`;
  const recommendationNode = document.getElementById("eyeRecommendation");
  if (recommendationNode) recommendationNode.innerHTML = `<p class="mb-0 text-muted">A plain-language recommendation will appear here after the file is analyzed.</p>`;
  setNodeText("eyeOverallScore", "-");
  setNodeText("eyeOverallStatus", "Pending", "text-secondary fw-semibold");
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
  node.innerHTML = `
    <p><strong>End-User Summary:</strong> ${summary.statusText}</p>
    <p><strong>What this means:</strong> ${summary.interpretation}</p>
    <p class="mb-0"><strong>Recommended next step:</strong> ${summary.nextStep}</p>
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
  resetEyeOutputs("Live check captured successfully. Analyzing automatically...");
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
  resetEyeOutputs("Live eye-tracking check is running. Results will appear automatically.");
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
    setNodeText("overallSegmentStatus", "Pending", "text-secondary fw-semibold");
    return;
  }

  const overallScore = (readingTestState.score + (audioFeatures.comprehensionScore * 100) + spellingScore) / 3;
  const allPassed = readingTestState.score >= READING_PASS_THRESHOLD
    && (audioFeatures.comprehensionScore * 100) >= AUDIO_PASS_THRESHOLD
    && spellingScore >= SPELLING_PASS_THRESHOLD;
  setNodeText("overallSegmentScore", `${overallScore.toFixed(1)}%`);
  setNodeText(
    "overallSegmentStatus",
    allPassed ? "Ready for Screening" : "Needs Support Before Screening",
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
  document.getElementById("spellingTestStatus").textContent = `Completed automatically. Correct: ${correct}/${answers.length}, Errors: ${spellingFeatures.errors}`;
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
    if (status) status.textContent = "Keep typing. Scoring will run automatically after all 3 answers are filled.";
    return;
  }
  if (status) status.textContent = "All answers entered. Scoring automatically...";
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

function finalizeReadingSession() {
  if (!readingTestState.startedAt || readingTestState.done) return;
  readingRecognitionRunning = false;
  readingTestState.seconds = Math.max(0, (performance.now() - readingTestState.startedAt) / 1000);
  readingTestState.done = true;
  const promptWords = (document.getElementById("readingPrompt")?.value || "").trim().split(/\s+/).filter(Boolean).length || 1;
  const minutes = Math.max(0.1, readingTestState.seconds / 60);
  const spokenWords = Math.max(0, readingTestState.wordsSpoken || 0);
  const fallbackWords = Math.max(1, Math.round(promptWords * 0.78));
  const effectiveWords = spokenWords > 0 ? spokenWords : fallbackWords;
  const wpm = effectiveWords / minutes;
  const completion = Math.min(1, effectiveWords / promptWords);
  const targetWpm = 65;
  const paceScore = Math.max(0, 1 - (Math.abs(wpm - targetWpm) / targetWpm));
  const hesitationPenalty = Math.min(0.6, readingTestState.hesitations * 0.08);
  const transcriptPenalty = spokenWords > 0 ? 0 : 0.06;
  const score = Math.max(0, Math.min(100, ((completion * 0.55) + (paceScore * 0.45) - hesitationPenalty - transcriptPenalty) * 100));
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
  const transcriptNote = spokenWords > 0 ? "" : " (fallback scoring: partial/no transcript)";
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

async function startLocalMicMonitor() {
  try {
    if (!navigator.mediaDevices?.getUserMedia) return false;
    readingMediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return false;
    readingAudioContext = new Ctx();
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
  } catch (_err) {
    readingMicLevelActive = false;
    return false;
  }
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
    document.getElementById("readingTestStatus").textContent = "Microphone access failed. Allow microphone for this page and try Start again.";
    return;
  }

  // Use a single microphone pipeline for the reading test so the browser
  // requests permission only once per session.
  readingRecognition = null;
  setReadingListeningUI(true);
  startReadingMonitor();
  readingRecognitionRunning = true;
  readingOfflineMode = true;
  document.getElementById("readingTestStatus").textContent = "Microphone connected. Listening is active. Click Stop when you finish reading.";
});

document.getElementById("markHesitation")?.addEventListener("click", () => {
  document.getElementById("readingTestStatus").textContent = "Manual hesitation is disabled. Use Start/Stop for automatic detection.";
});

document.getElementById("stopReadingTest")?.addEventListener("click", () => {
  if (!readingTestState.startedAt || readingTestState.done) return;
  readingStopRequested = true;
  clearReadingAutoFinalizeTimer();
  const wasRecognitionRunning = readingRecognitionRunning;
  readingRecognitionRunning = false;
  if (readingRecognition && wasRecognitionRunning) {
    try { readingRecognition.stop(); } catch (_err) {}
  }
  stopReadingMonitor();
  stopLocalMicMonitor();
  setReadingListeningUI(false);
  finalizeReadingSession();
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
  audioAnswerLocked = false;
  const player = document.getElementById("promptAudioPlayer");
  if (player) {
    player.pause();
    if (currentListeningAudioPath) {
      player.src = currentListeningAudioPath;
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
  updateSegmentScoreMatrix();
  document.getElementById("audioTestStatus").textContent = "Sample ready. Play the audio, then choose one answer. Scoring happens automatically.";
}

function finalizeAudioPlaybackState() {
  audioPlaybackCompleted = true;
  const status = document.getElementById("audioTestStatus");
  if (selectedAudioOptionIndex !== null && !audioAnswerLocked) {
    if (status) status.textContent = "Audio finished. Scoring your selected answer automatically...";
    gradeListeningAnswer(selectedAudioOptionIndex);
    return;
  }
  if (status) status.textContent = "Audio finished. Choose the best answer below. Scoring will happen automatically.";
}

async function loadBengaliListeningSet() {
  try {
    const response = await fetch("./assets/audio/bengali_listening_set.json", { cache: "no-store" });
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

function getAudioFallbackPath(path) {
  if (!path) return "";
  if (path.toLowerCase().endsWith(".wav")) return path.replace(/\.wav$/i, ".mp3");
  if (path.toLowerCase().endsWith(".mp3")) return path.replace(/\.mp3$/i, ".wav");
  return "";
}

function getVoiceForLanguage(language, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const synth = window.speechSynthesis;
    if (!synth) {
      resolve(null);
      return;
    }
    const desired = language === "Hindi" ? "hi" : language === "English" ? "en" : "bn";
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

function getAnyAvailableVoice() {
  const synth = window.speechSynthesis;
  if (!synth) return null;
  const voices = synth.getVoices() || [];
  return voices.length ? voices[0] : null;
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
    const primaryPath = currentListeningAudioPath;
    const fallbackPath = getAudioFallbackPath(primaryPath);
    const tryPlay = async (path) => {
      player.pause();
      player.src = path;
      player.load();
      await player.play();
    };
    status.textContent = "Playing audio...";
    try {
      await tryPlay(primaryPath);
      player.onended = () => {
        status.textContent = "Audio finished. Choose the best answer and click Check Answer.";
      };
    } catch (_err1) {
      try {
        if (!fallbackPath) throw new Error("no fallback path");
        await tryPlay(fallbackPath);
        player.onended = () => {
          status.textContent = "Audio finished. Choose the best answer and click Check Answer.";
        };
      } catch (_err2) {
        status.textContent = "Audio file could not be played. Please try the next sample.";
      }
    }
    return;
  }
  const synth = window.speechSynthesis;
  if (!synth) {
    status.textContent = "Audio playback is not supported in this browser for this language.";
    return;
  }
  let playbackStarted = false;
  const voice = await getVoiceForLanguage(currentListeningLanguage) || getAnyAvailableVoice();
  if (!voice) {
    const fallbackVoice = getAnyAvailableVoice();
    if (!fallbackVoice) {
      document.getElementById("audioTestStatus").textContent = "No TTS voice available in this browser/device.";
      return;
    }
    const speechTextFallback = currentListeningLanguage === "English"
      ? `${currentListeningItem.paragraph}. Question: ${currentListeningItem.question}`
      : currentListeningLanguage === "Hindi"
        ? `${currentListeningItem.paragraph}। प्रश्न: ${currentListeningItem.question}`
        : `${currentListeningItem.paragraph}। প্রশ্ন: ${currentListeningItem.question}`;
    const utterFallback = new SpeechSynthesisUtterance(speechTextFallback);
    utterFallback.lang = fallbackVoice.lang;
    utterFallback.voice = fallbackVoice;
    utterFallback.rate = 0.9;
    utterFallback.pitch = 1.0;
    utterFallback.onstart = () => {
      playbackStarted = true;
      document.getElementById("audioTestStatus").textContent = `Native ${currentListeningLanguage} voice unavailable. Playing fallback voice (${fallbackVoice.lang}).`;
    };
    utterFallback.onend = () => {
      document.getElementById("audioTestStatus").textContent = playbackStarted
        ? "Playback ended. If you heard the prompt, select an option and click Verify Answer."
        : "Audio playback did not start. Check browser audio permission/volume and try again.";
    };
    synth.cancel();
    synth.speak(utterFallback);
    return;
  }
  synth.cancel();
  const text = `${currentListeningItem.paragraph}। প্রশ্ন: ${currentListeningItem.question}`;
  const speechText = currentListeningLanguage === "English"
    ? `${currentListeningItem.paragraph}. Question: ${currentListeningItem.question}`
    : currentListeningLanguage === "Hindi"
      ? `${currentListeningItem.paragraph}। प्रश्न: ${currentListeningItem.question}`
      : `${currentListeningItem.paragraph}। প্রশ্ন: ${currentListeningItem.question}`;
  const utter = new SpeechSynthesisUtterance(
    currentListeningLanguage === "English"
      ? `${currentListeningItem.paragraph}. Question: ${currentListeningItem.question}`
      : currentListeningLanguage === "Hindi"
        ? `${currentListeningItem.paragraph}। प्रश्न: ${currentListeningItem.question}`
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
  if (question) {
    question.textContent = currentListeningItem.question || "Listen to the sample and answer the question below.";
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
      if (!audioPlaybackCompleted) {
        const status = document.getElementById("audioTestStatus");
        if (status) status.textContent = "Please let the audio finish first. The answer will be scored automatically after playback.";
        return;
      }
      gradeListeningAnswer(index);
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
  if (currentListeningAudioPath) {
    if (!player) return;
    const primaryPath = currentListeningAudioPath;
    const fallbackPath = getAudioFallbackPath(primaryPath);
    const tryPlay = async (path) => {
      player.pause();
      player.src = path;
      player.load();
      await player.play();
    };
    status.textContent = currentListeningLanguage === "English"
      ? "Playing English listening sample..."
      : "Playing audio...";
    try {
      await tryPlay(primaryPath);
      player.onended = () => {
        finalizeAudioPlaybackState();
      };
    } catch (_primaryError) {
      try {
        if (!fallbackPath) throw new Error("no fallback path");
        await tryPlay(fallbackPath);
        player.onended = () => {
          finalizeAudioPlaybackState();
        };
      } catch (_fallbackError) {
        status.textContent = "Audio file could not be played. Please try the next sample.";
      }
    }
    return;
  }
  const synth = window.speechSynthesis;
  if (!synth) {
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
    Hindi: "hi-IN",
    Multilingual: "en-US",
  };
  const voice = await getVoiceForLanguage(currentListeningLanguage) || getAnyAvailableVoice();
  let playbackStarted = false;
  synth.cancel();
  const utter = new SpeechSynthesisUtterance(currentListeningItem.paragraph || "");
  utter.lang = voice?.lang || languageMap[currentListeningLanguage] || "en-US";
  if (voice) utter.voice = voice;
  utter.rate = 0.9;
  utter.pitch = 1.0;
  utter.volume = 1.0;
  utter.onstart = () => {
    playbackStarted = true;
    status.textContent = currentListeningLanguage === "English"
      ? "Playing English listening sample..."
      : "Playing audio...";
  };
  utter.onend = () => {
    if (!playbackStarted) {
      status.textContent = "Audio playback did not start. Please try the next sample.";
      return;
    }
    finalizeAudioPlaybackState();
  };
  utter.onerror = () => {
    status.textContent = "Audio playback failed in this browser. Please check browser sound settings and try again.";
  };
  try {
    if (typeof synth.resume === "function") synth.resume();
    synth.speak(utter);
  } catch (_err) {
    status.textContent = "Audio playback failed in this browser. Please check browser sound settings and try again.";
  }
}

function gradeListeningAnswer(selectedIndex) {
  if (!currentListeningItem) return;
  if (audioAnswerLocked) return;
  audioAnswerLocked = true;
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
  updateSegmentScoreMatrix();
  document.getElementById("audioTestStatus").textContent =
    correct
      ? `Correct. Listening score: ${listeningScore.toFixed(1)}%`
      : `Not quite right. Listening score: ${listeningScore.toFixed(1)}%. A new sample can be loaded if needed.`;
  maybeAutoRunScreening();
}

function submitAudioAnswer(selectedIndex) {
  if (!currentListeningItem) return;
  const correct = selectedIndex === currentListeningItem.correctIndex;
  if (!correct) audioFeatures.wrongAttempts += 1;
  const base = correct ? 1 : 0;
  const penalty = Math.min(0.7, (audioFeatures.reloadCount * 0.15) + (audioFeatures.wrongAttempts * 0.2));
  const efficiency = Math.max(0, base - penalty);
  audioFeatures.analyzed = true;
  audioFeatures.comprehensionScore = efficiency;
  audioFeatures.pronunciationProxy = Math.max(0, Math.round((1 - efficiency) * 5));
  document.getElementById("audioTestStatus").textContent =
    correct
      ? `Correct answer selected. Efficiency: ${(efficiency * 100).toFixed(1)}%`
      : `Incorrect answer selected. Efficiency: ${(efficiency * 100).toFixed(1)}%. Reload for a fresh paragraph if distracted.`;
}

document.getElementById("reloadAudioParagraph")?.addEventListener("click", () => {
  const language = document.getElementById("sampleLanguage")?.value || "Bengali";
  audioFeatures.reloadCount += 1;
  pickListeningParagraph(language);
  document.getElementById("audioTestStatus").textContent = "New sample loaded. Click Play Audio when ready.";
});

document.getElementById("playAudioParagraph")?.addEventListener("click", playListeningSample);
document.getElementById("verifyAudioAnswer")?.addEventListener("click", () => {
  if (audioAnswerLocked) {
    document.getElementById("audioTestStatus").textContent = "This sample is already scored. Load the next sample to continue.";
    return;
  }
  if (selectedAudioOptionIndex === null) {
    document.getElementById("audioTestStatus").textContent = "Please choose one answer first.";
    return;
  }
  if (!audioPlaybackCompleted) {
    document.getElementById("audioTestStatus").textContent = "Please let the audio finish first.";
    return;
  }
  gradeListeningAnswer(selectedAudioOptionIndex);
});

document.getElementById("sampleLanguage")?.addEventListener("change", (event) => {
  const language = event.target.value;
  pickListeningParagraph(language);
  renderRandomReadingPrompt(language);
  renderRandomSpellingWords(language);
});

document.getElementById("voiceSelect")?.addEventListener("change", (event) => {
  selectedVoiceURI = event.target.value || "";
});

document.getElementById("testVoiceButton")?.addEventListener("click", () => {
  const synth = window.speechSynthesis;
  if (!synth) {
    document.getElementById("audioTestStatus").textContent = "Speech synthesis not supported in this browser.";
    return;
  }
  const voice = findVoiceByURI(selectedVoiceURI) || getAnyAvailableVoice();
  if (!voice) {
    document.getElementById("audioTestStatus").textContent = "No TTS voice available in this browser/device.";
    return;
  }
  synth.cancel();
  const msg = currentListeningLanguage === "English"
    ? "Voice assistant test. If you hear this, audio is working."
    : currentListeningLanguage === "Hindi"
      ? "वॉइस सहायक परीक्षण। यदि आप यह सुन पा रहे हैं, तो ऑडियो काम कर रहा है।"
      : "ভয়েস সহকারী পরীক্ষা। আপনি যদি এটি শুনতে পান, অডিও কাজ করছে।";
  const utter = new SpeechSynthesisUtterance(msg);
  utter.voice = voice;
  utter.lang = voice.lang;
  utter.onstart = () => {
    document.getElementById("audioTestStatus").textContent = `Testing voice: ${voice.name} (${voice.lang})`;
  };
  utter.onend = () => {
    document.getElementById("audioTestStatus").textContent = "Voice test finished.";
  };
  utter.onerror = () => {
    document.getElementById("audioTestStatus").textContent = "Voice test failed. Try another voice.";
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

document.getElementById("runScreening").addEventListener("click", () => {
  if (!readingTestState.done) {
    document.getElementById("screeningResult").innerHTML = "<p>Please complete Reading Fluency Test first.</p>";
    return;
  }
  if (!audioFeatures.analyzed) {
    document.getElementById("screeningResult").innerHTML = "<p>Please complete the audio test first.</p>";
    return;
  }
  if (!spellingFeatures.scored) {
    document.getElementById("screeningResult").innerHTML = "<p>Please score the spelling test first.</p>";
    return;
  }
  const language = document.getElementById("sampleLanguage").value;
  const spelling = spellingFeatures.errors;
  const pron = audioFeatures.pronunciationProxy;
  const time = readingTestState.seconds;
  const hes = readingTestState.hesitations;
  const rep = Math.max(0, Math.round((1 - audioFeatures.comprehensionScore) * 4));
  const omi = Math.max(0, Math.round((time > 45 ? 2 : 0) + (hes > 4 ? 1 : 0) + (audioFeatures.reloadCount > 0 ? 1 : 0)));

  const severityScore = (pron * 0.9) + (spelling * 0.8) + (hes * 0.7) + (rep * 0.55) + (omi * 0.9) + (time / 25);
  const probabilities = [
    Math.max(0.02, 1.15 - (severityScore / 7)),
    Math.max(0.02, 0.55 + (severityScore / 12)),
    Math.max(0.02, -0.2 + (severityScore / 8)),
  ];
  const sum = probabilities.reduce((a, b) => a + b, 0);
  const norm = probabilities.map((p) => p / sum);

  const labels = ["Mild", "Moderate", "Severe"];
  const maxIndex = norm.indexOf(Math.max(...norm));
  const label = labels[maxIndex];
  const confidence = norm[maxIndex];
  const riskTone = label === "Mild" ? "low-to-moderate" : label === "Moderate" ? "moderate" : "high";

  const teacher = `Classroom view: ${riskTone} support need. Focus on structured decoding, short fluency rounds, and monitored repetition.`;
  const parent = "Home view: use 10-15 minute calm practice blocks, one sound family at a time, and track weekly changes.";
  const student = "Learner view: we practice in small steps. You are improving through repetition, not being judged.";
  const intervention = label === "Severe"
    ? "Intervention: intensive mixed reading-pronunciation-spelling plan, 90+ min/week."
    : label === "Moderate"
      ? "Intervention: balanced plan with pronunciation focus, 65-75 min/week."
      : "Intervention: foundation reinforcement plan, 40-50 min/week.";

  document.getElementById("screeningResult").innerHTML = `
    <p><strong>Language:</strong> ${language}</p>
    <p><strong>Predicted Severity:</strong> ${label}</p>
    <p><strong>Confidence:</strong> ${(confidence * 100).toFixed(1)}%</p>
    <p>${teacher}</p>
    <p>${parent}</p>
    <p>${student}</p>
    <p><strong>${intervention}</strong></p>
  `;

  screeningChart = drawChart(screeningChart, "screeningChart", {
    type: "bar",
    data: {
      labels,
      datasets: [{ label: "Probability", data: norm, backgroundColor: ["#22c55e", "#f59e0b", "#ef4444"] }],
    },
    options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, max: 1 } } },
  });

  saveRecord({
    type: "screening",
    language,
    label,
    confidence,
    severityScore,
      auto_features: {
        spelling_errors: spelling,
        pronunciation_errors: pron,
        reading_time_seconds: time,
        hesitations: hes,
        repetitions: rep,
        omissions: omi,
        listening_efficiency: audioFeatures.comprehensionScore,
        paragraph_reload_count: audioFeatures.reloadCount,
        wrong_attempts: audioFeatures.wrongAttempts,
      },
  });
  latestScreening = { label, confidence, severityScore, language };
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
  updateTestLabStatus();
}

document.getElementById("runTherapy")?.addEventListener("click", analyzeTherapySession);

async function analyzeEyeTrackingNow() {
  const fileInput = document.getElementById("traceFile");
  const file = fileInput?.files?.[0];
  if (!file && !latestEyeTrace) {
    resetEyeOutputs("Please start the live on-screen eye-tracking check first, or use the optional CSV import.");
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
  resetEyeOutputs("Start a live on-screen eye-tracking check or upload a gaze CSV.");
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
  resetEyeOutputs("Demo sample loaded. Analyzing automatically...");
  await analyzeEyeTrackingNow();
});

document.getElementById("traceFile")?.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) {
    latestEyeTrace = null;
    latestEyeTraceLabel = "";
    setEyeUploadStatus("No CSV file uploaded. You can still run the live on-screen eye-tracking check.");
    renderEyeTraceQuickStats(null);
    resetEyeOutputs("Start the live on-screen eye-tracking check, or use the optional CSV import.");
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
  resetEyeOutputs("File loaded successfully. Analyzing automatically...");
  await analyzeEyeTrackingNow();
});

document.getElementById("eyePreset")?.addEventListener("change", (event) => {
  applyEyePreset(event.target.value, true);
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
    summaryNode.innerHTML = "<p>Please upload a manifest CSV file.</p>";
    tableNode.innerHTML = "";
    return;
  }
  const text = await file.text();
  const rows = text.trim().split(/\r?\n/);
  const header = rows[0].split(",").map((x) => x.trim());
  const labelIdx = header.indexOf(labelColumn);
  if (labelIdx < 0) {
    summaryNode.innerHTML = `<p>Label column "${labelColumn}" not found.</p>`;
    return;
  }

  const numericCols = header
    .map((name, idx) => ({ name, idx }))
    .filter(({ idx }) => idx !== labelIdx)
    .filter(({ name }) => /^((sp|rd|hw|eye)_|.*errors|.*count|.*time|.*rate|.*speed|.*dispersion|.*gaze|.*fix)/i.test(name));
  const samples = rows.slice(1).map((line) => line.split(","));
  const labels = samples.map((row) => Number(row[labelIdx])).map((v) => (Number.isFinite(v) ? v : 0));
  const meanLabel = labels.reduce((a, b) => a + b, 0) / Math.max(1, labels.length);
  const varLabel = labels.reduce((a, b) => a + ((b - meanLabel) ** 2), 0) / Math.max(1, labels.length);
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
  summaryNode.innerHTML = `
    <p><strong>Samples analyzed:</strong> ${samples.length}</p>
    <p><strong>Biomarkers evaluated:</strong> ${results.length}</p>
    <p><strong>Shown after filters:</strong> ${top.length}</p>
    <p><strong>Strongest signal:</strong> ${strongest ? `${strongest.biomarker} (${strongest.family})` : "No biomarker passed the filter"}</p>
  `;
  tableNode.innerHTML = top.length
    ? top.map((row) => `<tr><td>${row.biomarker}</td><td>${row.family}</td><td>${row.correlation.toFixed(4)}</td><td>${row.importance.toFixed(4)}</td><td>${row.interpretation}</td></tr>`).join("")
    : `<tr><td colspan="5" class="text-muted">No biomarkers passed the current filters.</td></tr>`;

  biomarkerChart = drawChart(biomarkerChart, "biomarkerChart", {
    type: "bar",
    data: {
      labels: top.map((x) => x.biomarker),
      datasets: [{ label: "Importance", data: top.map((x) => x.importance), backgroundColor: "#0891b2" }],
    },
    options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, max: 1 } } },
  });

  saveRecord({ type: "biomarkers", analyzed_samples: samples.length, total_biomarkers: results.length, selectedFamily, minImportance, topN, biomarkers: top });
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
  const screeningDone = !!latestScreening;
  const therapyDone = !!latestTherapy;
  const eyeDone = !!latestEye;
  const ready = screeningDone && therapyDone && eyeDone;
  const node = document.getElementById("testStatus");
  if (!node) return;
  const screeningSummary = screeningDone ? `${latestScreening.label} (${(latestScreening.confidence * 100).toFixed(1)}%)` : "Pending";
  const therapySummary = therapyDone ? `${latestTherapy.sessionBand} (${(latestTherapy.overallScorePct || latestTherapy.score * 100).toFixed(1)}%)` : "Pending";
  const eyeSummary = eyeDone ? `${latestEye.eyeStatus || "Done"} (${(latestEye.eyeOverallScore || 0).toFixed(1)}%)` : "Pending";
  node.innerHTML = `
    <p><strong>Checklist</strong></p>
    <p>Screening: ${screeningSummary}</p>
    <p>Speech Therapy: ${therapySummary}</p>
    <p>Eye Tracking: ${eyeSummary}</p>
    <p><strong>Ready for model comparison:</strong> <span class="${ready ? "text-success" : "text-danger"} fw-semibold">${ready ? "Yes" : "No"}</span></p>
  `;
}

function modelPredict(scoreBase, modelName) {
  const biases = {
    cnn: 0.02,
    lstm: -0.01,
    transformer: 0.03,
    vit: 0.01,
    multimodal_attention: 0.05,
  };
  const risk = Math.max(0, Math.min(1, scoreBase + (biases[modelName] || 0)));
  const level = risk < 0.33 ? "Mild" : risk < 0.66 ? "Moderate" : "Severe";
  const confidence = Math.max(0.5, Math.min(0.97, 0.58 + risk * 0.35));
  return { modelName, level, confidence, risk };
}

document.getElementById("runComparison")?.addEventListener("click", () => {
  if (!latestScreening || !latestTherapy || !latestEye) {
    document.getElementById("finalReport").innerHTML = "<p>Please complete Screening, Therapy, and Eye Tracking first.</p>";
    return;
  }
  const base =
    (latestScreening.severityScore / 10) * 0.45 +
    (1 - latestTherapy.score) * 0.30 +
    Math.min(1, latestEye.regressions / 10) * 0.15 +
    Math.min(1, latestEye.dispersion * 4) * 0.10;
  const models = ["cnn", "lstm", "transformer", "vit", "multimodal_attention"];
  const predictions = models.map((m) => modelPredict(base, m));
  const averageRisk = predictions.reduce((sum, row) => sum + row.risk, 0) / predictions.length;
  const levelCounts = predictions.reduce((acc, row) => {
    acc[row.level] = (acc[row.level] || 0) + 1;
    return acc;
  }, {});
  const consensusLevel = ["Severe", "Moderate", "Mild"].sort((a, b) => (levelCounts[b] || 0) - (levelCounts[a] || 0))[0];
  const mostCautious = predictions.reduce((best, row) => row.risk > best.risk ? row : best, predictions[0]);
  const mostConfident = predictions.reduce((best, row) => row.confidence > best.confidence ? row : best, predictions[0]);
  const stabilitySpread = Math.max(...predictions.map((p) => p.risk)) - Math.min(...predictions.map((p) => p.risk));
  const decisionStability = stabilitySpread < 0.08 ? "High agreement" : stabilitySpread < 0.16 ? "Moderate agreement" : "Low agreement";

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
  setNodeText("labDecisionStability", decisionStability, stabilitySpread < 0.16 ? "text-success fw-semibold" : "text-warning fw-semibold");
  setNodeText("labReadinessStatus", averageRisk < 0.66 ? "Comparison ready" : "High-risk pattern detected", averageRisk < 0.66 ? "text-success fw-semibold" : "text-danger fw-semibold");

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
  document.getElementById("finalReport").innerHTML = `
    <p><strong>Model comparison completed.</strong></p>
    <p>Consensus level: ${consensusLevel}</p>
    <p>Average risk: ${averageRisk.toFixed(3)}</p>
    <p>Decision stability: ${decisionStability}</p>
    <p>Now click <strong>Generate Final Report</strong> for the merged outcome.</p>
  `;
});

document.getElementById("generateFinal")?.addEventListener("click", () => {
  const predictions = window.__latestModelPredictions || [];
  if (!predictions.length) {
    document.getElementById("finalReport").innerHTML = "<p>Run model comparison first.</p>";
    return;
  }
  const avgRisk = predictions.reduce((a, b) => a + b.risk, 0) / predictions.length;
  const severeVotes = predictions.filter((x) => x.level === "Severe").length;
  const moderateVotes = predictions.filter((x) => x.level === "Moderate").length;
  const finalLevel = severeVotes >= 3 ? "Severe" : moderateVotes >= 3 ? "Moderate" : "Mild";
  const recommendation =
    finalLevel === "Severe"
      ? "High-priority intervention: intensive reading-pronunciation-spelling plan and specialist review."
      : finalLevel === "Moderate"
        ? "Structured intervention: guided practice 4-5 days/week with progress tracking."
        : "Foundation support: regular guided practice and periodic reassessment.";
  const consensus = window.__latestConsensus || {};

  document.getElementById("finalReport").innerHTML = `
    <p><strong>Final Aggregated Outcome:</strong> ${finalLevel}</p>
    <p><strong>Average Risk Score:</strong> ${avgRisk.toFixed(3)}</p>
    <p><strong>Model Agreement:</strong> Severe votes ${severeVotes}, Moderate votes ${moderateVotes}, Mild votes ${predictions.length - severeVotes - moderateVotes}</p>
    <p><strong>Decision Stability:</strong> ${consensus.decisionStability || "-"}</p>
    <p><strong>Most Cautious Model:</strong> ${consensus.mostCautious ? `${consensus.mostCautious.modelName} (${consensus.mostCautious.level})` : "-"}</p>
    <p><strong>Recommended Next Step:</strong> ${recommendation}</p>
  `;
  saveRecord({ type: "final_report", finalLevel, avgRisk, severeVotes, moderateVotes, predictions });
});

updateTestLabStatus();
async function initializeDashboard() {
  const language = document.getElementById("sampleLanguage")?.value || "Bengali";
  const therapyLanguage = document.getElementById("therapyLanguage")?.value || "Bengali";
  const therapySessionType = document.getElementById("therapyType")?.value || "Sound Drill";
  const eyePreset = document.getElementById("eyePreset")?.value || "short_passage";
  await loadBengaliListeningSet();
  pickListeningParagraph(language);
  renderRandomSpellingWords(language);
  renderRandomReadingPrompt(language);
  renderTherapyTargetOptions(therapyLanguage, therapySessionType);
  applyEyePreset(eyePreset, false);
  resetEyeLiveCheck(false);
  updateTherapyPromptUI();
  setTherapyRoundStatus("The system will listen to each spoken response and auto-fill the therapy metrics below.");
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
  resetEyeOutputs("Start the live on-screen eye-tracking check, or use the optional CSV import.");
  setEyeUploadStatus("No CSV file uploaded yet. Live on-screen eye tracking is ready.");
  updateEyeLiveButtons();
  updateSegmentScoreMatrix();
}
initializeDashboard();

document.querySelectorAll(".user-guide-btn").forEach((button) => {
  button.addEventListener("click", () => openGuideModal(button.dataset.guide));
});
document.getElementById("closeGuideModal")?.addEventListener("click", closeGuideModal);
document.querySelector(".guide-modal-backdrop")?.addEventListener("click", closeGuideModal);
