"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ChangeEvent, type MouseEvent } from "react";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { addDoc, collection, doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import * as XLSX from "xlsx";
import { confidenceOptions, emptyTrainingRecord, newPier, newRebar, newSegment, type Confidence, type CropRef, type PierItem, type RebarItem, type TrainingRecord } from "@/lib/schema";

const OWNER_EMAIL = "vdumpa972@gmail.com";

type PdfDocument = { numPages: number; getPage: (n: number) => Promise<PdfPage> };
type PdfPage = { getViewport: (args: { scale: number }) => { width: number; height: number }; render: (args: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => { promise: Promise<void> } };
type Selection = { x: number; y: number; width: number; height: number } | null;

function asFileFromDataUrl(dataUrl: string, filename: string) {
  const [header, data] = dataUrl.split(",");
  const mime = header.match(/data:(.*);base64/)?.[1] || "image/png";
  const bytes = atob(data);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) arr[i] = bytes.charCodeAt(i);
  return new File([arr], filename, { type: mime });
}

function downloadJson(record: TrainingRecord) {
  const blob = new Blob([JSON.stringify(record, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `${record.projectName || "training-record"}.json`; a.click();
  URL.revokeObjectURL(url);
}

function exportExcel(record: TrainingRecord) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ ...record, crops: record.crops.length, foundationSegments: record.foundationSegments.length, piers: record.piers.length, rebarItems: record.rebarItems.length }]), "General");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(record.crops), "Crops");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(record.foundationSegments), "Foundation");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(record.piers), "Piers");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(record.rebarItems), "Rebar");
  XLSX.writeFile(wb, `${record.projectName || "training-record"}.xlsx`);
}

export default function WorkspacePage() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const pdfRef = useRef<PdfDocument | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const [userEmail, setUserEmail] = useState("");
  const [userUid, setUserUid] = useState("");
  const [role, setRole] = useState("");
  const [record, setRecord] = useState<TrainingRecord>(() => emptyTrainingRecord());
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [scale, setScale] = useState(1.35);
  const [selection, setSelection] = useState<Selection>(null);
  const [cropLabel, setCropLabel] = useState("Foundation crop");
  const [cropType, setCropType] = useState("Foundation");
  const [cropSourceNote, setCropSourceNote] = useState("");
  const [cropConfidence, setCropConfidence] = useState<Confidence>("High");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [markTarget, setMarkTarget] = useState<{ kind: "pier"; id: string; label: string } | null>(null);

  useEffect(() => onAuthStateChanged(auth, async (u) => {
    if (!u) { setUserEmail(""); setUserUid(""); return; }
    setUserEmail(u.email || ""); setUserUid(u.uid);
    const snap = await getDoc(doc(db, "users", u.uid));
    const dbRole = String(snap.data()?.role || "collector").toLowerCase();
    setRole((u.email || "").toLowerCase() === OWNER_EMAIL ? "owner" : dbRole);
    setRecord(prev => ({ ...prev, collectorName: String(snap.data()?.displayName || u.email || ""), createdByUid: u.uid, createdByEmail: u.email || "" }));
  }), []);

  async function renderPage(targetPage = page, targetScale = scale) {
    const pdf = pdfRef.current; const canvas = canvasRef.current;
    if (!pdf || !canvas) return;
    const p = await pdf.getPage(targetPage);
    const viewport = p.getViewport({ scale: targetScale });
    canvas.width = viewport.width; canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    await p.render({ canvasContext: ctx, viewport }).promise;
  }

  async function fitPdf(mode: "width" | "page") {
    const pdf = pdfRef.current;
    const wrap = wrapRef.current;
    if (!pdf || !wrap) return;
    const p = await pdf.getPage(page);
    const viewport = p.getViewport({ scale: 1 });
    const availableWidth = Math.max(200, wrap.clientWidth - 24);
    const availableHeight = Math.max(200, wrap.clientHeight - 24);
    const widthScale = availableWidth / viewport.width;
    const heightScale = availableHeight / viewport.height;
    const nextScale = mode === "page" ? Math.min(widthScale, heightScale) : widthScale;
    setScale(Math.max(0.25, Math.min(4, Number(nextScale.toFixed(2)))));
    wrap.scrollTo({ left: 0, top: 0 });
  }

  function resetPdfView() {
    setScale(1);
    wrapRef.current?.scrollTo({ left: 0, top: 0 });
  }

  async function loadPdf(file: File) {
    setError(""); setNotice("");
    setRecord(prev => ({ ...prev, pdfFileName: file.name, projectName: prev.projectName || file.name.replace(/\.pdf$/i, "") }));
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url).toString();
    const data = await file.arrayBuffer();
    const pdf = (await pdfjs.getDocument({ data }).promise) as unknown as PdfDocument;
    pdfRef.current = pdf; setPages(pdf.numPages); setPage(1);
    await new Promise(r => setTimeout(r, 50));
    await renderPage(1, scale);
    setNotice("PDF loaded. Drag on the page to select a crop.");
  }

  useEffect(() => { renderPage(page, scale).catch(()=>{}); }, [page, scale]);

  function pointer(e: MouseEvent<HTMLDivElement>) {
    const canvas = canvasRef.current; const wrap = wrapRef.current;
    if (!canvas || !wrap) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: Math.max(0, e.clientX - rect.left), y: Math.max(0, e.clientY - rect.top) };
  }

  function markPointOnPdf(e: MouseEvent<HTMLDivElement>) {
    if (!markTarget) return false;
    const p = pointer(e);
    const pdfX = (p.x / scale).toFixed(1);
    const pdfY = (p.y / scale).toFixed(1);
    if (markTarget.kind === "pier") {
      setRecord(prev => ({
        ...prev,
        piers: prev.piers.map(item => item.id === markTarget.id ? {
          ...item,
          centerX: pdfX,
          centerY: pdfY,
          sourceNote: item.sourceNote || `PDF click mark, page ${page}`,
        } : item),
      }));
      setNotice(`${markTarget.label} marked on PDF: X=${pdfX}, Y=${pdfY}, page ${page}.`);
    }
    setSelection(null);
    setMarkTarget(null);
    return true;
  }

  function mouseDown(e: MouseEvent<HTMLDivElement>) {
    if (markPointOnPdf(e)) return;
    const p = pointer(e); startRef.current = p; setSelection({ x: p.x, y: p.y, width: 0, height: 0 });
  }
  function mouseMove(e: MouseEvent<HTMLDivElement>) {
    if (!startRef.current) return;
    const p = pointer(e); const s = startRef.current;
    setSelection({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), width: Math.abs(p.x - s.x), height: Math.abs(p.y - s.y) });
  }
  function mouseUp() { startRef.current = null; }

  async function uploadToDrive(dataUrl: string, filename: string) {
    const form = new FormData();
    const f = asFileFromDataUrl(dataUrl, filename);
    form.append("file", f); form.append("name", filename); form.append("mimeType", f.type);
    const res = await fetch("/api/drive/upload", { method: "POST", body: form });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) throw new Error(json.message || "Drive upload failed");
    return json.file as { id?: string; webViewLink?: string };
  }

  async function saveCrop() {
    setError(""); setNotice("");
    const canvas = canvasRef.current; const sel = selection;
    if (!canvas || !sel || sel.width < 5 || sel.height < 5) { setError("Draw a crop rectangle first."); return; }
    const out = document.createElement("canvas"); out.width = Math.round(sel.width); out.height = Math.round(sel.height);
    const ctx = out.getContext("2d"); if (!ctx) return;
    ctx.drawImage(canvas, sel.x, sel.y, sel.width, sel.height, 0, 0, sel.width, sel.height);
    const dataUrl = out.toDataURL("image/png");
    const autoLabel = `${cropType} crop`;
    const finalCropLabel = cropLabel.trim() && cropLabel.trim() !== "Foundation crop" ? cropLabel.trim() : autoLabel;
    const id = crypto.randomUUID(); const filename = `${record.projectName || "project"}_p${page}_${cropType}_${id.slice(0,8)}.png`.replace(/[^a-z0-9_.-]+/gi, "_");
    let driveFileId = ""; let driveWebViewLink = "";
    try { const drive = await uploadToDrive(dataUrl, filename); driveFileId = drive.id || ""; driveWebViewLink = drive.webViewLink || ""; }
    catch (e) { setNotice(`Crop saved locally in record, but Drive upload failed: ${e instanceof Error ? e.message : "unknown"}`); }
    const crop: CropRef = { id, label: finalCropLabel, elementType: cropType, pageNumber: page, sourceNote: cropSourceNote, confidence: cropConfidence, imageDataUrl: dataUrl, driveFileId, driveWebViewLink, createdAtIso: new Date().toISOString() };
    setRecord(prev => ({ ...prev, crops: [crop, ...prev.crops] }));
    setSelection(null); setCropSourceNote(""); setNotice("Crop added to this training record.");
  }

  async function saveRecord() {
    setError(""); setNotice("");
    try {
      const payload: TrainingRecord = { ...record, updatedAtIso: new Date().toISOString(), createdAtIso: record.createdAtIso || new Date().toISOString(), createdByUid: userUid, createdByEmail: userEmail };
      const collectionRef = collection(db, "trainingRecords");
      if (record.id) { await setDoc(doc(db, "trainingRecords", record.id), { ...payload, updatedAt: serverTimestamp() }, { merge: true }); }
      else { const ref = await addDoc(collectionRef, { ...payload, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }); payload.id = ref.id; setRecord(payload); }
      setNotice("Training record saved to Firestore.");
    } catch (e) { setError(e instanceof Error ? e.message : "Save failed"); }
  }

  function setGeneral<K extends keyof TrainingRecord>(key: K, value: TrainingRecord[K]) { setRecord(prev => ({ ...prev, [key]: value })); }
  function updateSegment(id: string, key: string, value: string | string[]) { setRecord(prev => ({ ...prev, foundationSegments: prev.foundationSegments.map(s => s.id === id ? { ...s, [key]: value } : s) })); }
  function updatePier(id: string, key: keyof PierItem, value: string | boolean | string[]) { setRecord(prev => ({ ...prev, piers: prev.piers.map(p => p.id === id ? { ...p, [key]: value } : p) })); }
  function updateRebar(id: string, key: keyof RebarItem, value: string | boolean | string[]) { setRecord(prev => ({ ...prev, rebarItems: prev.rebarItems.map(r => r.id === id ? { ...r, [key]: value } : r) })); }

  function readMultiSelect(e: ChangeEvent<HTMLSelectElement>) {
    return Array.from(e.target.selectedOptions).map(option => option.value);
  }

  function sourcePicker(value: string[] | undefined, onChange: (ids: string[]) => void) {
    const selected = value?.length ? value : ["TEXT"];
    return (
      <select className="sourceSelect" multiple value={selected} onChange={e => onChange(readMultiSelect(e))} title="Hold Ctrl to select more than one crop/source">
        <option value="TEXT">Text / dimension note</option>
        {record.crops.map(c => <option key={c.id} value={c.id}>{c.label} · p{c.pageNumber}</option>)}
      </select>
    );
  }

  return <main className="page">
    <div className="topbar"><div><div className="brand">Rebar Training Data Collector</div><div className="muted">Logged in: {userEmail || "not logged in"} {role && <span className="pill">{role}</span>}</div></div><div className="tabs">{(role === "admin" || role === "owner") && <Link className="tab" href="/admin">Admin</Link>}<button className="secondary" onClick={()=>signOut(auth)}>Sign out</button></div></div>
    {notice && <p className="notice">{notice}</p>}{error && <p className="error">{error}</p>}
    <div className="workspace">
      <section className="panel">
        <h2>PDF viewer and crop tool</h2>
        <div className="row"><input type="file" accept="application/pdf" onChange={e=>{const f=e.target.files?.[0]; if(f) loadPdf(f).catch(err=>setError(err.message));}} /><button className="secondary" onClick={()=>setScale(s=>Math.max(.25, +(s-.15).toFixed(2)))}>-</button><button className="secondary" onClick={()=>setScale(s=>+(s+.15).toFixed(2))}>+</button><button className="secondary" disabled={!pages} onClick={()=>fitPdf("width")}>Fit width</button><button className="secondary" disabled={!pages} onClick={()=>fitPdf("page")}>Fit page</button><button className="secondary" disabled={!pages} onClick={resetPdfView}>Reset</button><span className="muted">Zoom {Math.round(scale * 100)}% · Page {page} / {pages || "-"}</span><button className="secondary" disabled={page<=1} onClick={()=>setPage(p=>p-1)}>Prev</button><button className="secondary" disabled={!pages || page>=pages} onClick={()=>setPage(p=>p+1)}>Next</button></div>
        {markTarget && <p className="notice">Mark mode: click the center/location of <b>{markTarget.label}</b> on the PDF. Click Save crop later only for image crops.</p>}
        <div ref={wrapRef} className={markTarget ? "canvasWrap markMode" : "canvasWrap"} onMouseDown={mouseDown} onMouseMove={mouseMove} onMouseUp={mouseUp} onMouseLeave={mouseUp}>
          <canvas ref={canvasRef} className="pdfCanvas" />
          {selection && <div className="selection" style={{ left: selection.x, top: selection.y, width: selection.width, height: selection.height }} />}
        </div>
        <div className="grid" style={{marginTop:12}}>
          <div className="field"><label>Crop label</label><input value={cropLabel} onChange={e=>setCropLabel(e.target.value)} placeholder={`${cropType} crop`} /></div>
          <div className="field"><label>Element type</label><select value={cropType} onChange={e=>{ const nextType = e.target.value; setCropType(nextType); if (!cropLabel.trim() || cropLabel.trim() === "Foundation crop" || cropLabel.trim() === `${cropType} crop`) setCropLabel(`${nextType} crop`); }}><option>Foundation</option><option>Pier</option><option>Footing</option><option>Stem Wall</option><option>Source Note</option><option>Vent/Openings</option></select></div>
          <div className="field"><label>Crop source note</label><input value={cropSourceNote} onChange={e=>setCropSourceNote(e.target.value)} placeholder="Example: 52'-0&quot; or 3-#4 CONT." /></div>
          <div className="field"><label>Confidence</label><select value={cropConfidence} onChange={e=>setCropConfidence(e.target.value as Confidence)}>{confidenceOptions.map(c=><option key={c}>{c}</option>)}</select></div>
        </div>
        <button onClick={saveCrop}>Save crop</button>
        <div className="sectionTitle">Saved crops</div>
        {record.crops.map(c => <div className="cropCard" key={c.id}><div className="row"><img alt="crop" className="cropThumb" src={c.imageDataUrl} /><div><b>{c.label}</b><div className="muted">{c.elementType} · page {c.pageNumber} · {c.confidence}</div><div className="small">Source: {c.sourceNote}</div>{c.driveWebViewLink && <a className="small" href={c.driveWebViewLink} target="_blank">Open in Drive</a>}</div></div></div>)}
      </section>
      <section className="panel">
        <h2>Excel-style training form</h2><p className="muted">Use Pages Used for the main plan page or a list like 2,4,5,6. Each crop still saves its own exact page number.</p><p className="muted">In Evidence, choose one or more crop images that prove the row, or choose Text / dimension note when the value came only from written plan text.</p>
        <div className="grid"><div className="field"><label>Project name</label><input value={record.projectName} onChange={e=>setGeneral("projectName", e.target.value)} /></div><div className="field"><label>PDF file name</label><input value={record.pdfFileName} onChange={e=>setGeneral("pdfFileName", e.target.value)} /></div><div className="field"><label>Pages used</label><input value={record.pageNumber} onChange={e=>setGeneral("pageNumber", e.target.value)} placeholder="Example: 4 or 2,4,5,6" /></div><div className="field"><label>Foundation type</label><input value={record.foundationType} onChange={e=>setGeneral("foundationType", e.target.value)} /></div><div className="field"><label>Collector</label><input value={record.collectorName} onChange={e=>setGeneral("collectorName", e.target.value)} /></div><div className="field"><label>Status</label><select value={record.status} onChange={e=>setGeneral("status", e.target.value as TrainingRecord["status"])}><option>Collected</option><option>Reviewed</option><option>Approved</option><option>Rejected</option></select></div></div>
        <div className="field"><label>Reference dimension / calibration</label><input value={record.referenceDimension} onChange={e=>setGeneral("referenceDimension", e.target.value)} placeholder="Example: Sidewall = 52'-0&quot;" /></div>
        <div className="field"><label>Reference source note</label><input value={record.referenceSourceNote} onChange={e=>setGeneral("referenceSourceNote", e.target.value)} /></div>
        <div className="field"><label>Notes</label><textarea value={record.notes} onChange={e=>setGeneral("notes", e.target.value)} /></div>
        <div className="sectionTitle">Foundation geometry</div><button className="secondary" onClick={()=>setRecord(p=>({...p, foundationSegments:[...p.foundationSegments,newSegment(p.foundationSegments.length+1)]}))}>Add segment</button>
        <table className="table"><thead><tr><th>Seg</th><th>Len</th><th>Turn</th><th>Source Note</th><th>Conf</th><th>Evidence</th></tr></thead><tbody>{record.foundationSegments.map(s=><tr key={s.id}><td><input value={s.segmentName} onChange={e=>updateSegment(s.id,"segmentName",e.target.value)} /></td><td><input value={s.lengthText} onChange={e=>updateSegment(s.id,"lengthText",e.target.value)} /></td><td><input value={s.turnAngle} onChange={e=>updateSegment(s.id,"turnAngle",e.target.value)} /></td><td><input value={s.sourceNote} onChange={e=>updateSegment(s.id,"sourceNote",e.target.value)} /></td><td><select value={s.confidence} onChange={e=>updateSegment(s.id,"confidence",e.target.value)}>{confidenceOptions.map(c=><option key={c}>{c}</option>)}</select></td><td>{sourcePicker(s.sourceIds || (s.cropId ? [s.cropId] : ["TEXT"]), ids=>updateSegment(s.id,"sourceIds",ids))}</td></tr>)}</tbody></table>
        <div className="sectionTitle">Piers</div><button className="secondary" onClick={()=>setRecord(p=>({...p, piers:[...p.piers,newPier(p.piers.length+1)]}))}>Add pier</button>
        <table className="table"><thead><tr><th>Pier</th><th>Dia</th><th>H</th><th>Mark</th><th>X</th><th>Y</th><th>Rebar</th><th>Typ</th><th>Source Note</th><th>Evidence</th></tr></thead><tbody>{record.piers.map(p=><tr key={p.id}><td><input value={p.pierName} onChange={e=>updatePier(p.id,"pierName",e.target.value)} /></td><td><input value={p.diameter} onChange={e=>updatePier(p.id,"diameter",e.target.value)} /></td><td><input value={p.height} onChange={e=>updatePier(p.id,"height",e.target.value)} /></td><td><button type="button" className="secondary smallButton" onClick={()=>{ setMarkTarget({ kind: "pier", id: p.id, label: p.pierName || "pier" }); setNotice(`Click the center/location of ${p.pierName || "pier"} on the PDF.`); }}>Mark</button></td><td><input value={p.centerX} onChange={e=>updatePier(p.id,"centerX",e.target.value)} placeholder="click or type" /></td><td><input value={p.centerY} onChange={e=>updatePier(p.id,"centerY",e.target.value)} placeholder="click or type" /></td><td><input value={p.rebarSpec} onChange={e=>updatePier(p.id,"rebarSpec",e.target.value)} /></td><td><input type="checkbox" checked={p.typical} onChange={e=>updatePier(p.id,"typical",e.target.checked)} /></td><td><input value={p.sourceNote} onChange={e=>updatePier(p.id,"sourceNote",e.target.value)} /></td><td>{sourcePicker(p.sourceIds || (p.cropId ? [p.cropId] : ["TEXT"]), ids=>updatePier(p.id,"sourceIds",ids))}</td></tr>)}</tbody></table>
        <div className="sectionTitle">Rebar items</div><button className="secondary" onClick={()=>setRecord(p=>({...p, rebarItems:[...p.rebarItems,newRebar("Footing")]}))}>Add rebar</button>
        <table className="table"><thead><tr><th>Section</th><th>Item</th><th>Layer</th><th>Size</th><th>Count</th><th>Spacing</th><th>Cover</th><th>Lap</th><th>Source Note</th><th>Evidence</th></tr></thead><tbody>{record.rebarItems.map(r=><tr key={r.id}><td><select value={r.section} onChange={e=>updateRebar(r.id,"section",e.target.value)}><option>Footing</option><option>Stem Wall</option><option>Pier</option><option>General</option></select></td><td><input value={r.itemName} onChange={e=>updateRebar(r.id,"itemName",e.target.value)} /></td><td><input value={r.layer} onChange={e=>updateRebar(r.id,"layer",e.target.value)} /></td><td><input value={r.barSize} onChange={e=>updateRebar(r.id,"barSize",e.target.value)} /></td><td><input value={r.count} onChange={e=>updateRebar(r.id,"count",e.target.value)} /></td><td><input value={r.spacing} onChange={e=>updateRebar(r.id,"spacing",e.target.value)} /></td><td><input value={r.cover} onChange={e=>updateRebar(r.id,"cover",e.target.value)} /></td><td><input value={r.lap} onChange={e=>updateRebar(r.id,"lap",e.target.value)} /></td><td><input value={r.sourceNote} onChange={e=>updateRebar(r.id,"sourceNote",e.target.value)} /></td><td>{sourcePicker(r.sourceIds || (r.cropId ? [r.cropId] : ["TEXT"]), ids=>updateRebar(r.id,"sourceIds",ids))}</td></tr>)}</tbody></table>
        <div className="splitButtons"><button onClick={saveRecord}>Save to Firestore</button><button className="secondary" onClick={()=>downloadJson(record)}>Export JSON</button><button className="secondary" onClick={()=>exportExcel(record)}>Export Excel</button></div>
      </section>
    </div>
  </main>;
}
