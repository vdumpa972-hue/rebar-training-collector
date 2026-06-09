"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { auth, db, getSecondaryAuth } from "@/lib/firebase";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signOut,
  updateProfile,
} from "firebase/auth";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import type { TrainingRecord } from "@/lib/schema";

const OWNER_EMAIL = "vdumpa972@gmail.com";

type UserRow = {
  id: string;
  email?: string;
  username?: string;
  role?: string;
  status?: string;
  displayName?: string;
  mustChangePassword?: boolean;
};

type SavedTrainingRecord = TrainingRecord & {
  id: string;
  createdAt?: unknown;
  updatedAt?: unknown;
};

function makeUsername(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/@.*$/, "")
    .replace(/[^a-z0-9._-]+/g, "")
    .slice(0, 40);
}

function safeText(value: unknown) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function dateText(value: unknown) {
  const maybeTimestamp = value as { toDate?: () => Date } | undefined;
  if (maybeTimestamp?.toDate) return maybeTimestamp.toDate().toLocaleString();
  return "";
}

export default function AdminPage() {
  const router = useRouter();
  const [currentEmail, setCurrentEmail] = useState("");
  const [currentRole, setCurrentRole] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("FFLL972");
  const [role, setRole] = useState("user");
  const [sendSetupEmail, setSendSetupEmail] = useState(true);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [records, setRecords] = useState<SavedTrainingRecord[]>([]);
  const [selectedRecord, setSelectedRecord] = useState<SavedTrainingRecord | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const isOwner = currentEmail.toLowerCase() === OWNER_EMAIL || currentRole === "owner";
  const roleOptions = isOwner ? ["user", "admin"] : ["user"];

  async function loadUsers() {
    const snap = await getDocs(query(collection(db, "users"), orderBy("email")));
    setUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() } as UserRow)));
  }

  function recordSortValue(record: SavedTrainingRecord) {
    const anyRecord = record as Record<string, unknown>;
    const updatedAt = anyRecord.updatedAt as { toMillis?: () => number } | undefined;
    if (updatedAt?.toMillis) return updatedAt.toMillis();
    const updatedAtIso = typeof anyRecord.updatedAtIso === "string" ? anyRecord.updatedAtIso : "";
    const createdAtIso = typeof anyRecord.createdAtIso === "string" ? anyRecord.createdAtIso : "";
    return Date.parse(updatedAtIso || createdAtIso || "") || 0;
  }

  async function loadRecords() {
    try {
      // Do not use orderBy here. Firestore orderBy excludes documents missing that field,
      // which made older training records disappear from the Admin screen.
      const snap = await getDocs(collection(db, "trainingRecords"));
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() } as SavedTrainingRecord));
      rows.sort((a, b) => recordSortValue(b) - recordSortValue(a));
      setRecords(rows);
    } catch (e) {
      setError(e instanceof Error ? `Could not load training records: ${e.message}` : "Could not load training records");
      setRecords([]);
    }
  }

  async function loadAllAdminData() {
    await loadUsers();
    await loadRecords();
  }

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setChecking(true);
      setError("");
      if (!user) {
        setAuthorized(false);
        setChecking(false);
        router.push("/auth");
        return;
      }

      const emailValue = user.email || "";
      setCurrentEmail(emailValue);
      const snap = await getDoc(doc(db, "users", user.uid));
      let userRole = String(snap.data()?.role || "user").toLowerCase();

      if (emailValue.toLowerCase() === OWNER_EMAIL) {
        userRole = "owner";
        await setDoc(doc(db, "users", user.uid), { email: emailValue, username: makeUsername(emailValue), role: "owner", status: "active", updatedAt: serverTimestamp() }, { merge: true });
      }

      setCurrentRole(userRole);
      if (userRole !== "owner" && userRole !== "admin") {
        setAuthorized(false);
        setChecking(false);
        setError("Only owner or admin users can open this page.");
        return;
      }

      setAuthorized(true);
      setChecking(false);
      await loadAllAdminData();
    });
    return () => unsub();
  }, [router]);

  function handleEmailChange(value: string) {
    setEmail(value);
    if (!username.trim()) setUsername(makeUsername(value));
  }

  async function createUser() {
    setNotice("");
    setError("");
    setBusy(true);
    try {
      const cleanEmail = email.trim().toLowerCase();
      const cleanUsername = makeUsername(username || cleanEmail);
      const cleanDisplayName = displayName.trim() || cleanUsername || cleanEmail;
      const cleanRole = role === "admin" && !isOwner ? "user" : role;
      if (!cleanEmail) throw new Error("Enter email.");
      if (!password || password.length < 6) throw new Error("Temporary password must be at least 6 characters.");

      const secondaryAuth = getSecondaryAuth();
      const cred = await createUserWithEmailAndPassword(secondaryAuth, cleanEmail, password);
      await updateProfile(cred.user, { displayName: cleanDisplayName }).catch(() => {});
      await signOut(secondaryAuth).catch(() => {});

      await setDoc(
        doc(db, "users", cred.user.uid),
        {
          email: cleanEmail,
          username: cleanUsername,
          displayName: cleanDisplayName,
          role: cleanRole,
          status: "active",
          mustChangePassword: true,
          createdByEmail: currentEmail,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      await addDoc(collection(db, "auditLog"), {
        action: "create_user",
        targetEmail: cleanEmail,
        username: cleanUsername,
        role: cleanRole,
        createdByEmail: currentEmail,
        createdAt: serverTimestamp(),
      });

      let emailMessage = "";
      if (sendSetupEmail) {
        try {
          await sendPasswordResetEmail(auth, cleanEmail);
          emailMessage = " Password setup email sent by Firebase no-reply.";
        } catch (mailError) {
          emailMessage = ` User created, but setup email failed: ${mailError instanceof Error ? mailError.message : "unknown email error"}`;
        }
      }

      setNotice(`Created ${cleanRole}: ${cleanEmail}.${emailMessage}`);
      setEmail("");
      setUsername("");
      setDisplayName("");
      setPassword("FFLL972");
      setRole("user");
      await loadUsers();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create user");
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    setNotice("Signing out...");
    setError("");
    try {
      await signOut(auth);
      router.replace("/auth");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign out failed");
    }
  }

  async function sendSetup(userEmail: string) {
    setNotice("");
    setError("");
    try {
      await sendPasswordResetEmail(auth, userEmail);
      setNotice(`Password setup/reset email sent to ${userEmail}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send setup email");
    }
  }

  if (checking) {
    return <main className="page"><section className="panel">Checking admin access...</section></main>;
  }

  if (!authorized) {
    return <main className="page"><section className="panel"><p className="error">{error || "Not authorized."}</p><Link className="tab" href="/workspace">Back to workspace</Link></section></main>;
  }

  return (
    <main className="page">
      <div className="topbar">
        <div>
          <div className="brand">Admin</div>
          <div className="muted">Logged in: {currentEmail} <span className="pill">{isOwner ? "owner" : "admin"}</span></div>
        </div>
        <div className="tabs">
          <Link className="tab" href="/workspace">Workspace</Link>
          <Link className="tab activeTab" href="/admin">Admin</Link>
          <button className="secondary" onClick={handleSignOut}>Sign out</button>
        </div>
      </div>

      {notice && <p className="notice">{notice}</p>}
      {error && <p className="error">{error}</p>}

      <div className="grid adminGrid">
        <section className="panel">
          <h2>{isOwner ? "Add admin or user" : "Add user"}</h2>
          <p className="muted">Owner can create admins and users. Admins can create users only. Firebase sends setup/reset emails from its no-reply address.</p>
          <div className="field"><label>Name</label><input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Example: John User" autoComplete="name" /></div>
          <div className="field"><label>Email</label><input value={email} onChange={(e) => handleEmailChange(e.target.value)} placeholder="user@email.com" autoComplete="email" /></div>
          <div className="field"><label>Username</label><input value={username} onChange={(e) => setUsername(makeUsername(e.target.value))} placeholder="john.user" autoComplete="username" /></div>
          <div className="field"><label>Temporary password</label><input value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" /></div>
          <div className="field"><label>Role</label><select value={role} onChange={(e) => setRole(e.target.value)}>{roleOptions.map((r) => <option key={r}>{r}</option>)}</select></div>
          <label className="checkRow"><input type="checkbox" checked={sendSetupEmail} onChange={(e) => setSendSetupEmail(e.target.checked)} /> Send password setup email</label>
          <button disabled={busy} onClick={createUser}>{busy ? "Creating..." : `Create ${role}`}</button>
        </section>

        <section className="panel">
          <h2>Users</h2>
          <p className="muted">Manage owner, admin, and user accounts. Long emails are shown on separate lines so they do not overlap.</p>
          <div className="userCards">
            {users.map((u) => (
              <div className="userCard" key={u.id}>
                <div className="userCardMain">
                  <div className="userLine"><span>Email</span><strong>{u.email || "-"}</strong></div>
                  <div className="userLine"><span>Username</span><strong>{u.username || "-"}</strong></div>
                  <div className="userLine"><span>Name</span><strong>{u.displayName || "-"}</strong></div>
                  <div className="userLine"><span>Role</span><strong className="pill">{u.role || "user"}</strong></div>
                  <div className="userLine"><span>Status</span><strong>{u.status || "active"}{u.mustChangePassword ? " / setup" : ""}</strong></div>
                </div>
                <div className="userActions">
                  {u.email && (
                    <button className="secondary smallButton" onClick={() => sendSetup(u.email || "")}>
                      Send setup
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="row between">
          <h2>Collected training records</h2>
          <button className="secondary" onClick={loadRecords}>Refresh</button>
        </div>
        <p className="muted">
          Owner and admins can review everything collected by users. Showing {records.length} Firestore training record(s).
          Use <b>Edit in Workspace</b> to continue a collection job without creating a duplicate.
        </p>

        {records.length === 0 ? (
          <div className="emptyState">No training records found yet.</div>
        ) : (
          <div className="recordCards">
            {records.map((r) => (
              <article className="recordCard" key={r.id}>
                <div className="recordCardTop">
                  <div className="recordTitleBlock">
                    <h3>{safeText(r.projectName) || "Untitled training record"}</h3>
                    <code className="recordIdTextFull">{r.id}</code>
                  </div>
                  <div className="recordActions">
                    <Link className="primary smallButton buttonLink" href={`/workspace?recordId=${r.id}`}>
                      Edit in Workspace
                    </Link>
                    <button className="secondary smallButton" onClick={() => setSelectedRecord(r)}>
                      View Details
                    </button>
                  </div>
                </div>

                <div className="recordMetaGrid">
                  <div><span>PDF</span><strong>{safeText(r.pdfFileName) || "-"}</strong></div>
                  <div><span>Pages Used</span><strong>{safeText(r.pageNumber) || "-"}</strong></div>
                  <div><span>User</span><strong>{safeText(r.userName || r.createdByEmail) || "-"}</strong></div>
                  <div><span>Status</span><strong>{safeText(r.status) || "-"}</strong></div>
                  <div><span>Crops</span><strong>{r.crops?.length || 0}</strong></div>
                  <div><span>Piers</span><strong>{r.piersV2?.length || r.piers?.length || 0}</strong></div>
                  <div><span>Elements</span><strong>{(r.foundationV2?.length || 0) + (r.footingWallsV2?.length || 0) + (r.piersV2?.length || 0) + (r.ventsV2?.length || 0) + (r.crawlSpacesV2?.length || 0) + (r.miscV2?.length || 0) || r.rebarItems?.length || 0}</strong></div>
                  <div><span>Updated</span><strong>{dateText(r.updatedAt) || "-"}</strong></div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {selectedRecord && <section className="panel recordDetail">
        <div className="row between"><h2>Record details</h2><div className="row"><Link className="secondary buttonLink" href={`/workspace?recordId=${selectedRecord.id}`}>Edit / continue</Link><button className="secondary" onClick={() => setSelectedRecord(null)}>Close</button></div></div>
        <div className="grid">
          <div><b>Project:</b> {selectedRecord.projectName}</div>
          <div><b>PDF:</b> {selectedRecord.pdfFileName}</div>
          <div><b>Pages Used:</b> {selectedRecord.pageNumber}</div>
          <div><b>Status:</b> {selectedRecord.status}</div>
          <div><b>User:</b> {selectedRecord.userName || selectedRecord.createdByEmail}</div>
          <div><b>Foundation:</b> {selectedRecord.foundationType}</div>
        </div>
        <h3>Crops</h3>
        <div className="cropListCompact">{selectedRecord.crops?.map((c) => <div className="cropCard" key={c.id}><div className="row"><img alt="crop" className="cropThumb" src={c.imageDataUrl} /><div><b>{c.label}</b><div className="muted">{c.elementType} · page {c.pageNumber} · {c.confidence}</div><div className="small">Source: {c.sourceNote}</div>{c.driveWebViewLink && <a className="small" href={c.driveWebViewLink} target="_blank">Open in Drive</a>}</div></div></div>)}</div>
        <h3>Raw record JSON</h3>
        <pre className="jsonBox">{JSON.stringify(selectedRecord, null, 2)}</pre>
      </section>}
    </main>
  );
}
