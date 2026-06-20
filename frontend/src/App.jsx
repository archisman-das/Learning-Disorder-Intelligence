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

const tabs = ["screening", "therapy", "eye", "biomarkers", "report"];
const API_BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");
const apiUrl = (path) => `${API_BASE}${path}`;

const emptyStudentInfo = {
  studentName: "",
  age: "",
  studentClass: "",
  rollNo: "",
  section: "",
  schoolName: "",
};

const studentFieldLabels = {
  studentName: "Student Name",
  age: "Age",
  studentClass: "Class",
  rollNo: "Roll No",
  section: "Section",
  schoolName: "School Name",
};

function formatPercent(value) {
  if (!Number.isFinite(value)) return "N/A";
  return `${(value * 100).toFixed(1)}%`;
}

function getMissingStudentFields(studentInfo) {
  return Object.entries(studentFieldLabels)
    .filter(([key]) => !String(studentInfo[key] || "").trim())
    .map(([, label]) => label);
}

function escapePdfText(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function createPdfBlob(lines) {
  const pageWidth = 612;
  const pageHeight = 792;
  const startX = 50;
  const startY = 750;
  const lineHeight = 16;
  const maxLinesPerPage = 42;
  const pages = [];

  for (let i = 0; i < lines.length; i += maxLinesPerPage) {
    pages.push(lines.slice(i, i + maxLinesPerPage));
  }

  const objects = [];
  const addObject = (content) => {
    objects.push(content);
    return objects.length;
  };

  const pageObjectIds = [];
  const contentObjectIds = [];

  const catalogId = addObject("<< /Type /Catalog /Pages 2 0 R >>");
  const pagesId = addObject("<< /Type /Pages /Count 0 /Kids [] >>");
  const fontId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  pages.forEach((pageLines) => {
    const streamLines = [
      "BT",
      "/F1 11 Tf",
      `${lineHeight} TL`,
      `${startX} ${startY} Td`,
    ];

    pageLines.forEach((line, index) => {
      if (index > 0) streamLines.push("T*");
      streamLines.push(`(${escapePdfText(line)}) Tj`);
    });

    streamLines.push("ET");
    const stream = streamLines.join("\n");
    const contentId = addObject(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    contentObjectIds.push(contentId);

    const pageId = addObject(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`
    );
    pageObjectIds.push(pageId);
  });

  objects[pagesId - 1] = `<< /Type /Pages /Count ${pageObjectIds.length} /Kids [${pageObjectIds
    .map((id) => `${id} 0 R`)
    .join(" ")}] >>`;

  let pdf = "%PDF-1.4\n";
  const offsets = [0];

  objects.forEach((content, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${content}\nendobj\n`;
  });

  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return new Blob([pdf], { type: "application/pdf" });
}

function downloadReportPdf(report) {
  const lines = [
    "Learning Disorder Intelligence - Final Report",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "Student Details",
    `Student Name: ${report.studentInfo.studentName}`,
    `Age: ${report.studentInfo.age}`,
    `Class: ${report.studentInfo.studentClass}`,
    `Roll No: ${report.studentInfo.rollNo}`,
    `Section: ${report.studentInfo.section}`,
    `School Name: ${report.studentInfo.schoolName}`,
    "",
    "Overview",
    ...report.overview,
    "",
  ];

  report.sections.forEach((section) => {
    lines.push(section.title);
    section.lines.forEach((line) => lines.push(line));
    lines.push("");
  });

  lines.push("Recommended Next Steps");
  report.recommendations.forEach((line) => lines.push(line));

  const blob = createPdfBlob(lines);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${(report.studentInfo.studentName || "student").replace(/\s+/g, "_")}_report.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

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

async function postFormData(url, formData) {
  const res = await fetch(apiUrl(url), { method: "POST", body: formData });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

async function getComparisonPayload() {
  const response = await postJson("/api/comparison", {
    screening,
    therapy,
    eye,
    language: "English",
  });
  return response;
}

async function getScreeningPayload() {
  const form = new FormData();
  Object.entries(screenForm).forEach(([k, v]) => form.append(k, String(v)));
  if (screenHandwriting) form.append("handwriting_file", screenHandwriting);
  if (screenAudio) form.append("audio_file", screenAudio);
  return postFormData("/api/screen", form);
}

async function getFinalReportPayload({ studentInfo, screening, therapy, eye, biomarkers, comparison }) {
  return postJson("/api/final-report", {
    studentInfo,
    screening,
    therapy,
    eye,
    biomarkers,
    comparison,
    language: "English",
  });
}

export function App() {
  const [tab, setTab] = useState("screening");
  const [screening, setScreening] = useState(null);
  const [therapy, setTherapy] = useState(null);
  const [eye, setEye] = useState(null);
  const [biomarkers, setBiomarkers] = useState(null);
  const [error, setError] = useState("");
  const [reportData, setReportData] = useState(null);
  const [studentInfo, setStudentInfo] = useState(emptyStudentInfo);

  const [screenForm, setScreenForm] = useState({
    sample_language: "Bengali",
    model_text_language: "bengali",
    text_sample: "à¦†à¦®à¦¿ à¦¬à¦¾à¦‚à¦²à¦¾ à¦ªà§œà¦¿",
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
      datasets: [
        {
          data: [therapy.therapy_score * 100, 100 - therapy.therapy_score * 100],
          backgroundColor: ["#22c55e", "#e5e7eb"],
        },
      ],
    };
  }, [therapy]);

  const eyeChart = useMemo(() => {
    if (!eye) return null;
    return {
      labels: ["Fix(ms)", "Reg", "WPM", "Disp"],
      datasets: [
        {
          data: [
            eye.fixation_duration_ms,
            eye.regressions_count,
            eye.reading_speed_wpm,
            eye.gaze_dispersion,
          ],
          backgroundColor: "#7c3aed",
        },
      ],
    };
  }, [eye]);

  const biomarkerChart = useMemo(() => {
    if (!biomarkers?.top_biomarkers) return null;
    const top = biomarkers.top_biomarkers.slice(0, 10);
    return {
      labels: top.map((x) => x.biomarker),
      datasets: [
        {
          label: "Importance",
          data: top.map((x) => x.importance_score || 0),
          backgroundColor: "#0891b2",
        },
      ],
    };
  }, [biomarkers]);

  const missingStudentFields = getMissingStudentFields(studentInfo);
  const hasAnyResult = Boolean(screening || therapy || eye || biomarkers);

  const handleGenerateReport = async () => {
    if (missingStudentFields.length) {
      setError(`Please fill: ${missingStudentFields.join(", ")}`);
      setTab("report");
      return;
    }
    if (!hasAnyResult) {
      setError("Please complete at least one test before generating the report.");
      setTab("report");
      return;
    }
    try {
      setError("");
      setReportData(await getFinalReportPayload({ studentInfo, screening, therapy, eye, biomarkers, comparison: null }));
    } catch (e) {
      setError(e.message);
    }
  };

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
                  <button
                    key={t}
                    className={`btn ${tab === t ? "btn-primary" : "btn-light text-start"}`}
                    onClick={() => setTab(t)}
                  >
                    {t === "eye" ? "Eye Tracking" : t.charAt(0).toUpperCase() + t.slice(1)}
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
                    <div className="col-md-4">
                      <label className="form-label">Language</label>
                      <select
                        className="form-select"
                        value={screenForm.sample_language}
                        onChange={(e) => setScreenForm({ ...screenForm, sample_language: e.target.value })}
                      >
                        <option>Bengali</option>
                        <option>English</option>
                        <option>Multilingual</option>
                      </select>
                    </div>
                    <div className="col-md-4">
                      <label className="form-label">Model vocabulary</label>
                      <select
                        className="form-select"
                        value={screenForm.model_text_language}
                        onChange={(e) =>
                          setScreenForm({ ...screenForm, model_text_language: e.target.value })
                        }
                      >
                        <option value="bengali">Bengali</option>
                        <option value="english">English</option>
                        <option value="multilingual">Multilingual</option>
                      </select>
                    </div>
                    <div className="col-md-4">
                      <label className="form-label">Reading time (s)</label>
                      <input
                        className="form-control"
                        type="number"
                        value={screenForm.reading_time_seconds}
                        onChange={(e) =>
                          setScreenForm({
                            ...screenForm,
                            reading_time_seconds: Number(e.target.value),
                          })
                        }
                      />
                    </div>
                    <div className="col-12">
                      <label className="form-label">Text sample</label>
                      <textarea
                        className="form-control"
                        value={screenForm.text_sample}
                        onChange={(e) => setScreenForm({ ...screenForm, text_sample: e.target.value })}
                      />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label">Handwriting image (png/jpg)</label>
                      <input
                        className="form-control"
                        type="file"
                        accept=".png,.jpg,.jpeg"
                        onChange={(e) => setScreenHandwriting(e.target.files?.[0] || null)}
                      />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label">Reading audio (wav)</label>
                      <input
                        className="form-control"
                        type="file"
                        accept=".wav"
                        onChange={(e) => setScreenAudio(e.target.files?.[0] || null)}
                      />
                    </div>
                    <div className="col-md-3">
                      <label className="form-label">Spelling</label>
                      <input
                        className="form-control"
                        type="number"
                        value={screenForm.spelling_errors}
                        onChange={(e) =>
                          setScreenForm({ ...screenForm, spelling_errors: Number(e.target.value) })
                        }
                      />
                    </div>
                    <div className="col-md-3">
                      <label className="form-label">Pronunciation</label>
                      <input
                        className="form-control"
                        type="number"
                        value={screenForm.pronunciation_errors}
                        onChange={(e) =>
                          setScreenForm({
                            ...screenForm,
                            pronunciation_errors: Number(e.target.value),
                          })
                        }
                      />
                    </div>
                    <div className="col-md-2">
                      <label className="form-label">Hesitations</label>
                      <input
                        className="form-control"
                        type="number"
                        value={screenForm.hesitation_count}
                        onChange={(e) =>
                          setScreenForm({ ...screenForm, hesitation_count: Number(e.target.value) })
                        }
                      />
                    </div>
                    <div className="col-md-2">
                      <label className="form-label">Repetitions</label>
                      <input
                        className="form-control"
                        type="number"
                        value={screenForm.repetition_count}
                        onChange={(e) =>
                          setScreenForm({ ...screenForm, repetition_count: Number(e.target.value) })
                        }
                      />
                    </div>
                    <div className="col-md-2">
                      <label className="form-label">Omissions</label>
                      <input
                        className="form-control"
                        type="number"
                        value={screenForm.omission_count}
                        onChange={(e) =>
                          setScreenForm({ ...screenForm, omission_count: Number(e.target.value) })
                        }
                      />
                    </div>
                  </div>
                  <button
                    className="btn btn-primary mt-3"
                    onClick={async () => {
                      try {
                        setError("");
                        setScreening(await getScreeningPayload());
                      } catch (e) {
                        setError(e.message);
                      }
                    }}
                  >
                    Run Screening
                  </button>
                  {screening && (
                    <div className="row g-3 mt-2">
                      <div className="col-xl-6">
                        <div className="result-box">
                          <p>
                            <strong>{screening.label}</strong> ({(screening.confidence * 100).toFixed(1)}%)
                          </p>
                          <p>{screening.explanation.summary}</p>
                        </div>
                      </div>
                      <div className="col-xl-6 chart-box">
                        {screeningChart && (
                          <Bar data={screeningChart} options={{ responsive: true, maintainAspectRatio: false }} />
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </section>
            )}

            {tab === "therapy" && (
              <section className="card border-0 shadow-sm">
                <div className="card-body">
                  <h5>Speech Therapy</h5>
                  <div className="row g-2">
                    {Object.keys(therapyForm).map((k) => (
                      <div key={k} className="col-md-4">
                        <label className="form-label">{k}</label>
                        <input
                          className="form-control"
                          type="number"
                          value={therapyForm[k]}
                          onChange={(e) =>
                            setTherapyForm({ ...therapyForm, [k]: Number(e.target.value) })
                          }
                        />
                      </div>
                    ))}
                  </div>
                  <button
                    className="btn btn-primary mt-3"
                    onClick={async () => {
                      try {
                        setError("");
                        setTherapy(await postJson("/api/therapy/score", therapyForm));
                      } catch (e) {
                        setError(e.message);
                      }
                    }}
                  >
                    Score Session
                  </button>
                  {therapy && (
                    <div className="row g-3 mt-2">
                      <div className="col-xl-6">
                        <div className="result-box">
                          <p>
                            <strong>Score:</strong> {(therapy.therapy_score * 100).toFixed(1)}%
                          </p>
                          <p>{therapy.recommendation}</p>
                        </div>
                      </div>
                      <div className="col-xl-6 chart-box">
                        {therapyChart && (
                          <Doughnut data={therapyChart} options={{ responsive: true, maintainAspectRatio: false }} />
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </section>
            )}

            {tab === "eye" && (
              <section className="card border-0 shadow-sm">
                <div className="card-body">
                  <h5>Eye Tracking</h5>
                  <div className="row g-2">
                    <div className="col-md-4">
                      <label className="form-label">Word count</label>
                      <input
                        className="form-control"
                        type="number"
                        value={wordCount}
                        onChange={(e) => setWordCount(Number(e.target.value))}
                      />
                    </div>
                    <div className="col-md-8">
                      <label className="form-label">Trace CSV</label>
                      <input
                        className="form-control"
                        type="file"
                        accept=".csv"
                        onChange={(e) => setTraceFile(e.target.files?.[0] || null)}
                      />
                    </div>
                  </div>
                  <button
                    className="btn btn-primary mt-3"
                    onClick={async () => {
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
                      } catch (e) {
                        setError(e.message);
                      }
                    }}
                  >
                    Compute Metrics
                  </button>
                  {eye && (
                    <div className="row g-3 mt-2">
                      <div className="col-xl-6">
                        <div className="result-box">
                          <p>
                            <strong>WPM:</strong> {eye.reading_speed_wpm?.toFixed(2)}
                          </p>
                          <p>
                            <strong>Regressions:</strong> {eye.regressions_count}
                          </p>
                        </div>
                      </div>
                      <div className="col-xl-6 chart-box">
                        {eyeChart && (
                          <Bar data={eyeChart} options={{ responsive: true, maintainAspectRatio: false }} />
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </section>
            )}

            {tab === "biomarkers" && (
              <section className="card border-0 shadow-sm">
                <div className="card-body">
                  <h5>Biomarkers</h5>
                  <label className="form-label">Manifest path</label>
                  <input
                    className="form-control"
                    value={manifestPath}
                    onChange={(e) => setManifestPath(e.target.value)}
                  />
                  <button
                    className="btn btn-primary mt-3"
                    onClick={async () => {
                      try {
                        setError("");
                        setBiomarkers(await postJson("/api/biomarkers", { manifest_path: manifestPath }));
                      } catch (e) {
                        setError(e.message);
                      }
                    }}
                  >
                    Discover Biomarkers
                  </button>
                  {biomarkers && (
                    <div className="row g-3 mt-2">
                      <div className="col-xl-6 chart-box">
                        {biomarkerChart && (
                          <Bar data={biomarkerChart} options={{ responsive: true, maintainAspectRatio: false }} />
                        )}
                      </div>
                      <div className="col-xl-6">
                        <div className="table-responsive">
                          <table className="table table-sm">
                            <thead>
                              <tr>
                                <th>Biomarker</th>
                                <th>Importance</th>
                              </tr>
                            </thead>
                            <tbody>
                              {biomarkers.top_biomarkers?.slice(0, 10).map((b) => (
                                <tr key={b.biomarker}>
                                  <td>{b.biomarker}</td>
                                  <td>{Number(b.importance_score || 0).toFixed(4)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </section>
            )}

            {tab === "report" && (
              <section className="card border-0 shadow-sm">
                <div className="card-body">
                  <div className="d-flex flex-column flex-lg-row justify-content-between align-items-lg-center gap-3">
                    <div>
                      <h5 className="mb-1">Final Report</h5>
                      <p className="text-muted mb-0">
                        Fill the student details here before generating the report. These same details
                        will be included automatically in the PDF.
                      </p>
                    </div>
                    <div className="d-flex flex-wrap gap-2">
                      <button className="btn btn-primary" onClick={handleGenerateReport}>
                        Generate Final Report
                      </button>
                      <button
                        className="btn btn-outline-primary"
                        disabled={!reportData}
                        onClick={() => downloadReportPdf(reportData)}
                      >
                        Download Report PDF
                      </button>
                    </div>
                  </div>

                  <div className="report-card mt-4">
                    <h6 className="mb-3">Student Report Details</h6>
                    <div className="row g-3">
                      <div className="col-md-4">
                        <label className="form-label">Student Name</label>
                        <input
                          className="form-control"
                          value={studentInfo.studentName}
                          onChange={(e) => setStudentInfo({ ...studentInfo, studentName: e.target.value })}
                        />
                      </div>
                      <div className="col-md-2">
                        <label className="form-label">Age</label>
                        <input
                          className="form-control"
                          value={studentInfo.age}
                          onChange={(e) => setStudentInfo({ ...studentInfo, age: e.target.value })}
                        />
                      </div>
                      <div className="col-md-2">
                        <label className="form-label">Class</label>
                        <input
                          className="form-control"
                          value={studentInfo.studentClass}
                          onChange={(e) => setStudentInfo({ ...studentInfo, studentClass: e.target.value })}
                        />
                      </div>
                      <div className="col-md-2">
                        <label className="form-label">Roll No</label>
                        <input
                          className="form-control"
                          value={studentInfo.rollNo}
                          onChange={(e) => setStudentInfo({ ...studentInfo, rollNo: e.target.value })}
                        />
                      </div>
                      <div className="col-md-2">
                        <label className="form-label">Section</label>
                        <input
                          className="form-control"
                          value={studentInfo.section}
                          onChange={(e) => setStudentInfo({ ...studentInfo, section: e.target.value })}
                        />
                      </div>
                      <div className="col-md-6">
                        <label className="form-label">School Name</label>
                        <input
                          className="form-control"
                          value={studentInfo.schoolName}
                          onChange={(e) => setStudentInfo({ ...studentInfo, schoolName: e.target.value })}
                        />
                      </div>
                    </div>
                    <div className="report-note mt-3">
                      {missingStudentFields.length
                        ? `Please fill these fields before generating the report: ${missingStudentFields.join(", ")}.`
                        : "Student details are ready. Now generate the final report and download the PDF."}
                    </div>
                  </div>

                  <div className="row g-3 mt-1">
                    <div className="col-xl-4">
                      <div className="report-card h-100">
                        <h6 className="mb-3">Current Test Status</h6>
                        <div className="report-status-list">
                          <div className={`status-pill ${screening ? "done" : ""}`}>
                            Screening: {screening ? "Completed" : "Pending"}
                          </div>
                          <div className={`status-pill ${therapy ? "done" : ""}`}>
                            Speech Therapy: {therapy ? "Completed" : "Pending"}
                          </div>
                          <div className={`status-pill ${eye ? "done" : ""}`}>
                            Eye Tracking: {eye ? "Completed" : "Pending"}
                          </div>
                          <div className={`status-pill ${biomarkers ? "done" : ""}`}>
                            Biomarkers: {biomarkers ? "Completed" : "Pending"}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="col-xl-8">
                      <div className="report-card h-100">
                        <h6 className="mb-3">Report Preview</h6>
                        {!reportData ? (
                          <div className="text-muted">
                            The report preview will appear here after you fill the student details and
                            click <strong>Generate Final Report</strong>.
                          </div>
                        ) : (
                          <div className="report-preview">
                            <div className="report-preview-block">
                              <strong>Student Name:</strong> {reportData.studentInfo.studentName}
                            </div>
                            <div className="report-preview-grid">
                              <div>
                                <strong>Age:</strong> {reportData.studentInfo.age}
                              </div>
                              <div>
                                <strong>Class:</strong> {reportData.studentInfo.studentClass}
                              </div>
                              <div>
                                <strong>Roll No:</strong> {reportData.studentInfo.rollNo}
                              </div>
                              <div>
                                <strong>Section:</strong> {reportData.studentInfo.section}
                              </div>
                              <div className="full-row">
                                <strong>School Name:</strong> {reportData.studentInfo.schoolName}
                              </div>
                            </div>

                            <div className="report-preview-block">
                              <strong>Generated:</strong> {reportData.generatedAt}
                            </div>

                            <div className="report-preview-block">
                              <strong>Overview</strong>
                              <ul className="report-list">
                                {reportData.overview.map((item) => (
                                  <li key={item}>{item}</li>
                                ))}
                              </ul>
                            </div>

                            {reportData.sections.map((section) => (
                              <div className="report-preview-block" key={section.title}>
                                <strong>{section.title}</strong>
                                <ul className="report-list">
                                  {section.lines.map((line) => (
                                    <li key={line}>{line}</li>
                                  ))}
                                </ul>
                              </div>
                            ))}

                            <div className="report-preview-block">
                              <strong>Recommended Next Steps</strong>
                              <ul className="report-list">
                                {reportData.recommendations.map((item) => (
                                  <li key={item}>{item}</li>
                                ))}
                              </ul>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
