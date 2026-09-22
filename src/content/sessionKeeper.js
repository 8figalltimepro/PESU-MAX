// Policy only: when to probe the academy, when to re-login, when to give up.
// The HTTP lives in helpers/academyAuth.js, the stored login in helpers/academyCredentials.js, the page in academyPage.js.
import { load } from "../utils/storage.js";
import { RELOGIN_GUARD_KEY, REJECT_COUNT_KEY, SESSION_KEEPER_KEY } from "../utils/storageKeys.js";
import { ACADEMY_BASE_URL, ACADEMY_PROFILE_PATH, loginToAcademy, probeSession } from "../helpers/academyAuth.js";
import { captureCredentials, forgetStoredCredentials, readStoredCredentials } from "../helpers/academyCredentials.js";
import { resetCsrfToken } from "../helpers/pesuAPI.js";
import {
  ACADEMY_APP_PATH_PREFIX,
  LOG_PREFIX,
  hasCaptchaGate,
  hasLoginForm,
  loginFormEngaged
} from "./academyPage.js";

// Check Interval: 4 mins
const SESSION_PING_INTERVAL_MS = 4 * 60 * 1000;
const RELOGIN_MIN_GAP_MS = SESSION_PING_INTERVAL_MS;
const RELOGIN_BACKOFF_MS = 15 * 60 * 1000;
const MAX_RELOGIN_REJECTIONS = 3;
const LOGIN_PAGE_GRACE_MS = 1000;

// Returns "ok", "failed" or "skipped".
async function attemptReLogin() {
  const blockedUntil = Number(sessionStorage.getItem(RELOGIN_GUARD_KEY) || 0);
  if (Date.now() < blockedUntil) return "skipped";
  sessionStorage.setItem(RELOGIN_GUARD_KEY, String(Date.now() + RELOGIN_MIN_GAP_MS));

  const credentials = await readStoredCredentials();
  if (!credentials) {
    console.log(`${LOG_PREFIX} no stored academy credentials; silent re-login skipped`);
    return "skipped";
  }

  let loggedIn = false;
  try {
    loggedIn = await loginToAcademy(credentials);
  } catch (error) {
    console.warn(`${LOG_PREFIX} academy re-login failed:`, error.message);
    return "failed";
  }

  if (loggedIn) {
    sessionStorage.removeItem(REJECT_COUNT_KEY);
    resetCsrfToken();
    await captureCredentials();
    return "ok";
  }

  // Keep the credentials on a rejection; the refusal may be temporary.
  const rejections = Number(sessionStorage.getItem(REJECT_COUNT_KEY) || 0) + 1;
  sessionStorage.setItem(REJECT_COUNT_KEY, String(rejections));
  sessionStorage.setItem(RELOGIN_GUARD_KEY, String(Date.now() + RELOGIN_BACKOFF_MS));

  if (rejections >= MAX_RELOGIN_REJECTIONS) {
    await forgetStoredCredentials();
    console.warn(`${LOG_PREFIX} stored academy credentials were rejected repeatedly; cleared`);
  } else {
    console.warn(`${LOG_PREFIX} academy re-login rejected (${rejections}/${MAX_RELOGIN_REJECTIONS}); credentials kept`);
  }
  return "failed";
}

// A normal page: keep the session alive and repair it in place when it dies.
// ponytail: a login form in another tab can still be invalidated by these probes.
async function settleAppPage() {
  if ((await probeSession()) !== false) return;

  await attemptReLogin();
}

// A login page: never probe here, it invalidates the token in this form.
async function settleLoginPage() {
  if (loginFormEngaged()) return;

  // A captcha means a human has to log in, so wait.
  if (hasCaptchaGate()) {
    console.warn(`${LOG_PREFIX} academy login is captcha-gated right now; waiting for a manual login`);
    sessionStorage.setItem(RELOGIN_GUARD_KEY, String(Date.now() + RELOGIN_BACKOFF_MS));
    return;
  }

  const result = await attemptReLogin();

  if (result === "ok") {
    location.replace(`${ACADEMY_BASE_URL}${ACADEMY_PROFILE_PATH}`);
    return;
  }

  // The attempt staled this form, so reload once for a usable one.
  if (result === "failed") location.reload();
}

async function settleSession() {
  // Off until it is switched on in Settings.
  if ((await load(SESSION_KEEPER_KEY)) !== true) return;

  if (hasLoginForm()) {
    await settleLoginPage();
    return;
  }

  await settleAppPage();
}

export function startSessionKeeper() {
  if (hasLoginForm()) {
    setTimeout(() => void settleSession(), LOGIN_PAGE_GRACE_MS);
  } else if (location.pathname.startsWith(ACADEMY_APP_PATH_PREFIX)) {
    void settleSession();
  }

  setInterval(() => void settleSession(), SESSION_PING_INTERVAL_MS);

  // Take effect as soon as the setting is switched on or off.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[SESSION_KEEPER_KEY]) void settleSession();
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void settleSession();
  });
}
