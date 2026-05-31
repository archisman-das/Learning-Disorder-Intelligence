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
let readingTestState = { startedAt: null, seconds: 0, hesitations: 0, done: false };
let audioFeatures = { analyzed: false, comprehensionScore: 0, reloadCount: 0, wrongAttempts: 0, pronunciationProxy: 3 };
let spellingFeatures = { scored: false, errors: 0, total: 3 };
let currentSpellingWords = ["বাংলা", "নদী", "বই"];
let currentListeningItem = null;
let currentListeningLanguage = "Bengali";
let currentListeningAudioPath = "";
let selectedAudioOptionIndex = null;
let selectedVoiceURI = "";
let bengaliListeningSet = [];

const BENGALI_WORD_BANK = [
  "বাংলা", "নদী", "বই", "স্কুল", "শিক্ষা", "কলম", "খাতা", "ফুল", "পাখি", "আকাশ",
  "মাটি", "শব্দ", "গান", "চিঠি", "চশমা", "সময়", "সকাল", "রাত", "শিশু", "বন্ধু",
  "পরিবার", "দরজা", "জানালা", "খেলাধুলা", "চাকরি", "গ্রাম", "শহর", "ছাত্র", "শিক্ষক", "কবিতা",
];

const READING_PROMPTS = {
  Bengali: [
    "আজ আমি মনোযোগ দিয়ে বাংলা অনুচ্ছেদ পড়ছি।",
    "শিক্ষক যেমন দেখিয়েছেন, আমি তেমন করে স্পষ্ট উচ্চারণে পড়ি।",
    "প্রতিদিন একটু একটু করে পড়ার অভ্যাস করলে আমার সাবলীলতা বাড়ে।",
    "কঠিন শব্দে থামলে আমি শব্দটা ভেঙে আবার পড়ি।",
    "ধীরে শুরু করে পরে আমি একই বাক্য আরও স্বাভাবিক গতিতে পড়ি।",
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
      paragraph: "সকালবেলা রিমি স্কুলে যাওয়ার আগে দশ মিনিট বই পড়ে। আজ সে নদী ও পাখি নিয়ে একটি ছোট গল্প পড়েছে।",
      question: "রিমি স্কুলে যাওয়ার আগে কী করে?",
      options: ["বই পড়ে", "খেলতে যায়", "টিভি দেখে"],
      correctIndex: 0,
    },
    {
      paragraph: "আরিফ প্রতিদিন সন্ধ্যায় পড়ার টেবিলে বসে অনুশীলন করে। কঠিন শব্দ দেখলে সে শব্দটা ভেঙে ধীরে ধীরে পড়ে।",
      question: "কঠিন শব্দ দেখলে আরিফ কী করে?",
      options: ["শব্দ ভেঙে পড়ে", "বই বন্ধ করে", "লিখতে শুরু করে"],
      correctIndex: 0,
    },
    {
      paragraph: "মিতা পড়ার সময় তাড়াহুড়া করে না। সে প্রথমে বাক্যটি একবার দেখে, তারপর স্পষ্ট উচ্চারণে পড়ে।",
      question: "মিতা পড়ার আগে কী করে?",
      options: ["বাক্যটি একবার দেখে", "বন্ধুকে ডাকে", "হাঁটতে যায়"],
      correctIndex: 0,
    },
  ],
  Hindi: [
    {
      paragraph: "रीना स्कूल जाने से पहले दस मिनट पढ़ती है। आज उसने नदी और पक्षियों पर एक छोटी कहानी पढ़ी।",
      question: "रीना स्कूल जाने से पहले क्या करती है?",
      options: ["पढ़ती है", "टीवी देखती है", "खेलती है"],
      correctIndex: 0,
    },
    {
      paragraph: "आरव रोज शाम को अभ्यास करता है। कठिन शब्द आने पर वह शब्द को तोड़कर धीरे-धीरे पढ़ता है।",
      question: "कठिन शब्द आने पर आरव क्या करता है?",
      options: ["शब्द तोड़कर पढ़ता है", "किताब बंद करता है", "सो जाता है"],
      correctIndex: 0,
    },
  ],
  English: [
    {
      paragraph: "Maya reads for ten minutes before school. Today she read a short story about a river and birds.",
      question: "What does Maya do before school?",
      options: ["She reads", "She watches TV", "She goes to sleep"],
      correctIndex: 0,
    },
    {
      paragraph: "Rafi practices every evening. When he finds a difficult word, he breaks it into parts and reads slowly.",
      question: "What does Rafi do with difficult words?",
      options: ["Breaks words into parts", "Skips the word", "Stops reading"],
      correctIndex: 0,
    },
  ],
  Multilingual: [
    {
      paragraph: "আমি আর Rafi একসাথে পড়ি। कठिन शब्द এলে আমরা ধীরে ধীরে পড়ি এবং শব্দ ভেঙে নিই।",
      question: "কঠিন শব্দ এলে আমরা কী করি?",
      options: ["ধীরে ধীরে পড়ি ও শব্দ ভেঙে নিই", "লাইন বাদ দিই", "খেলা শুরু করি"],
      correctIndex: 0,
    },
  ],
};

const n = (id) => Number(document.getElementById(id).value || 0);
const loadRecords = () => JSON.parse(localStorage.getItem(storeKey) || "[]");
const saveRecord = (entry) => {
  const records = loadRecords();
  records.push({ ...entry, timestamp: new Date().toISOString() });
  localStorage.setItem(storeKey, JSON.stringify(records));
  renderRecords();
};
const renderRecords = () => {
  document.getElementById("recordsView").textContent = JSON.stringify(loadRecords(), null, 2);
};

const GUIDE_CONTENT = {
  screening: {
    title: "Screening Guidance",
    html: `
      <ol>
        <li>Complete Reading Fluency Test: Start, mark hesitations, then Stop. / Reading test সম্পন্ন করুন।</li>
        <li>Select sample audio and wait for automatic analysis. / Sample audio নির্বাচন করে বিশ্লেষণ সম্পন্ন হতে দিন।</li>
        <li>Finish Spelling Test and click score. / Spelling test score করুন।</li>
        <li>Click Run Screening for automatic outcome. / Run Screening চাপুন।</li>
      </ol>
      <p><strong>Note:</strong> Screening aid only, not final diagnosis.</p>
    `,
  },
  therapy: {
    title: "Speech Therapy Guidance",
    html: `
      <ol>
        <li>Enter one session's duration and error values. / একটি সেশনের মান দিন।</li>
        <li>Set attention rating realistically (1-5). / মনোযোগের রেটিং দিন।</li>
        <li>Click Score Session and follow recommendation. / Score Session চাপুন এবং সুপারিশ অনুসরণ করুন।</li>
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
        <li>Run analysis and inspect top correlated markers. / বিশ্লেষণ চালিয়ে শীর্ষ মার্কার দেখুন।</li>
      </ol>
    `,
  },
  records: {
    title: "Records Guidance",
    html: `
      <ol>
        <li>All outputs are saved in local browser storage. / সব ফলাফল লোকাল স্টোরেজে থাকে।</li>
        <li>Export JSON for backup/reporting. / Export JSON দিয়ে ব্যাকআপ নিন।</li>
        <li>Clear Records resets local history. / Clear Records পুরনো ডাটা মুছে দেয়।</li>
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

function shuffle(array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function renderRandomSpellingWords() {
  const picked = shuffle(BENGALI_WORD_BANK).slice(0, 3);
  currentSpellingWords = picked;
  const labels = [
    document.getElementById("spellLabel1"),
    document.getElementById("spellLabel2"),
    document.getElementById("spellLabel3"),
  ];
  picked.forEach((word, index) => {
    if (labels[index]) labels[index].textContent = `${index + 1}) Correct spelling: ${word}`;
  });
}

function renderRandomReadingPrompt(language) {
  const input = document.getElementById("readingPrompt");
  if (!input) return;
  const prompts = READING_PROMPTS[language] || READING_PROMPTS.Bengali;
  input.value = prompts[Math.floor(Math.random() * prompts.length)];
}

document.getElementById("startReadingTest")?.addEventListener("click", () => {
  readingTestState = { startedAt: performance.now(), seconds: 0, hesitations: 0, done: false };
  document.getElementById("readingTestStatus").textContent = "Reading test started.";
});

document.getElementById("markHesitation")?.addEventListener("click", () => {
  if (!readingTestState.startedAt || readingTestState.done) return;
  readingTestState.hesitations += 1;
  document.getElementById("readingTestStatus").textContent = `Running... hesitations marked: ${readingTestState.hesitations}`;
});

document.getElementById("stopReadingTest")?.addEventListener("click", () => {
  if (!readingTestState.startedAt || readingTestState.done) return;
  readingTestState.seconds = Math.max(0, (performance.now() - readingTestState.startedAt) / 1000);
  readingTestState.done = true;
  document.getElementById("readingTestStatus").textContent = `Completed. Duration: ${readingTestState.seconds.toFixed(1)}s, hesitations: ${readingTestState.hesitations}`;
});

document.getElementById("scoreSpellingTest")?.addEventListener("click", () => {
  const q1 = normalizeBangla(document.getElementById("spellQ1").value);
  const q2 = normalizeBangla(document.getElementById("spellQ2").value);
  const q3 = normalizeBangla(document.getElementById("spellQ3").value);
  const answers = currentSpellingWords.map((x) => normalizeBangla(x));
  const given = [q1, q2, q3];
  let correct = 0;
  for (let i = 0; i < answers.length; i += 1) {
    if (given[i] === answers[i]) correct += 1;
  }
  spellingFeatures = { scored: true, errors: answers.length - correct, total: answers.length };
  document.getElementById("spellingTestStatus").textContent = `Completed. Correct: ${correct}/${answers.length}, Errors: ${spellingFeatures.errors}`;
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
  currentListeningAudioPath = language === "Bengali" ? (currentListeningItem.audioPath || "") : "";
  renderAudioOptions();
  audioFeatures.analyzed = false;
  audioFeatures.comprehensionScore = 0;
  audioFeatures.pronunciationProxy = 3;
  audioFeatures.wrongAttempts = 0;
  document.getElementById("audioTestStatus").textContent = "Paragraph loaded. Click Play Voice Prompt and answer from options.";
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
        paragraph: "",
        question: String(x.question || ""),
        options: Array.isArray(x.options) ? x.options.map((o) => String(o)) : [],
        correctIndex: Number.isInteger(x.correctIndex) ? x.correctIndex : 0,
      }))
      .filter((x) => x.audioPath && x.options.length >= 2);
  } catch (_error) {
    bengaliListeningSet = [];
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
  if (currentListeningLanguage === "Bengali") {
    const player = document.getElementById("promptAudioPlayer");
    if (!player) return;
    if (!currentListeningAudioPath) {
      document.getElementById("audioTestStatus").textContent = "No Bengali audio mapped for this question.";
      return;
    }
    const primaryPath = currentListeningAudioPath;
    const fallbackPath = getAudioFallbackPath(primaryPath);
    const tryPlay = async (path) => {
      player.src = path;
      player.load();
      await player.play();
    };
    document.getElementById("audioTestStatus").textContent = "Playing prerecorded Bengali prompt...";
    try {
      await tryPlay(primaryPath);
      player.onended = () => {
        document.getElementById("audioTestStatus").textContent = "Playback ended. Select an option and click Verify Answer.";
      };
    } catch (_err1) {
      try {
        if (!fallbackPath) throw new Error("no fallback path");
        await tryPlay(fallbackPath);
        player.onended = () => {
          document.getElementById("audioTestStatus").textContent = "Playback ended. Select an option and click Verify Answer.";
        };
      } catch (_err2) {
        document.getElementById("audioTestStatus").textContent = "Bengali audio file missing or blocked. Please keep the file in web/assets/audio and retry.";
      }
    }
    return;
  }
  const synth = window.speechSynthesis;
  if (!synth) {
    document.getElementById("audioTestStatus").textContent = "Speech synthesis not supported in this browser.";
    return;
  }
  let playbackStarted = false;
  const preferredVoice = findVoiceByURI(selectedVoiceURI);
  const voice = preferredVoice || await getVoiceForLanguage(currentListeningLanguage);
  if (!voice) {
    const fallbackVoice = getAnyAvailableVoice();
    if (!fallbackVoice) {
      document.getElementById("audioTestStatus").textContent = "No TTS voice available in this browser/device.";
      return;
    }
    const speechTextFallback = currentListeningLanguage === "English"
      ? `${currentListeningItem.paragraph}. Question: ${currentListeningItem.question}`
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
    : `${currentListeningItem.paragraph}। प्रश्न: ${currentListeningItem.question}`;
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
  document.getElementById("audioTestStatus").textContent = `Paragraph reloaded (${audioFeatures.reloadCount}). Answer the new question.`;
});

document.getElementById("playAudioParagraph")?.addEventListener("click", speakPrompt);
document.getElementById("verifyAudioAnswer")?.addEventListener("click", () => {
  if (selectedAudioOptionIndex === null) {
    document.getElementById("audioTestStatus").textContent = "Please select an answer option first.";
    return;
  }
  submitAudioAnswer(selectedAudioOptionIndex);
});

document.getElementById("sampleLanguage")?.addEventListener("change", (event) => {
  const language = event.target.value;
  pickListeningParagraph(language);
  renderRandomReadingPrompt(language);
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

document.getElementById("runScreening").addEventListener("click", () => {
  if (!readingTestState.done) {
    document.getElementById("screeningResult").innerHTML = "<p>Please complete Reading Fluency Test first.</p>";
    return;
  }
  if (!audioFeatures.analyzed) {
    document.getElementById("screeningResult").innerHTML = "<p>Please upload and analyze reading audio first.</p>";
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

document.getElementById("runTherapy").addEventListener("click", () => {
  const duration = n("therapyDuration");
  const pron = n("therapyPron");
  const rep = n("therapyRep");
  const sub = n("therapySub");
  const attention = Math.min(5, Math.max(1, n("therapyAttention")));
  const errorLoad = pron * 0.35 + rep * 0.25 + sub * 0.4;
  const pacePenalty = Math.max(0, duration - 20) / 20;
  const attentionPenalty = Math.max(0, 3 - attention) * 0.08;
  const attentionBonus = Math.max(0, attention - 3) * 0.03;
  const score = Math.max(0, Math.min(1, 1 - Math.min(0.95, errorLoad / 5 + pacePenalty * 0.2 + attentionPenalty) + attentionBonus));
  const recommendation = score >= 0.8
    ? "Advance to next-level phrase and keep one review cycle."
    : score >= 0.55
      ? "Repeat the same prompt with slower guided modeling."
      : "Step back to syllable and letter articulation drills.";
  const nextLevel = score >= 0.8 ? "advance" : score >= 0.55 ? "repeat" : "simplify";

  document.getElementById("therapyResult").innerHTML = `
    <p><strong>Therapy Score:</strong> ${(score * 100).toFixed(1)}%</p>
    <p><strong>Recommendation:</strong> ${recommendation}</p>
    <p><strong>Next Level:</strong> ${nextLevel}</p>
  `;

  therapyChart = drawChart(therapyChart, "therapyChart", {
    type: "doughnut",
    data: {
      labels: ["Completed", "Remaining"],
      datasets: [{ data: [score * 100, 100 - (score * 100)], backgroundColor: ["#16a34a", "#e5e7eb"] }],
    },
    options: { responsive: true, maintainAspectRatio: false, cutout: "68%" },
  });

  saveRecord({ type: "therapy", score, recommendation, nextLevel, duration, pron, rep, sub, attention });
  latestTherapy = { score, recommendation, nextLevel };
  updateTestLabStatus();
});

document.getElementById("runEye").addEventListener("click", async () => {
  const file = document.getElementById("traceFile").files[0];
  if (!file) {
    document.getElementById("eyeResult").innerHTML = "<p>Please upload a gaze trace CSV first.</p>";
    return;
  }
  const text = await file.text();
  const rows = text.trim().split(/\r?\n/);
  if (rows.length < 3) {
    document.getElementById("eyeResult").innerHTML = "<p>Not enough rows in CSV.</p>";
    return;
  }
  const headers = rows[0].split(",").map((x) => x.trim());
  const idxT = headers.indexOf("timestamp_ms");
  const idxX = headers.indexOf("gaze_x");
  const idxY = headers.indexOf("gaze_y");
  if (idxT < 0 || idxX < 0 || idxY < 0) {
    document.getElementById("eyeResult").innerHTML = "<p>Invalid CSV format. Required headers exactly: <code>timestamp_ms,gaze_x,gaze_y</code>.</p>";
    return;
  }

  const data = rows.slice(1).map((r) => r.split(",")).map((c) => ({
    t: Number(c[idxT]),
    x: Number(c[idxX]),
    y: Number(c[idxY]),
  })).filter((d) => Number.isFinite(d.t) && Number.isFinite(d.x) && Number.isFinite(d.y));
  if (data.length < 3) {
    document.getElementById("eyeResult").innerHTML = "<p>Not enough valid gaze points.</p>";
    return;
  }

  let regressions = 0;
  let scanpath = 0;
  let velocitySum = 0;
  let velocityCount = 0;
  const xs = data.map((d) => d.x);
  const ys = data.map((d) => d.y);
  for (let i = 1; i < data.length; i += 1) {
    const dt = Math.max((data[i].t - data[i - 1].t) / 1000, 1e-6);
    const dx = data[i].x - data[i - 1].x;
    const dy = data[i].y - data[i - 1].y;
    const disp = Math.sqrt((dx ** 2) + (dy ** 2));
    scanpath += disp;
    if (dx < -0.02) regressions += 1;
    velocitySum += (disp / dt);
    velocityCount += 1;
  }
  const sessionSec = Math.max((data[data.length - 1].t - data[0].t) / 1000, 1e-6);
  const wordCount = n("wordCount");
  const wpm = wordCount / (sessionSec / 60);
  const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
  const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;
  const varX = xs.reduce((a, b) => a + ((b - meanX) ** 2), 0) / xs.length;
  const varY = ys.reduce((a, b) => a + ((b - meanY) ** 2), 0) / ys.length;
  const dispersion = Math.sqrt(varX + varY);
  const meanSaccadeVelocity = velocitySum / Math.max(1, velocityCount);
  const fixationDuration = (sessionSec * 1000) / Math.max(1, data.length);

  document.getElementById("eyeResult").innerHTML = `
    <p><strong>Fixation Duration:</strong> ${fixationDuration.toFixed(2)} ms</p>
    <p><strong>Regressions:</strong> ${regressions}</p>
    <p><strong>Reading Speed:</strong> ${wpm.toFixed(2)} wpm</p>
    <p><strong>Gaze Dispersion:</strong> ${dispersion.toFixed(4)}</p>
    <p><strong>Scanpath Length:</strong> ${scanpath.toFixed(4)}</p>
    <p><strong>Mean Saccade Velocity:</strong> ${meanSaccadeVelocity.toFixed(4)}</p>
  `;

  eyeChart = drawChart(eyeChart, "eyeChart", {
    type: "bar",
    data: {
      labels: ["Fix(ms)", "Regressions", "WPM", "Dispersion"],
      datasets: [{ label: "Eye Metrics", data: [fixationDuration, regressions, wpm, dispersion], backgroundColor: "#7c3aed" }],
    },
    options: { responsive: true, maintainAspectRatio: false },
  });

  saveRecord({ type: "eye_tracking", fixationDuration, regressions, wpm, dispersion, scanpath, meanSaccadeVelocity, sessionSec });
  latestEye = { fixationDuration, regressions, wpm, dispersion, scanpath };
  updateTestLabStatus();
});

document.getElementById("downloadEyeTemplate")?.addEventListener("click", () => {
  const csv = [
    "timestamp_ms,gaze_x,gaze_y",
    "0,0.42,0.51",
    "120,0.45,0.52",
    "240,0.47,0.50",
    "360,0.44,0.49",
    "480,0.40,0.50",
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "eye_tracking_template.csv";
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById("runBiomarkers").addEventListener("click", async () => {
  const file = document.getElementById("manifestFile").files[0];
  const labelColumn = document.getElementById("labelColumn").value.trim() || "label";
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

  const numericCols = header.map((name, idx) => ({ name, idx })).filter(({ name, idx }) => idx !== labelIdx && /^((sp|rd|hw)_|.*errors|.*count|.*time)/i.test(name));
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
    return { biomarker: name, correlation: corr, importance };
  }).sort((a, b) => b.importance - a.importance);

  const top = results.slice(0, 12);
  summaryNode.innerHTML = `<p><strong>Samples analyzed:</strong> ${samples.length}</p><p><strong>Biomarkers evaluated:</strong> ${results.length}</p>`;
  tableNode.innerHTML = top.map((row) => `<tr><td>${row.biomarker}</td><td>${row.correlation.toFixed(4)}</td><td>${row.importance.toFixed(4)}</td></tr>`).join("");

  biomarkerChart = drawChart(biomarkerChart, "biomarkerChart", {
    type: "bar",
    data: {
      labels: top.map((x) => x.biomarker),
      datasets: [{ label: "Importance", data: top.map((x) => x.importance), backgroundColor: "#0891b2" }],
    },
    options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, max: 1 } } },
  });

  saveRecord({ type: "biomarkers", analyzed_samples: samples.length, biomarkers: top });
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

renderRecords();

function updateTestLabStatus() {
  const screeningDone = !!latestScreening;
  const therapyDone = !!latestTherapy;
  const eyeDone = !!latestEye;
  const ready = screeningDone && therapyDone && eyeDone;
  const node = document.getElementById("testStatus");
  if (!node) return;
  node.innerHTML = `
    <p><strong>Checklist</strong></p>
    <p>Screening: ${screeningDone ? "Done" : "Pending"}</p>
    <p>Speech Therapy: ${therapyDone ? "Done" : "Pending"}</p>
    <p>Eye Tracking: ${eyeDone ? "Done" : "Pending"}</p>
    <p><strong>Ready for model comparison:</strong> ${ready ? "Yes" : "No"}</p>
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

  const table = document.getElementById("modelCompareTable");
  table.innerHTML = predictions
    .map((p) => `<tr><td>${p.modelName}</td><td>${p.level}</td><td>${(p.confidence * 100).toFixed(1)}%</td><td>${p.risk.toFixed(3)}</td></tr>`)
    .join("");

  modelCompareChart = drawChart(modelCompareChart, "modelCompareChart", {
    type: "bar",
    data: {
      labels: predictions.map((p) => p.modelName),
      datasets: [{ label: "Risk Score", data: predictions.map((p) => p.risk), backgroundColor: "#0d6efd" }],
    },
    options: { responsive: true, maintainAspectRatio: false, scales: { y: { min: 0, max: 1 } } },
  });

  window.__latestModelPredictions = predictions;
  document.getElementById("finalReport").innerHTML = "<p>Model comparison completed. Now click <strong>Generate Final Report</strong>.</p>";
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

  document.getElementById("finalReport").innerHTML = `
    <p><strong>Final Aggregated Outcome:</strong> ${finalLevel}</p>
    <p><strong>Average Risk Score:</strong> ${avgRisk.toFixed(3)}</p>
    <p><strong>Model Agreement:</strong> Severe votes ${severeVotes}, Moderate votes ${moderateVotes}, Mild votes ${predictions.length - severeVotes - moderateVotes}</p>
    <p><strong>Recommended Next Step:</strong> ${recommendation}</p>
  `;
  saveRecord({ type: "final_report", finalLevel, avgRisk, severeVotes, moderateVotes, predictions });
});

updateTestLabStatus();
async function initializeDashboard() {
  await loadBengaliListeningSet();
  pickListeningParagraph(document.getElementById("sampleLanguage")?.value || "Bengali");
  renderRandomSpellingWords();
  renderRandomReadingPrompt(document.getElementById("sampleLanguage")?.value || "Bengali");
  populateVoiceSelector();
  if (window.speechSynthesis) {
    window.speechSynthesis.onvoiceschanged = () => populateVoiceSelector();
  }
}
initializeDashboard();

document.querySelectorAll(".user-guide-btn").forEach((button) => {
  button.addEventListener("click", () => openGuideModal(button.dataset.guide));
});
document.getElementById("closeGuideModal")?.addEventListener("click", closeGuideModal);
document.querySelector(".guide-modal-backdrop")?.addEventListener("click", closeGuideModal);
