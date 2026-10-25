"use client";

import { useEffect, useSyncExternalStore } from "react";
import { aiApiOrigin } from "@/lib/ai-conversation";

export interface MemberUser {
  id: string;
  username: string;
  name: string;
  birthDate: string;
  age: number;
  historyConsent: boolean;
}
export interface MemberQuota { limit: number; used: number; remaining: number; resetAt: string }
interface MemberState {
  configured: boolean;
  loading: boolean;
  accessToken: string | null;
  user: MemberUser | null;
  quota: MemberQuota | null;
  error: string | null;
  expiresAt?: number;
  remembered: boolean;
  recoveryReady: boolean;
  recoveryCode: string | null;
}
interface MemberSessionResponse {
  accessToken: string;
  expiresAt: number;
  user: MemberUser;
  quota: MemberQuota;
  recoveryReady?: boolean;
  recoveryCode?: string;
  serverId?: string;
  rememberToken?: string;
  rememberExpiresAt?: number;
  clientId?: string;
}
export interface MemberSignup {
  username: string;
  password: string;
  name: string;
  birthDate: string;
  privacyAccepted: true;
  historyConsent: boolean;
  rememberDevice?: boolean;
}
interface RememberedDevice {
  clientId: string;
  rememberToken: string;
  expiresAt: number;
  serverId: string;
}

export const MEMBER_LOGIN_EVENT = "evan:member-login";
export const MEMBER_SESSION_EVENT = "evan:member-session";
const storageKey = "evan-member-session";
const deviceKey = "evan-member-device";
const initial: MemberState = {
  configured: false, loading: true, accessToken: null, user: null, quota: null,
  error: null, remembered: false, recoveryReady: false, recoveryCode: null,
};
let state = initial;
let serverId = "";
let initialized = false;
let eventsBound = false;
let initialization: Promise<void> | null = null;
let renewal: Promise<boolean> | null = null;
let expiry: ReturnType<typeof setTimeout> | undefined;
let generation = 0;
const listeners = new Set<() => void>();

export class MemberRequestError extends Error {
  constructor(public readonly status: number, message: string) { super(message); this.name = "MemberRequestError"; }
}
function emit(next: MemberState) {
  const previousOwner = state.user?.id;
  state = next;
  listeners.forEach(listener => listener());
  if (typeof window !== "undefined" && previousOwner !== next.user?.id)
    window.dispatchEvent(new Event(MEMBER_SESSION_EVENT));
}
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
function removeDevice() { try { localStorage.removeItem(deviceKey); } catch { /* Storage may be unavailable. */ } }
function readDevice(): RememberedDevice | null {
  try {
    const value = JSON.parse(localStorage.getItem(deviceKey) || "null");
    if (value && typeof value.clientId === "string" && /^[a-f0-9-]{36}$/i.test(value.clientId) &&
      typeof value.rememberToken === "string" && /^[A-Za-z0-9_-]{40,128}$/.test(value.rememberToken) &&
      typeof value.serverId === "string" && value.serverId === serverId &&
      typeof value.expiresAt === "number" && value.expiresAt > Date.now() / 1000 &&
      value.expiresAt <= Date.now() / 1000 + 30 * 86400 + 30) return value;
  } catch { /* Ignore malformed or unavailable storage. */ }
  return null;
}
export function clearMemberSession(message: string | null = null, forgetDevice = true) {
  generation += 1;
  clearTimeout(expiry);
  try { sessionStorage.removeItem(storageKey); } catch { /* Storage can be disabled. */ }
  if (forgetDevice) removeDevice();
  emit({ ...state, accessToken: null, user: null, quota: null, expiresAt: undefined,
    loading: false, remembered: false, recoveryReady: false, recoveryCode: null, error: message });
}
function validUser(value: unknown): value is MemberUser {
  if (!value || typeof value !== "object") return false;
  const user = value as MemberUser;
  return typeof user.id === "string" && user.id.length <= 100 &&
    typeof user.username === "string" && /^[a-zA-Z0-9_]{4,24}$/.test(user.username) &&
    typeof user.name === "string" && user.name.length <= 80 &&
    /^\d{4}-\d{2}-\d{2}$/.test(user.birthDate) && Number.isInteger(user.age) &&
    user.age >= 14 && user.age <= 150 && typeof user.historyConsent === "boolean";
}
function validQuota(value: unknown): value is MemberQuota {
  if (!value || typeof value !== "object") return false;
  const quota = value as MemberQuota;
  return quota.limit === 10 && Number.isInteger(quota.used) && quota.used >= 0 && quota.used <= quota.limit &&
    Number.isInteger(quota.remaining) && quota.remaining === quota.limit - quota.used &&
    typeof quota.resetAt === "string" && Number.isFinite(Date.parse(quota.resetAt));
}
function acceptSession(value: MemberSessionResponse, device: RememberedDevice | null = null) {
  if (typeof value.accessToken !== "string" || !value.accessToken || value.accessToken.length > 8192 ||
    !Number.isFinite(value.expiresAt) || value.expiresAt <= Date.now() / 1000 ||
    value.expiresAt > Date.now() / 1000 + 8 * 3600 + 30 ||
    !validUser(value.user) || !validQuota(value.quota))
    throw new Error("로그인 정보를 확인하지 못했습니다. 다시 시도해주세요.");
  clearTimeout(expiry);
  // Persist only authentication credentials when explicitly requested, never profile fields or passwords.
  emit({ configured: true, loading: false, accessToken: value.accessToken, expiresAt: value.expiresAt,
    user: value.user, quota: value.quota, error: null, remembered: Boolean(device),
    recoveryReady: value.recoveryReady === true,
    recoveryCode: typeof value.recoveryCode === "string" ? value.recoveryCode : state.recoveryCode });
  try {
    sessionStorage.setItem(storageKey, JSON.stringify({ accessToken: value.accessToken,
      expiresAt: value.expiresAt, origin: aiApiOrigin(), serverId, clientId: device?.clientId }));
  } catch { /* The current in-memory session remains usable. */ }
  expiry = setTimeout(() => { void renewExpiredSession(); }, Math.max(1, value.expiresAt * 1000 - Date.now()));
}

export async function memberRequest<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const origin = aiApiOrigin();
  if (!origin || !/^\/v1\/[a-zA-Z0-9/_-]+(?:\?[a-zA-Z0-9_=&%.-]*)?$/.test(path))
    throw new MemberRequestError(503, "회원 서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.");
  const token = state.accessToken;
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  let response: Response;
  try {
    response = await fetch(`${origin}${path}`, { ...init, headers, cache: "no-store", credentials: "omit",
      signal: init.signal || AbortSignal.timeout(20_000) });
  } catch { throw new MemberRequestError(0, "회원 서버에 연결하지 못했습니다. 네트워크를 확인한 뒤 다시 시도해주세요."); }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && token && token === state.accessToken && data?.code === "LOGIN_REQUIRED")
      clearMemberSession("로그인이 만료됐습니다. 다시 로그인해주세요.", false);
    const detail = data && typeof data.detail === "string" && data.detail.length <= 500 ? data.detail : null;
    throw new MemberRequestError(response.status, detail || (response.status === 429 ? "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." :
      response.status === 401 ? "먼저 로그인을 해주세요." : "요청을 처리하지 못했습니다. 다시 시도해주세요."));
  }
  return data as T;
}

async function restoreDevice() {
  const device = readDevice();
  if (!device) { removeDevice(); return false; }
  const current = generation;
  try {
    const value = await memberRequest<MemberSessionResponse>("/v1/members/remember", {
      method: "POST", body: JSON.stringify({ rememberToken: device.rememberToken, clientId: device.clientId }) });
    if (generation !== current || readDevice()?.rememberToken !== device.rememberToken) return false;
    if (value.serverId !== serverId || value.clientId !== device.clientId || value.rememberExpiresAt !== device.expiresAt)
      throw new Error("자동 로그인 정보를 확인하지 못했습니다.");
    acceptSession(value, device);
    return true;
  } catch (failure) {
    if (generation === current) {
      if (failure instanceof MemberRequestError && [400, 401, 403].includes(failure.status)) removeDevice();
      emit({ ...state, loading: false, error: failure instanceof Error ? failure.message : "자동 로그인에 실패했습니다." });
    }
    return false;
  }
}
async function renewExpiredSession() {
  if (!renewal) renewal = restoreDevice().finally(() => { renewal = null; });
  if (!await renewal && state.accessToken && (state.expiresAt ?? 0) <= Date.now() / 1000)
    clearMemberSession("로그인이 만료됐습니다. 다시 로그인해주세요.", false);
  return Boolean(state.accessToken);
}
export async function refreshMemberSession() {
  const token = state.accessToken;
  if (!token) { if (state.configured && readDevice()) await renewExpiredSession(); return; }
  try {
    const data = await memberRequest<{ user: MemberUser; quota: MemberQuota; recoveryReady: boolean }>("/v1/members/me");
    if (token !== state.accessToken) return;
    if (!validUser(data.user) || !validQuota(data.quota)) throw new Error();
    emit({ ...state, user: data.user, quota: data.quota, recoveryReady: data.recoveryReady === true, loading: false, error: null });
  } catch (failure) {
    if (failure instanceof MemberRequestError && failure.status === 401) { await renewExpiredSession(); return; }
    if (token === state.accessToken) emit({ ...state, loading: false,
      error: failure instanceof Error ? failure.message : "로그인 정보를 확인하지 못했습니다." });
  }
}
async function initializeMemberSession() {
  if (typeof window !== "undefined" && !eventsBound) {
    eventsBound = true;
    window.addEventListener("evan:refresh-member", () => { void refreshMemberSession(); });
    window.addEventListener("evan:member-expired", () => {
      clearMemberSession(null, false);
      void renewExpiredSession().then(ok => { if (!ok) requestMemberLogin(); });
    });
    window.addEventListener("focus", () => { void refreshMemberSession(); });
    window.addEventListener("storage", event => {
      if (event.key !== deviceKey) return;
      generation += 1;
      if (!event.newValue && state.remembered) clearMemberSession(null, false);
      else if (event.newValue && !state.user) void refreshMemberSession();
    });
    window.setInterval(() => { if (document.visibilityState === "visible") void refreshMemberSession(); }, 60_000);
  }
  const origin = aiApiOrigin();
  if (!origin) { emit({ ...initial, loading: false }); return; }
  emit({ ...state, loading: true, error: null });
  try {
    const config = await memberRequest<{ configured: boolean; mode: string; serverId?: string }>("/v1/auth/config");
    if (!config.configured || config.mode !== "member" || typeof config.serverId !== "string" || !/^[a-zA-Z0-9_-]{16,128}$/.test(config.serverId))
      throw new Error("회원 기능을 준비하고 있습니다. 잠시 후 다시 시도해주세요.");
    serverId = config.serverId;
    emit({ ...state, configured: true, loading: false, error: null });
    if (state.accessToken) { await refreshMemberSession(); return; }
    let saved: { origin?: string; serverId?: string; accessToken?: string; expiresAt?: number; clientId?: string } | null = null;
    try { saved = JSON.parse(sessionStorage.getItem(storageKey) || "null"); } catch { /* Ignore unreadable storage. */ }
    const device = readDevice();
    if (saved && (saved.origin === origin || (device && saved.serverId === serverId)) &&
      typeof saved.accessToken === "string" && saved.accessToken.length <= 8192 &&
      typeof saved.expiresAt === "number" && saved.expiresAt > Date.now() / 1000 && saved.expiresAt <= Date.now() / 1000 + 8 * 3600 + 30) {
      emit({ ...state, accessToken: saved.accessToken, expiresAt: saved.expiresAt, loading: true, remembered: Boolean(device && saved.clientId === device.clientId) });
      await refreshMemberSession();
      if (state.user && state.accessToken && state.quota)
        acceptSession({ accessToken: state.accessToken, expiresAt: state.expiresAt!, user: state.user, quota: state.quota, recoveryReady: state.recoveryReady }, state.remembered ? device : null);
    } else if (!await restoreDevice()) clearMemberSession(state.error, false);
  } catch (failure) {
    emit({ ...state, configured: false, loading: false, error: failure instanceof Error ? failure.message : "회원 서버에 연결하지 못했습니다." });
  }
}
async function retryConnection() {
  if (!initialization) initialization = initializeMemberSession().finally(() => { initialization = null; initialized = true; });
  await initialization;
}
async function authenticate(path: "login" | "signup", body: { username: string; password: string; rememberDevice?: boolean } | MemberSignup) {
  emit({ ...state, loading: true, error: null, recoveryCode: null });
  try {
    const rememberDevice = body.rememberDevice === true;
    let clientId: string | undefined;
    if (rememberDevice) {
      try {
        // Probe storage before creating an account; never silently lose a requested persistent login.
        localStorage.setItem(`${deviceKey}-check`, "1"); localStorage.removeItem(`${deviceKey}-check`);
        clientId = readDevice()?.clientId || crypto.randomUUID();
      } catch { throw new Error("이 브라우저에서 자동 로그인을 저장할 수 없습니다. 체크를 해제하고 다시 시도해주세요."); }
    }
    const previous = readDevice();
    const value = await memberRequest<MemberSessionResponse>(`/v1/members/${path}`, {
      method: "POST", body: JSON.stringify({ ...body, rememberDevice, ...(clientId ? { clientId } : {}) }) });
    // Account creation already succeeded. Never lose its one-time recovery code if optional device storage fails.
    generation += 1;
    acceptSession(value);
    let device: RememberedDevice | null = null;
    let warning: string | null = null;
    if (rememberDevice) {
      if (value.serverId !== serverId || value.clientId !== clientId || typeof value.rememberToken !== "string" ||
        !/^[A-Za-z0-9_-]{40,128}$/.test(value.rememberToken) || typeof value.rememberExpiresAt !== "number" ||
        value.rememberExpiresAt <= Date.now() / 1000 || value.rememberExpiresAt > Date.now() / 1000 + 30 * 86400 + 30)
        warning = "로그인했습니다. 자동 로그인 정보를 확인하지 못해 이 탭에서만 유지합니다.";
      else device = { clientId, rememberToken: value.rememberToken, expiresAt: value.rememberExpiresAt, serverId } as RememberedDevice;
    }
    if (previous && previous.rememberToken !== device?.rememberToken) {
      try { await memberRequest("/v1/members/forget", { method: "POST", body: JSON.stringify({ rememberToken: previous.rememberToken, clientId: previous.clientId }) }); }
      catch { warning = "로그인했습니다. 이전 자동 로그인 해제를 확인하지 못했습니다. 내 계정에서 다시 로그아웃해주세요."; }
    }
    removeDevice();
    if (device) {
      try { localStorage.setItem(deviceKey, JSON.stringify(device)); }
      catch { device = null; warning = "로그인했습니다. 자동 로그인을 저장하지 못해 이 탭에서만 유지합니다."; }
    }
    emit({ ...state, remembered: Boolean(device), error: warning });
    // Associate the current tab with the saved browser only after persistence succeeds.
    if (device) {
      try { sessionStorage.setItem(storageKey, JSON.stringify({ accessToken: value.accessToken, expiresAt: value.expiresAt,
        origin: aiApiOrigin(), serverId, clientId: device.clientId })); } catch { /* Memory remains usable. */ }
    }
    return true;
  } catch (failure) {
    emit({ ...state, loading: false, error: failure instanceof Error ? failure.message : "로그인에 실패했습니다." });
    return false;
  }
}
async function signOut() {
  // Keep the credential available for retry if server-side revocation fails.
  const device = readDevice();
  if (device) await memberRequest("/v1/members/forget", { method: "POST", body: JSON.stringify({ rememberToken: device.rememberToken, clientId: device.clientId }) });
  if (state.accessToken) {
    try { await memberRequest("/v1/members/logout", { method: "POST", body: "{}" }); }
    catch (failure) { if (!(failure instanceof MemberRequestError && failure.status === 401)) throw failure; }
  }
  clearMemberSession();
}
export function requestMemberLogin(message = "먼저 로그인을 해주세요") {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(MEMBER_LOGIN_EVENT, { detail: { message } }));
}
export function useMemberSession() {
  const session = useSyncExternalStore(subscribe, () => state, () => initial);
  useEffect(() => { if (!initialized) void retryConnection(); }, []);
  return { ...session,
    signIn: (username: string, password: string, rememberDevice = false) => authenticate("login", { username, password, rememberDevice }),
    signUp: (value: MemberSignup) => authenticate("signup", value), signOut, retryConnection,
    dismissRecoveryCode: () => emit({ ...state, recoveryCode: null }),
  };
}
