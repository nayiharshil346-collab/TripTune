/* =========================================================
   TripTune app.js
   Sections: API, saved session, login forms, trip result,
   dashboard rendering, queue loading, host actions, restore.
   ========================================================= */

/* ---------- 1. API and app constants ---------- */
const API_URL = "https://riliocarlwqaajsuzlyz.supabase.co/functions/v1/trip-api";
const SESSION_KEY = "triptune_session_v1";
const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000; // Backend sessions currently expire after 12 hours.
const $ = (selector) => document.querySelector(selector);

/* Send one action to the Supabase Edge Function. */
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
  try {
    result = await response.json();
  } catch {
    throw new Error("Unexpected server response. Check your Edge Function deployment.");
  }

  if (!response.ok) {
    throw new Error(result.error || `Request failed (${response.status})`);
  }

  return result;
}

/* ---------- 2. Page elements and application state ---------- */
const dialog = $("#tripDialog");
const fields = $("#dialogFields");
const form = $("#tripForm");
const errorBox = $("#formError");
const submit = $("#submitBtn");

let currentMode = "";
let activeSession = readSession();
let refreshTimer = null;
let queueLoading = false;

/* Form configurations: each field is [id, label, placeholder, type, isPassword]. */
const configs = {
  create: {
    eyebrow: "START YOUR VIBES",
    title: "Create your trip",
    description: "Create a room for your group. The group passkey and host password must be different.",
    button: "Create Trip",
    fields: [
      ["hostName", "Your name", "e.g. Tony Stark", "text", false],
      ["tripName", "Trip name", "e.g. Ahmedabad to Udaipur", "text", false],
      ["memberPasskey", "Group passkey", "Choose an easy group passkey", "password", true],
      ["hostPassword", "Your host password", "Choose a separate host password", "password", true]
    ]
  },
  join: {
    eyebrow: "JOIN YOUR GROUP",
    title: "Join a trip",
    description: "Ask the host for the trip code and group passkey.",
    button: "Join Trip",
    fields: [
      ["tripCode", "Trip code", "Enter the trip code", "text", false],
      ["memberName", "Your name", "What should we call you?", "text", false],
      ["memberPasskey", "Group passkey", "Enter the group passkey", "password", true]
    ]
  },
  host: {
    eyebrow: "HOST ACCESS",
    title: "Welcome back, Host",
    description: "Enter the trip code and your separate host password.",
    button: "Host Login",
    fields: [
      ["tripCode", "Trip code", "Enter the trip code", "text", false],
      ["hostName", "Your name", "Enter your host name", "text", false],
      ["hostPassword", "Host password", "Enter your host password", "password", true]
    ]
  }
};

/* ---------- 3. Persistent browser session ---------- */
/* localStorage survives closing the browser tab/window.
   The server token still expires after the backend's configured lifetime. */
function readSession() {
  try {
    const saved = localStorage.getItem(SESSION_KEY);
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
}

function saveSession(result, displayName, tripName = "") {
  activeSession = { ...result, displayName, ...(tripName ? { tripName } : {}), savedAt: Date.now() };
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(activeSession));
  } catch {
    // If browser storage is blocked, the current page session can still work.
  }
}

function clearSession() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;

  try {
    localStorage.removeItem(SESSION_KEY);
    // Remove the older key too, if an earlier version used sessionStorage.
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Ignore storage cleanup errors; clear in-memory state regardless.
  }

  activeSession = null;
}

/* ---------- 4. Small DOM helper and dynamic login forms ---------- */
function make(tag, className = "", text = "") {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== "") element.textContent = text;
  return element;
}

function openForm(mode) {
  currentMode = mode;
  const config = configs[mode];

  $("#dialogEyebrow").textContent = config.eyebrow;
  $("#dialogTitle").textContent = config.title;
  $("#dialogDescription").textContent = config.description;
  submit.textContent = config.button;
  errorBox.textContent = "";
  fields.replaceChildren();

  config.fields.forEach(([id, label, placeholder, type, isPassword]) => {
    const wrapper = make("div", "field");
    const labelElement = make("label", "", label);
    const input = make("input");

    labelElement.htmlFor = id;
    input.id = id;
    input.name = id;
    input.type = type;
    input.placeholder = placeholder;
    input.required = true;
    input.autocomplete = isPassword
      ? (mode === "host" && id === "hostPassword" ? "current-password" : "new-password")
      : "off";

    // Password/passkey length: allow 1–128 characters in the UI.
    // The deployed Edge Function must also allow this range.
    input.maxLength = isPassword ? 128
      : id === "tripName" ? 70
      : id === "memberName" || id === "hostName" ? 50
      : 150;

    if (isPassword) input.minLength = 1;

    wrapper.append(labelElement, input);
    fields.append(wrapper);
  });

  dialog.showModal();
}

/* Buttons open the matching modal form. */
$("#createBtn").addEventListener("click", () => openForm("create"));
$("#joinBtn").addEventListener("click", () => openForm("join"));
$("#hostBtn").addEventListener("click", () => openForm("host"));
$("#closeDialog").addEventListener("click", () => dialog.close());

dialog.addEventListener("close", () => {
  form.reset();
  errorBox.textContent = "";
});

/* ---------- 5. Submit create / join / host login ---------- */
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorBox.textContent = "";
  submit.disabled = true;
  submit.textContent = "Please wait…";

  const values = Object.fromEntries(new FormData(form).entries());

  try {
    let result;

    if (currentMode === "create") {
      result = await tripApi("create_trip", {
        tripName: values.tripName,
        memberPasskey: values.memberPasskey,
        hostPassword: values.hostPassword
      });

      saveSession(result, values.hostName.trim(), values.tripName.trim());
      dialog.close();
      showTripCreated(result, values.hostName.trim());
    } else if (currentMode === "join") {
      result = await tripApi("join_trip", {
        tripCode: values.tripCode,
        memberPasskey: values.memberPasskey,
        memberName: values.memberName
      });

      saveSession(result, values.memberName.trim());
      dialog.close();
      showDashboard();
    } else if (currentMode === "host") {
      result = await tripApi("host_login", {
        tripCode: values.tripCode,
        hostPassword: values.hostPassword
      });

      saveSession(result, values.hostName.trim());
      dialog.close();
      showDashboard();
    }
  } catch (error) {
    errorBox.textContent = error.message || "Something went wrong. Try again.";
  } finally {
    submit.disabled = false;
    submit.textContent = configs[currentMode]?.button || "Continue";
  }
});

/* ---------- 6. Replace main content safely ---------- */
function replaceMain(node) {
  const main = $("main.hero");

  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;

  main.replaceChildren(node);
}

/* After creating a trip, show its trip code before opening the dashboard. */
function showTripCreated(result, hostName) {
  const panel = make("section", "result-panel");
  panel.append(make("p", "eyebrow", "YOUR TRIP IS READY"));
  panel.append(make("h2", "", "Share TripTune with your crew"));
  panel.append(make("p", "muted",
    "Share the trip code and group passkey with members. Never share your host password."));

  const label = make("label", "result-label", "TRIP CODE");
  const row = make("div", "code-row");
  const code = make("strong", "trip-code", result.tripCode);
  const copy = make("button", "btn secondary", "Copy code");
  copy.type = "button";

  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(result.tripCode);
      copy.textContent = "Copied!";
    } catch {
      copy.textContent = result.tripCode;
    }
  });

  row.append(code, copy);
  panel.append(label, row);
  panel.append(make("p", "muted",
    `Host: ${hostName}. Keep both passwords safe. The group passkey is not the host password.`));

  const openDashboard = make("button", "btn primary full", "Open song dashboard →");
  openDashboard.type = "button";
  openDashboard.addEventListener("click", showDashboard);
  panel.append(openDashboard);

  replaceMain(panel);
}

/* ---------- 7. Dashboard ---------- */
/* Room header → live statistics → queue with refresh → request form. */
function showDashboard() {
  if (!activeSession?.token) { clearSession(); location.reload(); return; }
  const panel = make("section", "dashboard");

  // Trip name and LIVE badge, styled like the supplied dashboard reference.
  const roomHeader = make("div", "trip-room-header");
  const roomIntro = make("div");
  roomIntro.append(make("p", "trip-room-kicker", "TRIPTUNE · LIVE ROOM"));
  roomIntro.append(make("h2", "trip-room-title", "Your Road Trip 🚗"));
  roomIntro.append(make("p", "trip-route", activeSession.tripName || activeSession.trip_name || activeSession.route || activeSession.tripRoute || "Trip name loading…"));
  roomHeader.append(roomIntro, make("span", "trip-live-badge", "LIVE"));
  panel.append(roomHeader);

  // Stats cards: members, all song requests, and songs marked as played.
  const stats = make("div", "trip-stats");
  const membersStat = make("article", "trip-stat members");
  membersStat.append(make("span", "trip-stat-icon", "♧"), make("strong", "trip-stat-number", String(activeSession.memberCount ?? activeSession.member_count ?? 1)), make("span", "trip-stat-label", "Members"));
  const requestsStat = make("article", "trip-stat requests");
  requestsStat.append(make("span", "trip-stat-icon", "♫"), make("strong", "trip-stat-number", "0"), make("span", "trip-stat-label", "Requests"));
  requestsStat.querySelector(".trip-stat-number").id = "totalRequestsStat";
  const playedStat = make("article", "trip-stat played");
  playedStat.append(make("span", "trip-stat-icon", "☑"), make("strong", "trip-stat-number", "0"), make("span", "trip-stat-label", "Played"));
  playedStat.querySelector(".trip-stat-number").id = "playedRequestsStat";
  stats.append(membersStat, requestsStat, playedStat); panel.append(stats);

  // Existing welcome text and logout action remain available.
  const top = make("div", "dashboard-top"); const intro = make("div");
  intro.append(make("p", "eyebrow", activeSession.role === "host" ? "HOST DASHBOARD" : "TRIP MEMBER"));
  intro.append(make("h2", "", `Welcome, ${activeSession.displayName || "traveller"}!`));
  intro.append(make("p", "muted", activeSession.role === "host" ? "Play songs in your preferred music app, then mark them Played or Skipped here." : "Add requests to the shared queue. The host will play them in a separate music app."));
  const logout = make("button", "btn secondary", "Log out"); logout.type = "button"; logout.addEventListener("click", logoutSession);
  top.append(intro, logout); panel.append(top);

  // Refresh button sits beside the shared queue heading.
  const queueHeading = make("div", "queue-heading"); queueHeading.append(make("h3", "", "Up Next"));
  const refresh = make("button", "btn secondary", "↻ Refresh"); refresh.type = "button"; refresh.addEventListener("click", loadQueue);
  queueHeading.append(refresh); panel.append(queueHeading);
  const list = make("div", "queue-list"); list.id = "queueList"; list.setAttribute("aria-live", "polite"); panel.append(list);

  const requestForm = make("form", "request-form");
  requestForm.innerHTML = `
    <div class="request-form-head"><h3>＋ Request a Song</h3></div>
    <div class="request-grid">
      <div class="field"><label for="songTitle">Song title *</label><input id="songTitle" name="songTitle" required maxlength="150" placeholder="Song name"></div>
      <div class="field"><label for="artist">Singer / artist</label><input id="artist" name="artist" maxlength="100" placeholder="Artist name"></div>
      <div class="field"><label for="movieOrAlbum">Movie / album</label><input id="movieOrAlbum" name="movieOrAlbum" maxlength="120" placeholder="Optional"></div>
      <div class="field"><label for="songLink">Song link (optional)</label><input id="songLink" name="songLink" type="url" maxlength="500" placeholder="https://..."></div>
    </div>
    <p class="error request-error" role="alert" aria-live="polite"></p>
    <button class="btn primary full" type="submit">＋ Add song request</button>`;
  requestForm.addEventListener("submit", async (event) => {
    event.preventDefault(); const button = requestForm.querySelector('button[type="submit"]'); const message = requestForm.querySelector(".request-error");
    message.classList.remove("success-message"); message.textContent = ""; button.disabled = true;
    try {
      const values = Object.fromEntries(new FormData(requestForm).entries());
      await tripApi("add_request", {songTitle:values.songTitle,artist:values.artist,movieOrAlbum:values.movieOrAlbum,songLink:values.songLink,requesterName:activeSession.displayName}, activeSession.token);
      requestForm.reset(); message.textContent = "Request added to the shared queue."; message.classList.add("success-message"); await loadQueue();
    } catch(error) { message.textContent = error.message; if (/session expired/i.test(error.message)) showExpired(); }
    finally { button.disabled = false; }
  });
  panel.append(requestForm); replaceMain(panel); loadQueue(); refreshTimer = setInterval(loadQueue, 12000);
}

/* ---------- 8. Load and render the shared queue ---------- */
async function loadQueue() {
  const list = $("#queueList");
  if (!list || !activeSession?.token || queueLoading) return;

  queueLoading = true;

  try {
    const result = await tripApi("get_queue", {}, activeSession.token);
    list.replaceChildren();
    const requests = Array.isArray(result.requests) ? result.requests : [];
    // Optional trip metadata must be returned by get_queue to display live values.
    if (result.tripName || result.trip_name) {
      activeSession.tripName = result.tripName || result.trip_name;
      const route = document.querySelector(".trip-route"); if (route) route.textContent = activeSession.tripName;
    }
    const memberCount = result.memberCount ?? result.member_count ?? result.members?.length;
    if (memberCount !== undefined) {
      activeSession.memberCount = memberCount;
      const memberNode = document.querySelector(".trip-stat.members .trip-stat-number"); if (memberNode) memberNode.textContent = String(memberCount);
    }
    const totalNode = $("#totalRequestsStat"), playedNode = $("#playedRequestsStat");
    if (totalNode) totalNode.textContent = String(requests.length);
    if (playedNode) playedNode.textContent = String(requests.filter(song => song.status === "played").length);
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(activeSession)); } catch {}
    if (!requests.length) { list.append(make("p", "empty-state", "No song requests yet. Be the first to add one!")); return; }
    requests.forEach((song, index) => {
      const card = make("article", `song-card status-${song.status}`);
      card.append(make("div", "song-number", String(index + 1).padStart(2, "0")));

      const details = make("div", "song-details");
      details.append(make("h4", "", song.song_title));

      const metadata = [song.artist, song.movie_or_album].filter(Boolean).join(" · ");
      if (metadata) details.append(make("p", "muted", metadata));

      details.append(make("p", "requester", `Requested by ${song.requester_name}`));

      if (song.song_link) {
        const link = make("a", "song-link", "Open song link ↗");
        link.href = song.song_link;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        details.append(link);
      }

      card.append(details);

      const statusText = song.status === "pending" ? "Pending"
        : song.status === "played" ? "✓ Played"
        : "Skipped";
      card.append(make("span", `status-pill ${song.status}`, statusText));

      // Only the host sees Played / Skip controls for pending requests.
      if (activeSession.role === "host" && song.status === "pending") {
        const actions = make("div", "song-actions");

        const played = make("button", "btn small played-btn", "✓ Played");
        played.type = "button";
        played.addEventListener("click", () => updateStatus(song.id, "played"));

        const skipped = make("button", "btn small secondary", "Skip");
        skipped.type = "button";
        skipped.addEventListener("click", () => updateStatus(song.id, "skipped"));

        actions.append(played, skipped);
        card.append(actions);
      }

      list.append(card);
    });
  } catch (error) {
    list.replaceChildren(make("p", "error", error.message));
    if (/session expired/i.test(error.message)) showExpired();
  } finally {
    queueLoading = false;
  }
}

/* ---------- 9. Host actions, logout and expired sessions ---------- */
async function updateStatus(requestId, status) {
  try {
    await tripApi("update_request_status", { requestId, status }, activeSession.token);
    await loadQueue();
  } catch (error) {
    alert(error.message);
    if (/session expired/i.test(error.message)) showExpired();
  }
}

async function logoutSession() {
  try {
    if (activeSession?.token) await tripApi("logout", {}, activeSession.token);
  } catch {
    // Clear local session even if the network is unavailable.
  }

  clearSession();
  location.reload();
}

function showExpired() {
  clearSession();

  const panel = make("section", "result-panel");
  panel.append(make("h2", "", "Session expired"));
  panel.append(make("p", "muted",
    "Your session expired. Please log in again with your trip code and password."));

  const button = make("button", "btn primary", "Back to TripTune");
  button.type = "button";
  button.addEventListener("click", () => location.reload());
  panel.append(button);

  replaceMain(panel);
}

/* ---------- 10. Restore login after reopening the website ---------- */
/* Validate the saved token with the backend before showing the dashboard. */
async function restoreSession() {
  if (!activeSession?.token) return;

  const savedAt = Number(activeSession.savedAt || 0);
  if (!savedAt || Date.now() - savedAt > SESSION_MAX_AGE_MS) {
    clearSession();
    return;
  }

  try {
    await tripApi("get_queue", {}, activeSession.token);
    showDashboard();
  } catch {
    clearSession();
  }
}

/* Start restoring a saved member/host session when the page opens. */
restoreSession();



/* ========== EMAILJS FEEDBACK SYSTEM ========== */

// Replace these three values with your own EmailJS details.
const EMAILJS_PUBLIC_KEY = "RsxrowgbVN97v98jA";
const EMAILJS_SERVICE_ID = "service_9esi94e";
const EMAILJS_TEMPLATE_ID = "template_bfadleu";

const feedbackForm = document.getElementById("feedbackForm");
const openFeedbackBtn = document.getElementById("openFeedbackBtn");
const feedbackFormWrap = document.getElementById("feedbackFormWrap");
const feedbackStatus = document.getElementById("feedbackStatus");
const feedbackSubmitBtn = document.getElementById("feedbackSubmitBtn");
const feedbackPageUrl = document.getElementById("feedbackPageUrl");

// Open/close the feedback form.
openFeedbackBtn.addEventListener("click", () => {
  const isOpening = feedbackFormWrap.hidden;

  feedbackFormWrap.hidden = !isOpening;
  openFeedbackBtn.setAttribute("aria-expanded", String(isOpening));

  if (isOpening) {
    feedbackFormWrap.scrollIntoView({
      behavior: "smooth",
      block: "nearest"
    });
  }
});

// Initialize EmailJS after its library loads.
if (window.emailjs) {
  emailjs.init({
    publicKey: EMAILJS_PUBLIC_KEY
  });
} else {
  console.error("EmailJS library did not load.");
}

// Send the rating and message to your EmailJS email template.
feedbackForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  feedbackStatus.className = "";
  feedbackStatus.textContent = "";

  if (
    EMAILJS_PUBLIC_KEY === "YOUR_PUBLIC_KEY" ||
  EMAILJS_SERVICE_ID === "YOUR_SERVICE_ID" ||
  EMAILJS_TEMPLATE_ID === "YOUR_TEMPLATE_ID"
  ) {
    feedbackStatus.textContent =
      "Please configure your EmailJS keys first.";
    feedbackStatus.classList.add("failure");
    return;
  }

  const rating = feedbackForm.querySelector(
    'input[name="rating"]:checked'
  );

  if (!rating) {
    feedbackStatus.textContent = "Please select a star rating.";
    feedbackStatus.classList.add("failure");
    return;
  }

  feedbackPageUrl.value = window.location.href;
  feedbackSubmitBtn.disabled = true;
  feedbackSubmitBtn.textContent = "Sending...";

  try {
    await emailjs.sendForm(
      EMAILJS_SERVICE_ID,
      EMAILJS_TEMPLATE_ID,
      feedbackForm
    );

    feedbackStatus.textContent =
      "Thank you! Your feedback has been sent successfully.";
    feedbackStatus.classList.add("success");

    feedbackForm.reset();
  } catch (error) {
    console.error("EmailJS feedback error:", error);

    feedbackStatus.textContent =
      "Could not send feedback. Please try again later.";
    feedbackStatus.classList.add("failure");
  } finally {
    feedbackSubmitBtn.disabled = false;
    feedbackSubmitBtn.textContent = "Send Feedback ✉";
  }
});

// ========== END EMAILJS FEEDBACK SYSTEM ==========
