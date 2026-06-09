"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { addDoc, collection, doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import * as XLSX from "xlsx";
import {
  emptyTrainingRecord,
  newFootingWallRowV2,
  footingWallItemTypesV2,
  newFoundationRowV2,
  newPierRowV2,
  newVentRowV2,
  statusOptions,
  type Confidence,
  type CropRef,
  type FootingWallRowV2,
  type FoundationRowV2,
  type PierRowV2,
  type TrainingRecord,
  type VentRowV2,
} from "@/lib/schema";

const OWNER_EMAIL = "vdumpa972@gmail.com";

type PdfDocument = { numPages: number; getPage: (n: number) => Promise<PdfPage> };
type PdfPage = { getViewport: (args: { scale: number }) => { width: number; height: number }; render: (args: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => { promise: Promise<void> } };
type Selection = { x: number; y: number; width: number; height: number } | null;
type MarkTarget = { kind: "pier" | "vent"; id: string; label: string } | null;

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
  a.href = url;
  a.download = `${record.projectName || "training-record"}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportExcel(record: TrainingRecord) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ ...record, crops: record.crops.length }]), "General");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(record.crops), "Crops");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(record.foundationV2 || []), "Foundation");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(record.footingWallsV2 || []), "FootingWalls");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(record.piersV2 || []), "Piers");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(record.ventsV2 || []), "Vents");
  XLSX.writeFile(wb, `${record.projectName || "training-record"}.xlsx`);
}

function normalizeRecord(data: Partial<TrainingRecord>, id?: string): TrainingRecord {
  const base = emptyTrainingRecord();
  return {
    ...base,
    ...data,
    id: id || data.id,
    schemaVersion: 2,
    crops: data.crops || [],
    stickLength: (data as any).stickLength || "20'",
    defaultOverlap: (data as any).defaultOverlap || data.foundationCornerOverlap || (data.foundationV2?.[0] as any)?.cornerOverlap || "24\"",
    defaultVerticalToBase: (data as any).defaultVerticalToBase || data.foundationVerticalHorizontalOverlap || (data.foundationV2?.[0] as any)?.verticalHorizontalOverlap || "6\"",
    foundationCornerOverlap: data.foundationCornerOverlap || (data as any).defaultOverlap || "24\"",
    foundationVerticalHorizontalOverlap: data.foundationVerticalHorizontalOverlap || (data as any).defaultVerticalToBase || "6\"",
    foundationRebarSize: data.foundationRebarSize || (data.foundationV2?.[0] as any)?.foundationRebarSize || "#4",
    pierRebarSize: data.pierRebarSize || (data.foundationV2?.[0] as any)?.pierRebarSize || "#4",
    foundationV2: data.foundationV2?.length ? data.foundationV2.map((row, index) => ({
      id: row.id || crypto.randomUUID(),
      segment: row.segment || `S${index + 1}`,
      length: row.length || "",
      turn: row.turn || (index === 0 ? "0" : "90"),
      sourceIds: row.sourceIds || [],
    })) : base.foundationV2,
    footingWallsV2: data.footingWallsV2?.length ? data.footingWallsV2.map((row, index) => ({
      ...newFootingWallRowV2(row.itemType || "Footing", index + 1),
      ...row,
      itemType: (["Footing", "Wall", "Pier"].includes(row.itemType as any) ? row.itemType : "Footing") as FootingWallRowV2["itemType"],
      segment: (row as any).segment || (row as any).horizontalNote || `${row.itemType || "Segment"}${index + 1}`,
      length: row.length || "",
      turn: (row as any).turn || "",
      bentLength: (row as any).bentLength || "",
      descriptionText: (row as any).descriptionText || (row as any).miscText || "",
      rebarSize: (row as any).rebarSize || "",
      note: (row as any).note || (row as any).horizontalNote || "",
      horizontalCircleCount: (row as any).horizontalCircleCount || row.numHorizontalBars || "",
      verticalBent: ((row as any).verticalBent || "") as FootingWallRowV2["verticalBent"],
      verticalBentLength: (row as any).verticalBentLength || "",
      sourceIds: row.sourceIds || [],
      horizontalNote: (row as any).horizontalNote || "",
    })) : base.footingWallsV2,
    crawlSpacesV2: [],
    miscV2: [],
    piersV2: data.piersV2 || [],
    ventsV2: data.ventsV2 || [],
  };
}

export default function WorkspacePage() {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const pdfRef = useRef<PdfDocument | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);

  const [editRecordId, setEditRecordId] = useState("");
  const [loadedRecordId, setLoadedRecordId] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [userUid, setUserUid] = useState("");
  const [role, setRole] = useState("");
  const [record, setRecord] = useState<TrainingRecord>(() => emptyTrainingRecord());
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [scale, setScale] = useState(1.15);
  const [selection, setSelection] = useState<Selection>(null);
  const [cropLabel, setCropLabel] = useState("Foundation crop");
  const [cropType, setCropType] = useState("Foundation");
  const [cropSourceNote, setCropSourceNote] = useState("");
  const [cropConfidence, setCropConfidence] = useState<Confidence>("High");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState("");
  const [loadingRecord, setLoadingRecord] = useState(false);
  const [markTarget, setMarkTarget] = useState<MarkTarget>(null);

  useEffect(() => {
    setEditRecordId(new URLSearchParams(window.location.search).get("recordId") || "");
  }, []);

  useEffect(() => onAuthStateChanged(auth, async (u) => {
    if (!u) { router.replace("/auth"); return; }
    setUserEmail(u.email || "");
    setUserUid(u.uid);
    const snap = await getDoc(doc(db, "users", u.uid));
    const dbRole = String(snap.data()?.role || "user").toLowerCase();
    setRole((u.email || "").toLowerCase() === OWNER_EMAIL ? "owner" : dbRole);
    setRecord(prev => ({ ...prev, userName: String(snap.data()?.displayName || u.email || ""), createdByUid: u.uid, createdByEmail: u.email || "" }));
  }), [router]);

  useEffect(() => {
    function closeOpenCropMenus(e: globalThis.MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (target?.closest(".evidencePicker")) return;
      document.querySelectorAll<HTMLDetailsElement>(".evidencePicker[open]").forEach(menu => { menu.open = false; });
    }
    document.addEventListener("pointerdown", closeOpenCropMenus);
    return () => document.removeEventListener("pointerdown", closeOpenCropMenus);
  }, []);

  useEffect(() => {
    async function loadExistingRecord() {
      if (!editRecordId || !userUid || loadedRecordId === editRecordId) return;
      setLoadingRecord(true);
      setError("");
      setNotice("Loading saved collection job...");
      try {
        const snap = await getDoc(doc(db, "trainingRecords", editRecordId));
        if (!snap.exists()) throw new Error("Training record was not found.");
        setRecord(normalizeRecord(snap.data() as Partial<TrainingRecord>, editRecordId));
        setLoadedRecordId(editRecordId);
        setNotice("Saved record loaded. Continue editing and click Update Firestore record.");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load record");
      } finally {
        setLoadingRecord(false);
      }
    }
    loadExistingRecord();
  }, [editRecordId, userUid, loadedRecordId]);

  async function renderPage(targetPage = page, targetScale = scale) {
    const pdf = pdfRef.current; const canvas = canvasRef.current;
    if (!pdf || !canvas) return;
    const p = await pdf.getPage(targetPage);
    const viewport = p.getViewport({ scale: targetScale });
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    await p.render({ canvasContext: ctx, viewport }).promise;
  }

  useEffect(() => { renderPage(page, scale).catch(()=>{}); }, [page, scale]);

  async function fitPdf(mode: "width" | "page") {
    const pdf = pdfRef.current; const wrap = wrapRef.current;
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

  async function loadPdf(file: File) {
    setError(""); setNotice("");
    setRecord(prev => ({ ...prev, pdfFileName: file.name, projectName: prev.projectName || file.name.replace(/\.pdf$/i, "") }));
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url).toString();
    const data = await file.arrayBuffer();
    const pdf = (await pdfjs.getDocument({ data }).promise) as unknown as PdfDocument;
    pdfRef.current = pdf;
    setPages(pdf.numPages);
    setPage(1);
    await new Promise(r => setTimeout(r, 50));
    await renderPage(1, scale);
    setNotice("PDF loaded. Drag on the page to create visual crop evidence.");
  }

  function pointer(e: MouseEvent<HTMLDivElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: Math.max(0, e.clientX - rect.left), y: Math.max(0, e.clientY - rect.top) };
  }

  function markPointOnPdf(e: MouseEvent<HTMLDivElement>) {
    if (!markTarget) return false;
    const p = pointer(e);
    const pdfX = (p.x / scale).toFixed(1);
    const pdfY = (p.y / scale).toFixed(1);
    if (markTarget.kind === "pier") {
      setRecord(prev => ({ ...prev, piersV2: (prev.piersV2 || []).map(row => row.id === markTarget.id ? { ...row, centerX: pdfX, centerY: pdfY } : row) }));
    }
    if (markTarget.kind === "vent") {
      setRecord(prev => ({ ...prev, ventsV2: (prev.ventsV2 || []).map(row => row.id === markTarget.id ? { ...row, x: pdfX, y: pdfY } : row) }));
    }
    setNotice(`${markTarget.label} marked on PDF: X=${pdfX}, Y=${pdfY}, page ${page}.`);
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
    const out = document.createElement("canvas");
    out.width = Math.round(sel.width); out.height = Math.round(sel.height);
    const ctx = out.getContext("2d"); if (!ctx) return;
    ctx.drawImage(canvas, sel.x, sel.y, sel.width, sel.height, 0, 0, sel.width, sel.height);
    const dataUrl = out.toDataURL("image/png");
    const id = crypto.randomUUID();
    const finalLabel = cropLabel.trim() || `${cropType} crop`;
    const filename = `${record.projectName || "project"}_p${page}_${cropType}_${id.slice(0,8)}.png`.replace(/[^a-z0-9_.-]+/gi, "_");
    let driveFileId = ""; let driveWebViewLink = "";
    try { const drive = await uploadToDrive(dataUrl, filename); driveFileId = drive.id || ""; driveWebViewLink = drive.webViewLink || ""; }
    catch (e) { setNotice(`Crop saved in record, but Drive upload failed: ${e instanceof Error ? e.message : "unknown"}`); }
    const crop: CropRef = { id, label: finalLabel, elementType: cropType, pageNumber: page, sourceNote: cropSourceNote, confidence: cropConfidence, imageDataUrl: dataUrl, driveFileId, driveWebViewLink, createdAtIso: new Date().toISOString() };
    setRecord(prev => ({ ...prev, crops: [crop, ...prev.crops] }));
    setSelection(null); setCropSourceNote(""); setNotice("Crop evidence added to this training record.");
  }

  async function saveRecord() {
    setError(""); setNotice("Saving training record to Firestore..."); setSaving(true);
    try {
      const payload: TrainingRecord = { ...record, schemaVersion: 2, updatedAtIso: new Date().toISOString(), createdAtIso: record.createdAtIso || new Date().toISOString(), createdByUid: userUid, createdByEmail: userEmail };
      const existingId = record.id || editRecordId || loadedRecordId;
      if (existingId) {
        payload.id = existingId;
        await setDoc(doc(db, "trainingRecords", existingId), { ...payload, id: existingId, updatedAt: serverTimestamp() }, { merge: true });
        setRecord(payload);
        setEditRecordId(existingId);
        setLoadedRecordId(existingId);
      } else {
        const ref = await addDoc(collection(db, "trainingRecords"), { ...payload, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
        payload.id = ref.id;
        await setDoc(doc(db, "trainingRecords", ref.id), { id: ref.id, updatedAt: serverTimestamp() }, { merge: true });
        setRecord(payload);
        setEditRecordId(ref.id);
        setLoadedRecordId(ref.id);
        router.replace(`/workspace?recordId=${ref.id}`);
      }
      const savedText = new Date().toLocaleTimeString();
      setLastSavedAt(savedText);
      setNotice(`${payload.id ? "Training record updated" : "Training record saved"} at ${savedText}.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Save failed"); }
    finally { setSaving(false); }
  }

  async function handleSignOut() {
    setError("");
    setNotice("Signing out...");
    try {
      await signOut(auth);
      setUserEmail("");
      setUserUid("");
      setRole("");
      window.location.replace("/auth");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign out failed");
      setNotice("");
    }
  }

  function setGeneral<K extends keyof TrainingRecord>(key: K, value: TrainingRecord[K]) { setRecord(prev => ({ ...prev, [key]: value })); }
  function updateFoundation(id: string, key: keyof FoundationRowV2, value: string | string[]) { setRecord(prev => ({ ...prev, foundationV2: (prev.foundationV2 || []).map(r => r.id === id ? { ...r, [key]: value } : r) })); }
  function updateFootingWall(id: string, key: keyof FootingWallRowV2, value: string | string[]) { setRecord(prev => ({ ...prev, footingWallsV2: (prev.footingWallsV2 || []).map(r => r.id === id ? { ...r, [key]: value } : r) })); }

  function nextSegmentName(rows: FootingWallRowV2[], itemType: FootingWallRowV2["itemType"], currentId?: string) {
    const count = rows.filter(r => r.id !== currentId && r.itemType === itemType).length + 1;
    return `${itemType}${count}`;
  }

  function addRebarInfo() {
    setRecord(prev => ({
      ...prev,
      footingWallsV2: [
        ...(prev.footingWallsV2 || []),
        newFootingWallRowV2("Footing", ((prev.footingWallsV2 || []).filter(r => r.itemType === "Footing").length + 1)),
      ],
    }));
  }

  function changeFootingWallType(id: string, itemType: FootingWallRowV2["itemType"]) {
    setRecord(prev => ({
      ...prev,
      footingWallsV2: (prev.footingWallsV2 || []).map(row => row.id === id ? {
        ...row,
        itemType,
        segment: nextSegmentName(prev.footingWallsV2 || [], itemType, id),
        turn: itemType === "Footing" || itemType === "Wall" ? (row.turn || "0") : "",
      } : row),
    }));
  }
  function updatePier(id: string, key: keyof PierRowV2, value: string | string[]) { setRecord(prev => ({ ...prev, piersV2: (prev.piersV2 || []).map(r => r.id === id ? { ...r, [key]: value } : r) })); }
  function updateVent(id: string, key: keyof VentRowV2, value: string | string[]) { setRecord(prev => ({ ...prev, ventsV2: (prev.ventsV2 || []).map(r => r.id === id ? { ...r, [key]: value } : r) })); }

  function cropDisplayName(c: CropRef) {
    const cleanLabel = (c.label || "").trim();
    const cleanType = (c.elementType || "Crop").trim();
    if (!cleanLabel) return `${cleanType} crop - page ${c.pageNumber}`;
    if (cleanLabel.toLowerCase().includes(cleanType.toLowerCase())) return `${cleanLabel} - page ${c.pageNumber}`;
    return `${cleanType} crop - ${cleanLabel} - page ${c.pageNumber}`;
  }

  function cropLabelById(id: string) {
    const c = record.crops.find(x => x.id === id);
    return c ? cropDisplayName(c) : "Crop";
  }
  function sourcePicker(value: string[] | undefined, onChange: (ids: string[]) => void) {
    const selected = value || [];
    const label = selected.length === 0 ? "No crop" : selected.length === 1 ? cropLabelById(selected[0]) : `${selected.length} crops`;
    return <details className="evidencePicker"><summary>{label}</summary><div className="evidenceMenu">
      <div className="evidenceHint">Use crops only for visual/drawing evidence. Text notes will be extracted later by AI.</div>
      {record.crops.length === 0 && <div className="evidenceHint">No crop images saved yet.</div>}
      {record.crops.map(c => <label className="evidenceOption" key={c.id}><input type="checkbox" checked={selected.includes(c.id)} onChange={e => {
        const next = e.target.checked ? Array.from(new Set([...selected, c.id])) : selected.filter(x => x !== c.id);
        onChange(next);
      }} /><span>{cropDisplayName(c)}</span></label>)}
    </div></details>;
  }

  function copyDown(listKey: keyof TrainingRecord, key: string) {
    setRecord(prev => {
      const list = (prev[listKey] as any[]) || [];
      if (list.length < 2) return prev;
      const firstValue = list[0]?.[key];
      return { ...prev, [listKey]: list.map((row, i) => i === 0 ? row : { ...row, [key]: Array.isArray(firstValue) ? [...firstValue] : firstValue }) };
    });
  }

  function copyButton(label: string, onClick: () => void) {
    return <button type="button" className="copyDownButton" onClick={onClick}>Copy {label} down</button>;
  }

  return <main className="page">
    <div className="topbar"><div><div className="brand">Rebar Training Data User</div><div className="muted">Logged in: {userEmail || "not logged in"} {role && <span className="pill">{role}</span>}</div></div><div className="tabs">{(role === "admin" || role === "owner") && <Link className="tab" href="/admin">Admin</Link>}<button className="secondary" onClick={handleSignOut}>Sign out</button></div></div>
    {notice && <p className="notice">{notice}</p>}{lastSavedAt && <p className="notice saveOk">Last saved: {lastSavedAt}</p>}{error && <p className="error">{error}</p>}{loadingRecord && <p className="notice">Loading saved record...</p>}{record.id && <p className="notice editMode">Editing saved record: {record.projectName || record.pdfFileName || record.id}</p>}
    <div className="workspace">
      <section className="panel">
        <h2>PDF viewer and crop tool</h2>
        <div className="row"><input type="file" accept="application/pdf" onChange={e=>{const f=e.target.files?.[0]; if(f) loadPdf(f).catch(err=>setError(err.message));}} /><button className="secondary" onClick={()=>setScale(s=>Math.max(.25, +(s-.15).toFixed(2)))}>-</button><button className="secondary" onClick={()=>setScale(s=>+(s+.15).toFixed(2))}>+</button><button className="secondary" disabled={!pages} onClick={()=>fitPdf("width")}>Fit width</button><button className="secondary" disabled={!pages} onClick={()=>fitPdf("page")}>Fit page</button><button className="secondary" disabled={!pages} onClick={()=>setScale(1)}>Reset</button><span className="muted">Zoom {Math.round(scale * 100)}% · Page {page} / {pages || "-"}</span><button className="secondary" disabled={page<=1} onClick={()=>setPage(p=>p-1)}>Prev</button><button className="secondary" disabled={!pages || page>=pages} onClick={()=>setPage(p=>p+1)}>Next</button></div>
        {markTarget && <div className="markBanner">Click the location of {markTarget.label} on the PDF. <button className="secondary smallButton" onClick={()=>setMarkTarget(null)}>Cancel mark</button></div>}
        <div ref={wrapRef} className="pdfWrap" onMouseDown={mouseDown} onMouseMove={mouseMove} onMouseUp={mouseUp}><canvas ref={canvasRef} />{selection && <div className="selection" style={{ left: selection.x, top: selection.y, width: selection.width, height: selection.height }} />}</div>
        <div className="cropBox"><h3>Save crop evidence</h3><p className="muted">Crops are for visual/drawing evidence. Text in plan notes does not need cropping because AI will extract it later.</p><div className="grid2"><label>Element type<select value={cropType} onChange={e=>{setCropType(e.target.value); setCropLabel(`${e.target.value} crop`);}}><option>Footing</option><option>Wall</option><option>Pier</option></select></label><label>Crop label<input value={cropLabel} onChange={e=>setCropLabel(e.target.value)} /></label><label>Crop note<input value={cropSourceNote} onChange={e=>setCropSourceNote(e.target.value)} placeholder="Optional visual note" /></label><label>Confidence<select value={cropConfidence} onChange={e=>setCropConfidence(e.target.value as Confidence)}><option>High</option><option>Medium</option><option>Low</option></select></label></div><button onClick={saveCrop}>Save crop evidence</button></div>
        <div className="cropList">{record.crops.map(c=><div className="cropCard" key={c.id}><strong>{c.label}</strong><span>page {c.pageNumber}</span>{c.imageDataUrl && <img src={c.imageDataUrl} alt={c.label} />}</div>)}</div>
      </section>

      <section className="panel formPanel">
        <h2>Simplified training record</h2>
        <div className="grid2"><label>Project name<input value={record.projectName} onChange={e=>setGeneral("projectName", e.target.value)} /></label><label>PDF file name<input value={record.pdfFileName} onChange={e=>setGeneral("pdfFileName", e.target.value)} /></label><label>Pages used<input value={record.pageNumber} onChange={e=>setGeneral("pageNumber", e.target.value)} placeholder="4 or 2,4,5" /></label><label>Status<select value={record.status} onChange={e=>setGeneral("status", e.target.value as TrainingRecord["status"])}>{statusOptions.map(s=><option key={s}>{s}</option>)}</select></label><label>Reference dimension<input value={record.referenceDimension} onChange={e=>setGeneral("referenceDimension", e.target.value)} placeholder={'Sidewall = 52\' 0"'} /></label><label>Foundation type<input value={record.foundationType} onChange={e=>setGeneral("foundationType", e.target.value)} /></label></div><label>Notes<textarea value={record.notes} onChange={e=>setGeneral("notes", e.target.value)} /></label>

        
        <ElementSection title="Rebar Parameters" addLabel="Add rebar info" onAdd={addRebarInfo}>
          <div className="fieldCard">
            <h4>Global params</h4>
            <div className="miniGrid">
              <label>Stick len<input value={record.stickLength || ""} onChange={e=>setGeneral("stickLength" as keyof TrainingRecord, e.target.value)} placeholder="20'" /></label>
              <label>Default overlap<input value={record.defaultOverlap || ""} onChange={e=>{setGeneral("defaultOverlap" as keyof TrainingRecord, e.target.value); setGeneral("foundationCornerOverlap", e.target.value);}} placeholder={'24"'} /></label>
              <label>Default vertical to base<input value={record.defaultVerticalToBase || ""} onChange={e=>{setGeneral("defaultVerticalToBase" as keyof TrainingRecord, e.target.value); setGeneral("foundationVerticalHorizontalOverlap", e.target.value);}} placeholder={'6"'} /></label>
              <label>Default rebar for footing / walls<input value={record.foundationRebarSize || ""} onChange={e=>setGeneral("foundationRebarSize", e.target.value)} placeholder="#4" /></label>
              <label>Default rebar for piers<input value={record.pierRebarSize || ""} onChange={e=>setGeneral("pierRebarSize", e.target.value)} placeholder="#4" /></label>
            </div>
          </div>

          {record.footingWallsV2.map(row=><div className="dataCard" key={row.id}>
            <div className="miniGrid">
              <label>Type<select value={row.itemType} onChange={e=>changeFootingWallType(row.id, e.target.value as FootingWallRowV2["itemType"])}>
                {footingWallItemTypesV2.map(t=><option key={t}>{t}</option>)}
              </select></label>
              <label>Segment<input value={row.segment || ""} onChange={e=>updateFootingWall(row.id,"segment" as keyof FootingWallRowV2,e.target.value)} placeholder="Footing1 / Wall1 / Pier1" /></label>

              {(row.itemType === "Footing" || row.itemType === "Wall") && <>
                <label>Len<input value={row.length || ""} onChange={e=>updateFootingWall(row.id,"length",e.target.value)} placeholder={`Example: 52' 0"`} /></label>
                <label>Turn<input value={row.turn || ""} onChange={e=>updateFootingWall(row.id,"turn" as keyof FootingWallRowV2,e.target.value)} placeholder="0 / 45 / 90 / free text" /></label>
                <label>Bent len<input value={row.bentLength || ""} onChange={e=>updateFootingWall(row.id,"bentLength" as keyof FootingWallRowV2,e.target.value)} placeholder={'Example: 6" or 12"'} /></label>
              </>}

              {row.itemType === "Pier" && <>
                <label>Diameter<input value={row.diameter || ""} onChange={e=>updateFootingWall(row.id,"diameter",e.target.value)} placeholder={'Example: 28"'} /></label>
                <label>Length<input value={row.length || ""} onChange={e=>updateFootingWall(row.id,"length",e.target.value)} placeholder={'Example: 30"'} /></label>
                <label>Horizontal circle count<input value={row.horizontalCircleCount || ""} onChange={e=>updateFootingWall(row.id,"horizontalCircleCount" as keyof FootingWallRowV2,e.target.value)} placeholder="Example: 4" /></label>
                <label>Vertical bars<input value={row.numVerticalBars || ""} onChange={e=>updateFootingWall(row.id,"numVerticalBars",e.target.value)} placeholder="Example: 6" /></label>
                <label>Vertical bent?<select value={row.verticalBent || ""} onChange={e=>updateFootingWall(row.id,"verticalBent" as keyof FootingWallRowV2,e.target.value)}><option value="">Select</option><option>Yes</option><option>No</option></select></label>
                <label>Vertical bent len<input value={row.verticalBentLength || ""} onChange={e=>updateFootingWall(row.id,"verticalBentLength" as keyof FootingWallRowV2,e.target.value)} placeholder={'Example: 6"'} /></label>
              </>}


              <label>Crop image{sourcePicker(row.sourceIds, ids=>updateFootingWall(row.id,"sourceIds",ids))}</label>
              <label>Rebar #<input value={row.rebarSize || ""} onChange={e=>updateFootingWall(row.id,"rebarSize" as keyof FootingWallRowV2,e.target.value)} placeholder={row.itemType === "Pier" ? (record.pierRebarSize || "#4") : (record.foundationRebarSize || "#4")} /></label>
              <label className="wideField">Descriptive note<textarea value={row.note || ""} onChange={e=>updateFootingWall(row.id,"note" as keyof FootingWallRowV2,e.target.value)} placeholder="Any extra note for this row." /></label>
            </div>
          </div>)}
          <div className="bottomAddRow"><button type="button" className="secondary" onClick={addRebarInfo}>Add rebar info</button></div>
        </ElementSection>

        <div className="splitButtons"><button disabled={saving} onClick={saveRecord}>{saving ? "Saving..." : record.id ? "Update Firestore record" : "Save to Firestore"}</button><button className="secondary" onClick={()=>downloadJson(record)}>Export JSON</button><button className="secondary" onClick={()=>exportExcel(record)}>Export Excel</button></div>
      </section>
    </div>
  </main>;
}

function ElementSection({ title, addLabel, onAdd, children }: { title: string; addLabel?: string; onAdd: () => void; children: React.ReactNode }) {
  return <section className="elementSection"><div className="sectionHeader"><h3>{title}</h3><button type="button" className="secondary" onClick={onAdd}>{addLabel || `Add ${title}`}</button></div>{children}</section>;
}
