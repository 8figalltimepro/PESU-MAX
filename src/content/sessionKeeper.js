import { load, save, remove } from "../utils/storage.js";
import { resetCsrfToken } from "../helpers/pesuAPI.js";

const ACADEMY_BASE_URL = "https://www.pesuacademy.com/Academy";
const PROFILE_PATH = "/s/studentProfilePESU";
const CREDENTIAL_KEY = "academyAuth";
// 4 minutes keeps the traffic quiet; an untouched session was measured dying
// inside five, and a repair (a real login POST) is what has to stay rare.
const PING_INTERVAL_MS = 4 * 60 * 1000;
const RELOGIN_GUARD_KEY = "pesuMaxReloginAt";
const REJECT_COUNT_KEY = "pesuMaxRejectCount";
const REJECT_BACKOFF_MS = 15 * 60 * 1000;
const MAX_REJECTIONS = 3;
const LOGIN_PAGE_GRACE_MS = 1000;

function hasLoginForm() {
  return Boolean(document.querySelector('input[name="j_password"]'));
}

function loginFormEngaged() {
  const passwordField = document.querySelector('input[name="j_password"]');
  if (!passwordField) return false;

  const usernameField = document.querySelector('input[name="j_username"]');
  const form = passwordField.closest("form");

  return Boolean(usernameField && usernameField.value) ||
    Boolean(passwordField.value) ||
    Boolean(form && document.activeElement && form.contains(document.activeElement));
}

// The profile page answers with the login page when the session is dead, so the
// final URL tells us everything and the body never has to be downloaded.
async function probeSession() {
  const controller = new AbortController();

  try {
    const response = await fetch(`${ACADEMY_BASE_URL}${PROFILE_PATH}`, {
      credentials: "include",
      redirect: "follow",
      signal: controller.signal
    });

    const alive = response.url.includes(PROFILE_PATH);
    controller.abort();
    return alive;
  } catch (error) {
    return null;
  }
}

async function readLoginToken() {
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch(`${ACADEMY_BASE_URL}/`, { credentials: "include" });
    const html = await response.text();
    const match =
      html.match(/name="_csrf"[^>]*value="([^"]+)"/i) ||
      html.match(/value="([^"]+)"[^>]*name="_csrf"/i);

    if (match) return match[1];
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return null;
}

async function loginToAcademy({ username, password }) {
  const token = await readLoginToken();

  if (!token) {
    throw new Error("Unable to read academy login token");
  }

  const controller = new AbortController();
  const response = await fetch(`${ACADEMY_BASE_URL}/j_spring_security_check`, {
    method: "POST",
    credentials: "include",
    redirect: "follow",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      _csrf: token,
      j_username: username,
      j_password: password
    }).toString(),
    signal: controller.signal
  });

  const loggedIn = response.url.includes(PROFILE_PATH);
  controller.abort();
  return loggedIn;
}

async function readStoredCredentials() {
  const stored = await load(CREDENTIAL_KEY);
  if (!stored || !stored.username || !stored.password) {
    return null;
  }

  try {
    return { username: atob(stored.username), password: atob(stored.password) };
  } catch (error) {
    return null;
  }
}

async function storeCredentials(username, password) {
  await save(CREDENTIAL_KEY, {
    username: btoa(username),
    password: btoa(password),
    updatedAt: Date.now()
  });
}

// Only ever called on a session that works, so a stale pair cannot stick around.
async function captureCredentials() {
  const username = localStorage.getItem("clientusername");
  const password = localStorage.getItem("clientpassword");
  if (!username || !password) return;

  const stored = await readStoredCredentials();
  if (stored && stored.username === username && stored.password === password) return;

  await storeCredentials(username, password);
}

// Returns "ok", "failed" or "skipped".
async function attemptReLogin() {
  const blockedUntil = Number(sessionStorage.getItem(RELOGIN_GUARD_KEY) || 0);
  if (Date.now() < blockedUntil) return "skipped";
  sessionStorage.setItem(RELOGIN_GUARD_KEY, String(Date.now() + PING_INTERVAL_MS));

  const credentials = await readStoredCredentials();
  if (!credentials) {
    console.log("[PESU-MAX] no stored academy credentials; silent re-login skipped");
    return "skipped";
  }

  let loggedIn = false;
  try {
    loggedIn = await loginToAcademy(credentials);
  } catch (error) {
    console.warn("[PESU-MAX] academy re-login failed:", error.message);
    return "failed";
  }

  if (loggedIn) {
    sessionStorage.removeItem(REJECT_COUNT_KEY);
    resetCsrfToken();
    await captureCredentials();
    return "ok";
  }

  // A rejection is not proof the stored pair is wrong: the server can demand a
  // captcha or rate-limit the attempt. Back off, and only discard the pair once
  // it keeps failing, so a transient refusal cannot break silent re-login.
  const rejections = Number(sessionStorage.getItem(REJECT_COUNT_KEY) || 0) + 1;
  sessionStorage.setItem(REJECT_COUNT_KEY, String(rejections));
  sessionStorage.setItem(RELOGIN_GUARD_KEY, String(Date.now() + REJECT_BACKOFF_MS));

  if (rejections >= MAX_REJECTIONS) {
    await remove(CREDENTIAL_KEY);
    console.warn("[PESU-MAX] stored academy credentials were rejected repeatedly; cleared");
  } else {
    console.warn(`[PESU-MAX] academy re-login rejected (${rejections}/${MAX_REJECTIONS}); credentials kept`);
  }
  return "failed";
}

// An app page: keep the session warm, and repair it in place when it dies. The
// page keeps its DOM, scroll and SPA state; only the cookie jar changes.
// ponytail: a login form open in another tab can still have its token
// invalidated by this tab's probes; reloading that tab recovers. Coordinate
// across tabs through localStorage if that ever actually bites.
async function settleAppPage() {
  if ((await probeSession()) !== false) return;

  await attemptReLogin();
}

// A login page, where the session is already known to be dead — so nothing here
// probes. An authenticated request with a dead session makes the site run its
// own /logout chain, which invalidates the token this form was rendered with and
// turns a human's login into "Invalid CSRF Token".
async function settleLoginPage() {
  if (loginFormEngaged()) return;

  // The server adds a captcha after repeated logins and the page injects it
  // client-side, so only the rendered DOM reveals it. Waiting for a human beats
  // posting an attempt that cannot succeed.
  if (document.querySelector("#captchaInput, #captchaImg")) {
    console.warn("[PESU-MAX] academy login is captcha-gated right now; waiting for a manual login");
    sessionStorage.setItem(RELOGIN_GUARD_KEY, String(Date.now() + REJECT_BACKOFF_MS));
    return;
  }

  const result = await attemptReLogin();

  if (result === "ok") {
    location.replace(`${ACADEMY_BASE_URL}${PROFILE_PATH}`);
    return;
  }

  // A failed attempt rotates the server session, leaving this form's token
  // stale, so reload once to hand over a usable form.
  if (result === "failed") location.reload();
}

async function settleSession() {
  if (hasLoginForm()) {
    await settleLoginPage();
    return;
  }

  await settleAppPage();
}

export function startSessionKeeper() {
  if (hasLoginForm()) {
    setTimeout(() => void settleSession(), LOGIN_PAGE_GRACE_MS);
  } else if (location.pathname.startsWith("/Academy/s/")) {
    void settleSession();
  }

  setInterval(() => void settleSession(), PING_INTERVAL_MS);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void settleSession();
  });
}
