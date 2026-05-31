const nav = [...document.querySelectorAll("#dashboard-tabs .nav-link")];
const panels = [...document.querySelectorAll(".panel")];
nav.forEach((n) => n.addEventListener("click", () => {
  nav.forEach((x) => x.classList.remove("active"));
  panels.forEach((p) => p.classList.remove("active"));
  n.classList.add("active");
  document.getElementById(n.dataset.target).classList.add("active");
}));

const val = (id) => document.getElementById(id).value;
let screeningChart;
let therapyGauge;
let eyeChart;
let biomarkerChart;

function renderBarChart(instance, canvasId, labels, values, label, color = "#2563eb") {
  const ctx = document.getElementById(canvasId);
  if (instance) instance.destroy();
  return new Chart(ctx, {
    type: "bar",
    data: { labels, datasets: [{ label, data: values, backgroundColor: color }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } },
  });
}

function renderDonut(instance, canvasId, labels, values) {
  const ctx = document.getElementById(canvasId);
  if (instance) instance.destroy();
  return new Chart(ctx, {
    type: "doughnut",
    data: { labels, datasets: [{ data: values, backgroundColor: ["#22c55e", "#f59e0b", "#ef4444"] }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: "65%" },
  });
}

document.getElementById("runScreening").addEventListener("click", async () => {
  const payload = {
    sample_language: val("sampleLanguage"),
    model_text_language: val("modelLanguage"),
    text_sample: val("textSample"),
    spelling_errors: Number(val("spellingErrors")),
    pronunciation_errors: Number(val("pronunciationErrors")),
    reading_time_seconds: Number(val("readingTime")),
    hesitation_count: Number(val("hesitations")),
    repetition_count: Number(val("repetitions")),
    omission_count: Number(val("omissions")),
  };
  const out = document.getElementById("screeningOut");
  out.textContent = "Running...";
  const resp = await fetch("/api/screen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const data = await resp.json();
  if (!resp.ok) {
    out.textContent = data.error || "Screening failed";
    return;
  }
  out.innerHTML = `
    <p><strong>Result:</strong> ${data.label} (${(data.confidence * 100).toFixed(1)}%)</p>
    <p><strong>Summary:</strong> ${data.explanation.summary}</p>
    <p><strong>Teacher:</strong> ${data.explanation.teacher}</p>
    <p><strong>Parent:</strong> ${data.explanation.parent}</p>
    <p><strong>Student:</strong> ${data.explanation.student}</p>
    <p><strong>Intervention:</strong> Reading: ${data.intervention.reading} | Pronunciation: ${data.intervention.pronunciation} | Spelling: ${data.intervention.spelling}</p>
    <p><strong>Weekly target:</strong> ${data.intervention.weekly_target_minutes} min</p>
  `;
  const p = data.probabilities || [];
  const labels = p.length === 3 ? ["Mild", "Moderate", "Severe"] : ["Low Risk", "Elevated Risk"];
  screeningChart = renderBarChart(screeningChart, "screeningChart", labels, p, "Probability", "#0d6efd");
});

document.getElementById("runTherapy").addEventListener("click", async () => {
  const payload = {
    duration_seconds: Number(val("tDuration")),
    pronunciation_errors: Number(val("tPron")),
    syllable_repetitions: Number(val("tRep")),
    sound_substitutions: Number(val("tSub")),
    attention_rating: Number(val("tAttn")),
  };
  const out = document.getElementById("therapyOut");
  out.textContent = "Scoring...";
  const resp = await fetch("/api/therapy/score", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const data = await resp.json();
  if (!resp.ok) {
    out.textContent = data.error || "Therapy scoring failed";
    return;
  }
  out.innerHTML = `<p><strong>Therapy score:</strong> ${(data.therapy_score * 100).toFixed(1)}%</p><p>${data.recommendation}</p><p><strong>Next level:</strong> ${data.next_level}</p>`;
  therapyGauge = renderDonut(therapyGauge, "therapyGauge", ["Completed", "Remaining"], [data.therapy_score * 100, 100 - data.therapy_score * 100]);
});

document.getElementById("runEye").addEventListener("click", async () => {
  const file = document.getElementById("traceFile").files[0];
  const out = document.getElementById("eyeOut");
  if (!file) {
    out.textContent = "Please choose a trace CSV file.";
    return;
  }
  const form = new FormData();
  form.append("trace_file", file);
  form.append("word_count", String(Number(val("wordCount"))));
  out.textContent = "Computing metrics...";
  const resp = await fetch("/api/eye/metrics", { method: "POST", body: form });
  const data = await resp.json();
  if (!resp.ok) {
    out.textContent = data.error || "Eye metrics failed";
    return;
  }
  out.innerHTML = `
    <p>Fixation duration: ${data.fixation_duration_ms.toFixed(2)} ms</p>
    <p>Regressions: ${data.regressions_count}</p>
    <p>Reading speed: ${data.reading_speed_wpm.toFixed(2)} wpm</p>
    <p>Gaze dispersion: ${data.gaze_dispersion.toFixed(4)}</p>
    <p>Scanpath length: ${data.scanpath_length.toFixed(4)}</p>
  `;
  eyeChart = renderBarChart(
    eyeChart,
    "eyeChart",
    ["Fix(ms)", "Regressions", "WPM", "Dispersion"],
    [data.fixation_duration_ms, data.regressions_count, data.reading_speed_wpm, data.gaze_dispersion],
    "Eye Metrics",
    "#7c3aed",
  );
});

document.getElementById("runBiomarkers").addEventListener("click", async () => {
  const out = document.getElementById("biomarkerOut");
  const tableWrap = document.getElementById("biomarkerTableWrap");
  out.textContent = "Running biomarker discovery...";
  tableWrap.innerHTML = "";
  const resp = await fetch("/api/biomarkers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ manifest_path: val("manifestPath") }),
  });
  const data = await resp.json();
  if (!resp.ok) {
    out.textContent = data.error || "Biomarker discovery failed";
    return;
  }
  out.textContent = `Analyzed ${data.rows} samples. Top biomarkers shown below.`;
  const rows = data.top_biomarkers || [];
  let html = "<table class='table table-sm'><thead><tr><th>Biomarker</th><th>Importance</th><th>Correlation</th></tr></thead><tbody>";
  for (const row of rows) {
    html += `<tr><td>${row.biomarker}</td><td>${Number(row.importance_score || 0).toFixed(4)}</td><td>${Number(row.label_correlation || 0).toFixed(4)}</td></tr>`;
  }
  html += "</tbody></table>";
  tableWrap.innerHTML = html;
  const top = rows.slice(0, 10);
  biomarkerChart = renderBarChart(
    biomarkerChart,
    "biomarkerChart",
    top.map((r) => r.biomarker.replace(/^.._/, "")),
    top.map((r) => Number(r.importance_score || 0)),
    "Importance",
    "#0891b2",
  );
});
