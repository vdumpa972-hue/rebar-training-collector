import { google } from "googleapis";
import { NextRequest, NextResponse } from "next/server";
import { Readable } from "stream";

function envPrivateKey() {
  return String(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || "").replace(/\\n/g, "\n");
}

export async function POST(req: NextRequest) {
  try {
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const privateKey = envPrivateKey();
    if (!folderId || !clientEmail || !privateKey) {
      return NextResponse.json({ ok: false, message: "Google Drive env vars are missing." }, { status: 500 });
    }

    const form = await req.formData();
    const file = form.get("file");
    const name = String(form.get("name") || "upload.bin");
    const mimeType = String(form.get("mimeType") || "application/octet-stream");
    if (!(file instanceof File)) return NextResponse.json({ ok: false, message: "Missing file." }, { status: 400 });

    const auth = new google.auth.JWT({ email: clientEmail, key: privateKey, scopes: ["https://www.googleapis.com/auth/drive.file"] });
    const drive = google.drive({ version: "v3", auth });
    const buffer = Buffer.from(await file.arrayBuffer());

    const created = await drive.files.create({
      requestBody: { name, parents: [folderId] },
      media: { mimeType, body: Readable.from(buffer) },
      fields: "id,name,webViewLink,webContentLink"
    });

    return NextResponse.json({ ok: true, file: created.data });
  } catch (e) {
    return NextResponse.json({ ok: false, message: e instanceof Error ? e.message : "Upload failed" }, { status: 500 });
  }
}
