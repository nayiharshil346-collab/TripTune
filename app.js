const API_URL = "https://riliocarlwqaajsuzlyz.supabase.co/functions/v1/trip-api";
const SESSION_KEY = "triptune_session_v1";
const $ = (s) => document.querySelector(s);

async function tripApi(action, data = {}, token = null) {
  let response;
  try {
    response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...data, ...(token ? { token } : {}) })
    });
  } catch {
    throw new Error("Network error. Check your internet connection.");
  }
  let result;
  try { result = await response.json(); }
  catch { throw new Error("Unexpected server response. Check your Edge Function deployment."); }
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
  return result;
}

const dialog = $("#tripDialog");
const fields = $("#dialogFields");
const form = $("#tripForm");
const errorBox = $("#formError");
const submit = $("#submitBtn");
let currentMode = "";
let activeSession = readSession();
let refreshTimer = null;
let queueLoading = false;

const configs = {
  create: {
    eyebrow: "START YOUR JOURNEY", title: "Create your trip",
    description: "Create a room for your group. Use two different strong passwords.",
    button: "Create Trip",
    fields: [
      ["hostName", "Your name", "e.g. Tony Stark", "text", false],
      ["tripName", "Trip name", "e.g. Ahmedabad to Udaipur", "text", false],
      ["memberPasskey", "Group passkey", "Create a group passkey", "password", true],
      ["hostPassword", "Your host password", "Create a separate host password", "password", true]
    ]
  },
  join: {
    eyebrow: "JOIN YOUR CREW", title: "Join a trip",
    description: "Ask the host for the trip code and group passkey.",
    button: "Join Trip",
    fields: [
      ["tripCode", "Trip code", "Enter the trip code", "text", false],
      ["memberName", "Your name", "What should we call you?", "text", false],
      ["memberPasskey", "Group passkey", "Enter the group passkey", "password", true]
    ]
  },
  host: {
    eyebrow: "HOST ACCESS", title: "Welcome back, Host",
    description: "Enter the trip code and your separate host password.",
    button: "Host Login",
    fields: [
      ["tripCode", "Trip code", "Enter the trip code", "text", false],
      ["hostName", "Your name", "Enter your host name", "text", false],
      ["hostPassword", "Host password", "Enter your host password", "password", true]
    ]
  }
};

function readSession() {
  try {i
    const s = sessionStorage.getItem(SESSION_KEY);
    return s ? JSON.parse(s) : null;
  } catch { return null; }
}
function saveSession(result, displayName) {
  activeSession = { ...result, displayName, savedAt: Date.now() };
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(activeSession));
}
function clearSession() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
  sessionStorage.removeItem(SESSION_KEY);
  activeSession = null;
}
function make(tag, className = "", text = "") {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== "") el.textContent = text;
  return el;
}
function openForm(mode) {
  currentMode = mode;
  const c = configs[mode];
  $("#dialogEyebrow").textContent = c.eyebrow;
  $("#dialogTitle").textContent = c.title;
  $("#dialogDescription").textContent = c.description;
  submit.textContent = c.button;
  errorBox.textContent = "";
  fields.replaceChildren();

  c.fields.forEach(([id, label, placeholder, type, isPassword]) => {
    const wrap = make("div", "field");
    const lab = make("label", "", label);
    lab.htmlFor = id;
    const input = make("input");
    input.id = id;
    input.name = id;
    input.type = type;
    input.placeholder = placeholder;
    input.required = true;
    input.autocomplete = isPassword
      ? (mode === "host" && id === "hostPassword" ? "current-password" : "new-password")
      : "off";
    input.maxLength = id === "tripName" ? 70 : id === "memberName" || id === "hostName" ? 50 : 150;
    if (isPassword) input.minLength = 1;
    wrap.append(lab, input);
    fields.append(wrap);
  });
  dialog.showModal();
}
$("#createBtn").addEventListener("click", () => openForm("create"));
$("#joinBtn").addEventListener("click", () => openForm("join"));
$("#hostBtn").addEventListener("click", () => openForm("host"));
$("#closeDialog").addEventListener("click", () => dialog.close());
dialog.addEventListener("close", () => { form.reset(); errorBox.textContent = ""; });

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorBox.textContent = "";
  submit.disabled = true;
  submit.textContent = "Please wait…";
  const d = Object.fromEntries(new FormData(form).entries());
  try {
    let result;
    if (currentMode === "create") {
      result = await tripApi("create_trip", {
        tripName: d.tripName, memberPasskey: d.memberPasskey, hostPassword: d.hostPassword
      });
      saveSession(result, d.hostName.trim());
      dialog.close();
      showTripCreated(result, d.hostName.trim());
    } else if (currentMode === "join") {
      result = await tripApi("join_trip", {
        tripCode: d.tripCode, memberPasskey: d.memberPasskey, memberName: d.memberName
      });
      saveSession(result, d.memberName.trim());
      dialog.close();
      showDashboard();
    } else if (currentMode === "host") {
      result = await tripApi("host_login", {
        tripCode: d.tripCode, hostPassword: d.hostPassword
      });
      saveSession(result, d.hostName.trim());
      dialog.close();
      showDashboard();
    }
  } catch (err) {
    errorBox.textContent = err.message || "Something went wrong. Try again.";
  } finally {
    submit.disabled = false;
    submit.textContent = configs[currentMode]?.button || "Continue";
  }
});

function replaceMain(node) {
  const main = $("main.hero");
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
  main.replaceChildren(node);
}
function showTripCreated(result, hostName) {
  const panel = make("section", "result-panel");
  panel.append(make("p", "eyebrow", "YOUR TRIP IS READY"));
  panel.append(make("h2", "", "Share TripTune with your crew"));
  panel.append(make("p", "muted", "Share the trip code and group passkey with members. Never share your host password."));
  const label = make("label", "result-label", "TRIP CODE");
  const row = make("div", "code-row");
  row.append(make("strong", "trip-code", result.tripCode));
  const copy = make("button", "btn secondary", "Copy code");
  copy.type = "button";
  copy.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(result.tripCode); copy.textContent = "Copied!"; }
    catch { copy.textContent = result.tripCode; }
  });
  row.append(copy);
  panel.append(label, row);
  panel.append(make("p", "muted", `Host: ${hostName}. Keep both passwords safe. The group passkey is not the host password.`));
  const open = make("button", "btn primary full", "Open song dashboard →");
  open.type = "button";
  open.addEventListener("click", showDashboard);
  panel.append(open);
  replaceMain(panel);
}

function showDashboard() {
  if (!activeSession?.token) { clearSession(); location.reload(); return; }
  const panel = make("section", "dashboard");
  const top = make("div", "dashboard-top");
  const intro = make("div");
  intro.append(make("p", "eyebrow", activeSession.role === "host" ? "HOST DASHBOARD" : "TRIP MEMBER"));
  intro.append(make("h2", "", `Welcome, ${activeSession.displayName || "traveller"}!`));
  intro.append(make("p", "muted", activeSession.role === "host"
    ? "Play songs in your preferred music app, then mark them Played or Skipped here."
    : "Add requests to the shared queue. The host will play them in a separate music app."));
  const logout = make("button", "btn secondary", "Log out");
  logout.type = "button";
  logout.addEventListener("click", logoutSession);
  top.append(intro, logout);
  panel.append(top);

  //////////////////////////////////////////////////

  const requestForm = make("form", "request-form");
  requestForm.innerHTML = `
    <h3>Request a song</h3>
    <div class="request-grid">
      <div class="field"><label for="songTitle">Song title *</label><input id="songTitle" name="songTitle" required maxlength="150" placeholder="Song name"></div>
      <div class="field"><label for="artist">Singer / artist</label><input id="artist" name="artist" maxlength="100" placeholder="Artist name"></div>
      <div class="field"><label for="movieOrAlbum">Movie / album</label><input id="movieOrAlbum" name="movieOrAlbum" maxlength="120" placeholder="Optional"></div>
      <div class="field"><label for="songLink">Song link (optional)</label><input id="songLink" name="songLink" type="url" maxlength="500" placeholder="https://..."></div>
    </div>
    <p class="error request-error" role="alert"></p>
    <button class="btn primary" type="submit">＋ Add song request</button>`;
  requestForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const btn = requestForm.querySelector('button[type="submit"]');
    const msg = requestForm.querySelector(".request-error");
    msg.classList.remove("success-message");
    msg.textContent = "";
    btn.disabled = true;
    try {
      const d = Object.fromEntries(new FormData(requestForm).entries());
      await tripApi("add_request", {
        songTitle: d.songTitle, artist: d.artist, movieOrAlbum: d.movieOrAlbum,
        songLink: d.songLink, requesterName: activeSession.displayName
      }, activeSession.token);
      requestForm.reset();
      msg.textContent = "Request added to the shared queue.";
      msg.classList.add("success-message");
      await loadQueue();
    } catch (err) {
      msg.textContent = err.message;
      if (/session expired/i.test(err.message)) showExpired();
    } finally { btn.disabled = false; }
  });
  panel.append(requestForm);
  const list = make("div", "queue-list");
  list.id = "queueList";
  panel.append(list);
  replaceMain(panel);
  loadQueue();
  refreshTimer = setInterval(loadQueue, 12);

  const queueHeading = make("div", "queue-heading");
  queueHeading.append(make("h3", "", "Shared Song Queue"));
  const refresh = make("button", "btn secondary", "Refresh");
  refresh.type = "button";
  refresh.addEventListener("click", loadQueue);
  queueHeading.append(refresh);
  panel.append(queueHeading);
  
}

async function loadQueue() {
  const list = $("#queueList");
  if (!list || !activeSession?.token || queueLoading) return;
  queueLoading = true;
  try {
    const result = await tripApi("get_queue", {}, activeSession.token);
    list.replaceChildren();
    if (!result.requests?.length) {
      list.append(make("p", "empty-state", "No song requests yet. Be the first to add one!"));
      return;
    }
    result.requests.forEach((song, index) => {
      const card = make("article", `song-card status-${song.status}`);
      card.append(make("div", "song-number", String(index + 1).padStart(2, "0")));
      const details = make("div", "song-details");
      details.append(make("h4", "", song.song_title));
      const meta = [song.artist, song.movie_or_album].filter(Boolean).join(" · ");
      if (meta) details.append(make("p", "muted", meta));
      details.append(make("p", "requester", `Requested by ${song.requester_name}`));
      if (song.song_link) {
        const link = make("a", "song-link", "Open song link ↗");
        link.href = song.song_link; link.target = "_blank"; link.rel = "noopener noreferrer";
        details.append(link);
      }
      card.append(details);
      card.append(make("span", `status-pill ${song.status}`,
        song.status === "pending" ? "Pending" : song.status === "played" ? "✓ Played" : "Skipped"));
      if (activeSession.role === "host" && song.status === "pending") {
        const actions = make("div", "song-actions");
        const played = make("button", "btn small played-btn", "✓ Played");
        played.type = "button"; played.addEventListener("click", () => updateStatus(song.id, "played"));
        const skipped = make("button", "btn small secondary", "Skip");
        skipped.type = "button"; skipped.addEventListener("click", () => updateStatus(song.id, "skipped"));
        actions.append(played, skipped); card.append(actions);
      }
      list.append(card);
    });
  } catch (err) {
    list.replaceChildren(make("p", "error", err.message));
    if (/session expired/i.test(err.message)) showExpired();
  } finally { queueLoading = false; }
}
async function updateStatus(requestId, status) {
  try {
    await tripApi("update_request_status", { requestId, status }, activeSession.token);
    await loadQueue();
  } catch (err) {
    alert(err.message);
    if (/session expired/i.test(err.message)) showExpired();
  }
}
async function logoutSession() {
  try { if (activeSession?.token) await tripApi("logout", {}, activeSession.token); } catch {}
  clearSession();
  location.reload();
}
function showExpired() {
  clearSession();
  const panel = make("section", "result-panel");
  panel.append(make("h2", "", "Session expired"));
  panel.append(make("p", "muted", "Please log in again with your trip code and password."));
  const btn = make("button", "btn primary", "Back to TripTune");
  btn.type = "button"; btn.addEventListener("click", () => location.reload());
  panel.append(btn); replaceMain(panel);
}
async function restoreSession() {
  if (!activeSession?.token) return;
  if (Date.now() - (activeSession.savedAt || 0) > 12 * 60 * 60 * 1000) {
    clearSession(); return;
  }
  try {
    await tripApi("get_queue", {}, activeSession.token);
    showDashboard();
  } catch { clearSession(); }
}
restoreSession();
