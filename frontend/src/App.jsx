import { useMemo, useState } from "react";
import { Bar, Doughnut } from "react-chartjs-2";
import {
  Chart as ChartJS,
  ArcElement,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
} from "chart.js";

ChartJS.register(ArcElement, BarElement, CategoryScale, LinearScale, Tooltip, Legend);

const tabs = ["screening", "therapy", "eye", "biomarkers"];
const API_BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");
const apiUrl = (path) => `${API_BASE}${path}`;

async function postJson(url, payload) {
  const res = await fetch(apiUrl(url), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

export function App() {
  const [tab, setTab] = useState("screening");
  const [screening, setScreening] = useState(null);
  const [therapy, setTherapy] = useState(null);
  const [eye, setEye] = useState(null);
  const [biomarkers, setBiomarkers] = useState(null);
  const [error, setError] = useState("");

  const [screenForm, setScreenForm] = useState({
    sample_language: "Bengali",
    model_text_language: "bengali",
    text_sample: "আমি বাংলা পড়ি",
    spelling_errors: 0,
    pronunciation_errors: 0,
    reading_time_seconds: 0,
    hesitation_count: 0,
    repetition_count: 0,
    omission_count: 0,
  });
  const [therapyForm, setTherapyForm] = useState({
    duration_seconds: 20,
    pronunciation_errors: 0,
    syllable_repetitions: 0,
    sound_substitutions: 0,
    attention_rating: 3,
  });
  const [manifestPath, setManifestPath] = useState("data/demo/audio_augmented_manifest.csv");
  const [wordCount, setWordCount] = useState(6);
  const [traceFile, setTraceFile] = useState(null);
  const [screenHandwriting, setScreenHandwriting] = useState(null);
  const [screenAudio, setScreenAudio] = useState(null);

  const screeningChart = useMemo(() => {
    if (!screening) return null;
    const p = screening.probabilities || [];
    const labels = p.length === 3 ? ["Mild", "Moderate", "Severe"] : ["Low", "Elevated"];
    return {
      labels,
      datasets: [{ label: "Probability", data: p, backgroundColor: "#0d6efd" }],
    };
  }, [screening]);

  const therapyChart = useMemo(() => {
    if (!therapy) return null;
    return {
      labels: ["Completed", "Remaining"],
      datasets: [{ data: [therapy.therapy_score * 100, 100 - therapy.therapy_score * 100], backgroundColor: ["#22c55e", "#e5e7eb"] }],
    };
  }, [therapy]);

  const eyeChart = useMemo(() => {
    if (!eye) return null;
    return {
      labels: ["Fix(ms)", "Reg", "WPM", "Disp"],
      datasets: [{ data: [eye.fixation_duration_ms, eye.regressions_count, eye.reading_speed_wpm, eye.gaze_dispersion], backgroundColor: "#7c3aed" }],
    };
  }, [eye]);

  const biomarkerChart = useMemo(() => {
    if (!biomarkers?.top_biomarkers) return null;
    const top = biomarkers.top_biomarkers.slice(0, 10);
    return {
      labels: top.map((x) => x.biomarker),
      datasets: [{ label: "Importance", data: top.map((x) => x.importance_score || 0), backgroundColor: "#0891b2" }],
    };
  }, [biomarkers]);

  return (
    <div className="app-shell">
      <nav className="navbar navbar-dark bg-primary px-3">
        <span className="navbar-brand mb-0 h1">Learning Disorder Intelligence</span>
      </nav>
      <div className="container-fluid py-3">
        <div className="row g-3">
          <aside className="col-12 col-lg-3 col-xl-2">
            <div className="card border-0 shadow-sm">
              <div className="card-body p-2 d-grid gap-1">
                {tabs.map((t) => (
                  <button key={t} className={`btn ${tab === t ? "btn-primary" : "btn-light text-start"}`} onClick={() => setTab(t)}>
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          </aside>
          <main className="col-12 col-lg-9 col-xl-10">
            {error && <div className="alert alert-danger">{error}</div>}

            {tab === "screening" && (
              <section className="card border-0 shadow-sm">
                <div className="card-body">
                  <h5>Screening + Explainability</h5>
                  <div className="row g-2">
                    <div className="col-md-4"><label className="form-label">Language</label><select className="form-select" value={screenForm.sample_language} onChange={(e) => setScreenForm({ ...screenForm, sample_language: e.target.value })}><option>Bengali</option><option>Hindi</option><option>English</option><option>Multilingual</option></select></div>
                    <div className="col-md-4"><label className="form-label">Model vocabulary</label><select className="form-select" value={screenForm.model_text_language} onChange={(e) => setScreenForm({ ...screenForm, model_text_language: e.target.value })}><option value="bengali">Bengali</option><option value="hindi">Hindi</option><option value="english">English</option><option value="multilingual">Multilingual</option></select></div>
                    <div className="col-md-4"><label className="form-label">Reading time (s)</label><input className="form-control" type="number" value={screenForm.reading_time_seconds} onChange={(e) => setScreenForm({ ...screenForm, reading_time_seconds: Number(e.target.value) })} /></div>
                    <div className="col-12"><label className="form-label">Text sample</label><textarea className="form-control" value={screenForm.text_sample} onChange={(e) => setScreenForm({ ...screenForm, text_sample: e.target.value })} /></div>
                    <div className="col-md-6"><label className="form-label">Handwriting image (png/jpg)</label><input className="form-control" type="file" accept=".png,.jpg,.jpeg" onChange={(e) => setScreenHandwriting(e.target.files?.[0] || null)} /></div>
                    <div className="col-md-6"><label className="form-label">Reading audio (wav)</label><input className="form-control" type="file" accept=".wav" onChange={(e) => setScreenAudio(e.target.files?.[0] || null)} /></div>
                    <div className="col-md-3"><label className="form-label">Spelling</label><input className="form-control" type="number" value={screenForm.spelling_errors} onChange={(e) => setScreenForm({ ...screenForm, spelling_errors: Number(e.target.value) })} /></div>
                    <div className="col-md-3"><label className="form-label">Pronunciation</label><input className="form-control" type="number" value={screenForm.pronunciation_errors} onChange={(e) => setScreenForm({ ...screenForm, pronunciation_errors: Number(e.target.value) })} /></div>
                    <div className="col-md-2"><label className="form-label">Hesitations</label><input className="form-control" type="number" value={screenForm.hesitation_count} onChange={(e) => setScreenForm({ ...screenForm, hesitation_count: Number(e.target.value) })} /></div>
                    <div className="col-md-2"><label className="form-label">Repetitions</label><input className="form-control" type="number" value={screenForm.repetition_count} onChange={(e) => setScreenForm({ ...screenForm, repetition_count: Number(e.target.value) })} /></div>
                    <div className="col-md-2"><label className="form-label">Omissions</label><input className="form-control" type="number" value={screenForm.omission_count} onChange={(e) => setScreenForm({ ...screenForm, omission_count: Number(e.target.value) })} /></div>
                  </div>
                  <button className="btn btn-primary mt-3" onClick={async () => {
                    try {
                      setError("");
                      const form = new FormData();
                      Object.entries(screenForm).forEach(([k, v]) => form.append(k, String(v)));
                      if (screenHandwriting) form.append("handwriting_file", screenHandwriting);
                      if (screenAudio) form.append("audio_file", screenAudio);
                      const res = await fetch(apiUrl("/api/screen"), { method: "POST", body: form });
                      const data = await res.json();
                      if (!res.ok) throw new Error(data.error || "Screening failed");
                      setScreening(data);
                    } catch (e) {
                      setError(e.message);
                    }
                  }}>Run Screening</button>
                  {screening && <div className="row g-3 mt-2"><div className="col-xl-6"><div className="result-box"><p><strong>{screening.label}</strong> ({(screening.confidence * 100).toFixed(1)}%)</p><p>{screening.explanation.summary}</p></div></div><div className="col-xl-6 chart-box">{screeningChart && <Bar data={screeningChart} options={{ responsive: true, maintainAspectRatio: false }} />}</div></div>}
                </div>
              </section>
            )}

            {tab === "therapy" && (
              <section className="card border-0 shadow-sm"><div className="card-body"><h5>Speech Therapy</h5>
                <div className="row g-2">
                  {Object.keys(therapyForm).map((k) => <div key={k} className="col-md-4"><label className="form-label">{k}</label><input className="form-control" type="number" value={therapyForm[k]} onChange={(e) => setTherapyForm({ ...therapyForm, [k]: Number(e.target.value) })} /></div>)}
                </div>
                <button className="btn btn-primary mt-3" onClick={async () => { try { setError(""); setTherapy(await postJson("/api/therapy/score", therapyForm)); } catch (e) { setError(e.message); } }}>Score Session</button>
                {therapy && <div className="row g-3 mt-2"><div className="col-xl-6"><div className="result-box"><p><strong>Score:</strong> {(therapy.therapy_score * 100).toFixed(1)}%</p><p>{therapy.recommendation}</p></div></div><div className="col-xl-6 chart-box">{therapyChart && <Doughnut data={therapyChart} options={{ responsive: true, maintainAspectRatio: false }} />}</div></div>}
              </div></section>
            )}

            {tab === "eye" && (
              <section className="card border-0 shadow-sm"><div className="card-body"><h5>Eye Tracking</h5>
                <div className="row g-2">
                  <div className="col-md-4"><label className="form-label">Word count</label><input className="form-control" type="number" value={wordCount} onChange={(e) => setWordCount(Number(e.target.value))} /></div>
                  <div className="col-md-8"><label className="form-label">Trace CSV</label><input className="form-control" type="file" accept=".csv" onChange={(e) => setTraceFile(e.target.files?.[0] || null)} /></div>
                </div>
                <button className="btn btn-primary mt-3" onClick={async () => {
                  try {
                    setError("");
                    if (!traceFile) throw new Error("Please select a trace CSV file.");
                    const form = new FormData();
                    form.append("trace_file", traceFile);
                    form.append("word_count", String(wordCount));
                    const res = await fetch(apiUrl("/api/eye/metrics"), { method: "POST", body: form });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error || "Eye metrics failed");
                    setEye(data);
                  } catch (e) { setError(e.message); }
                }}>Compute Metrics</button>
                {eye && <div className="row g-3 mt-2"><div className="col-xl-6"><div className="result-box"><p><strong>WPM:</strong> {eye.reading_speed_wpm?.toFixed(2)}</p><p><strong>Regressions:</strong> {eye.regressions_count}</p></div></div><div className="col-xl-6 chart-box">{eyeChart && <Bar data={eyeChart} options={{ responsive: true, maintainAspectRatio: false }} />}</div></div>}
              </div></section>
            )}

            {tab === "biomarkers" && (
              <section className="card border-0 shadow-sm"><div className="card-body"><h5>Biomarkers</h5>
                <label className="form-label">Manifest path</label>
                <input className="form-control" value={manifestPath} onChange={(e) => setManifestPath(e.target.value)} />
                <button className="btn btn-primary mt-3" onClick={async () => { try { setError(""); setBiomarkers(await postJson("/api/biomarkers", { manifest_path: manifestPath })); } catch (e) { setError(e.message); } }}>Discover Biomarkers</button>
                {biomarkers && <div className="row g-3 mt-2"><div className="col-xl-6 chart-box">{biomarkerChart && <Bar data={biomarkerChart} options={{ responsive: true, maintainAspectRatio: false }} />}</div><div className="col-xl-6"><div className="table-responsive"><table className="table table-sm"><thead><tr><th>Biomarker</th><th>Importance</th></tr></thead><tbody>{biomarkers.top_biomarkers?.slice(0, 10).map((b) => <tr key={b.biomarker}><td>{b.biomarker}</td><td>{Number(b.importance_score || 0).toFixed(4)}</td></tr>)}</tbody></table></div></div></div>}
              </div></section>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
