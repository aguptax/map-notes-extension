// Google Drive API wrapper — stores everything in user's Drive

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const APP_FOLDER = "MapNotes";
const DATA_FILE = "mapnotes-data.json";
const ATTACHMENTS_FOLDER = "MapNotes Attachments";

const Drive = {
  _folderId: null,
  _attachmentsFolderId: null,
  _dataFileId: null,

  // Get auth headers
  async _headers() {
    const token = await Auth.getToken(false);
    if (!token) throw new Error("Not authenticated");
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  },

  // Find or create a folder by name
  async _findOrCreateFolder(name, parentId = null) {
    const headers = await this._headers();
    let q = `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    if (parentId) q += ` and '${parentId}' in parents`;

    // Search for existing folder
    const searchRes = await fetch(
      `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id,name)`,
      { headers }
    );
    const searchData = await searchRes.json();
    if (searchData.files?.length > 0) return searchData.files[0].id;

    // Create folder
    const body = {
      name,
      mimeType: "application/vnd.google-apps.folder",
    };
    if (parentId) body.parents = [parentId];
    const createRes = await fetch(`${DRIVE_API}/files`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const folder = await createRes.json();
    return folder.id;
  },

  // Initialize folder structure: MapNotes/ and MapNotes/MapNotes Attachments/
  async init() {
    this._folderId = await this._findOrCreateFolder(APP_FOLDER);
    this._attachmentsFolderId = await this._findOrCreateFolder(
      ATTACHMENTS_FOLDER,
      this._folderId
    );
    return true;
  },

  // --- Data file (JSON with all places/notes) ---

  // Find the data.json file ID
  async _findDataFile() {
    if (this._dataFileId) return this._dataFileId;
    const headers = await this._headers();
    const q = `name='${DATA_FILE}' and '${this._folderId}' in parents and trashed=false`;
    const res = await fetch(
      `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id)`,
      { headers }
    );
    const data = await res.json();
    if (data.files?.length > 0) {
      this._dataFileId = data.files[0].id;
      return this._dataFileId;
    }
    return null;
  },

  // Load all extension data from Drive
  async loadData() {
    await this.init();
    const fileId = await this._findDataFile();
    if (!fileId) {
      // No data file yet — return default structure
      return { version: 1, places: [] };
    }
    const headers = await this._headers();
    const res = await fetch(`${DRIVE_API}/files/${fileId}?alt=media`, {
      headers,
    });
    if (!res.ok) return { version: 1, places: [] };
    return res.json();
  },

  // Save all extension data to Drive
  async saveData(data) {
    await this.init();
    const fileId = await this._findDataFile();
    const headers = await this._headers();
    const content = JSON.stringify(data, null, 2);

    if (fileId) {
      // Update existing file
      await fetch(`${UPLOAD_API}/files/${fileId}?uploadType=media`, {
        method: "PATCH",
        headers: {
          ...headers,
          "Content-Type": "application/json",
        },
        body: content,
      });
    } else {
      // Create new data file (multipart upload with metadata)
      const metadata = {
        name: DATA_FILE,
        parents: [this._folderId],
        mimeType: "application/json",
      };
      const form = new FormData();
      form.append(
        "metadata",
        new Blob([JSON.stringify(metadata)], { type: "application/json" })
      );
      form.append("file", new Blob([content], { type: "application/json" }));

      const token = (await this._headers()).Authorization;
      const res = await fetch(`${UPLOAD_API}/files?uploadType=multipart`, {
        method: "POST",
        headers: { Authorization: token },
        body: form,
      });
      const created = await res.json();
      this._dataFileId = created.id;
    }
  },

  // --- Attachments ---

  // Upload an attachment file to Drive
  async uploadAttachment(file) {
    await this.init();
    const metadata = {
      name: `${Date.now()}-${file.name}`,
      parents: [this._attachmentsFolderId],
    };
    const form = new FormData();
    form.append(
      "metadata",
      new Blob([JSON.stringify(metadata)], { type: "application/json" })
    );
    form.append("file", file);

    const token = (await this._headers()).Authorization;
    const res = await fetch(
      `${UPLOAD_API}/files?uploadType=multipart&fields=id,name,mimeType,size,webViewLink,thumbnailLink`,
      {
        method: "POST",
        headers: { Authorization: token },
        body: form,
      }
    );
    return res.json();
  },

  // Download/get attachment by file ID
  async getAttachmentUrl(fileId) {
    const headers = await this._headers();
    // Return a direct download URL with auth
    const token = headers.Authorization;
    return `${DRIVE_API}/files/${fileId}?alt=media&access_token=${token.replace("Bearer ", "")}`;
  },

  // Delete an attachment from Drive
  async deleteAttachment(fileId) {
    const headers = await this._headers();
    await fetch(`${DRIVE_API}/files/${fileId}`, {
      method: "DELETE",
      headers,
    });
  },

  // Make a file publicly viewable (for sharing)
  async shareFile(fileId) {
    const headers = await this._headers();
    await fetch(`${DRIVE_API}/files/${fileId}/permissions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ role: "reader", type: "anyone" }),
    });
    const res = await fetch(
      `${DRIVE_API}/files/${fileId}?fields=webViewLink`,
      { headers }
    );
    const data = await res.json();
    return data.webViewLink;
  },
};
