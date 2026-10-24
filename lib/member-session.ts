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

export interface MemberQuota {
  limit: number;
  used: number;
  remaining: number;
  resetAt: string;
}

interface MemberState {
  configured: boolean;
  loading: boolean;
  accessToken: string | null;
  user: MemberUser | null;
  quota: MemberQuota | null;
  error: string | null;
  expiresAt?: number;
}

interface MemberSessionResponse {
  accessToken: string;
  expiresAt: number;
  user: MemberUser;
  quota: MemberQuota;
}

export interface MemberSignup {
  username: string;
  password: string;
  name: string;
  birthDate: string;
  privacyAccepted: true;
  historyConsent: boolean;
}

export const MEMBER_LOGIN_EVENT = "evan:member-login";
export const MEMBER_SESSION_EVENT = "evan:member-session";
const storageKey = "evan-member-session";
const initial: MemberState = {
  configured: false,
  loading: true,
  accessToken: null,
  user: null,
  quota: null,
  error: null,
};
let state = initial;
let initialized = false;
let eventsBound = false;
let initialization: Promise<void> | null = null;
let expiry: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

export class MemberRequestError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "MemberRequestError";
  }
}

function emit(next: MemberState) {
  const previousOwner = state.user?.id;
  state = next;
  listeners.forEach((listener) => listener());
  if (typeof window !== "undefined" && previousOwner !== next.user?.id)
    window.dispatchEvent(new Event(MEMBER_SESSION_EVENT));
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function clearMemberSession(message: string | null = null) {
  clearTimeout(expiry);
  try { sessionStorage.removeItem(storageKey); } catch { /* Storage can be disabled. */ }
  emit({ ...state, accessToken: null, user: null, quota: null, expiresAt: undefined, loading: false, error: message });
}

function validUser(value: unknown): value is MemberUser {
  if (!value || typeof value !== "object") return false;
  const user = value as MemberUser;
  return typeof user.id === "string" && user.id.length <= 100 &&
    typeof user.username === "string" && /^[a-zA-Z0-9_]{4,24}$/.test(user.username) &&
    typeof user.name === "string" && user.name.length <= 80 &&
    /^\d{4}-\d{2}-\d{2}$/.test(user.birthDate) &&
    Number.isInteger(user.age) && user.age >= 14 && user.age <= 150 &&
    typeof user.historyConsent === "boolean";
}

function validQuota(value: unknown): value is MemberQuota {
  if (!value || typeof value !== "object") return false;
  const quota = value as MemberQuota;
  return quota.limit === 10 && Number.isInteger(quota.used) && quota.used >= 0 &&
    quota.used <= quota.limit && Number.isInteger(quota.remaining) &&
    quota.remaining === quota.limit - quota.used &&
    typeof quota.resetAt === "string" && Number.isFinite(Date.parse(quota.resetAt));
}

function acceptSession(value: MemberSessionResponse) {
  if (typeof value.accessToken !== "string" || !value.accessToken || value.accessToken.length > 8192 ||
    !Number.isFinite(value.expiresAt) || value.expiresAt <= Date.now() / 1000 ||
    value.expiresAt > Date.now() / 1000 + 8 * 60 * 60 + 30 ||
    !validUser(value.user) || !validQuota(value.quota))
    throw new Error("로그인 정보를 확인하지 못했습니다. 다시 시도해주세요.");
  clearTimeout(expiry);
  emit({ configured: true, loading: false, ...value, error: null });
  // Personal profile fields stay in memory. Only this tab's short-lived session is stored.
  try {
    sessionStorage.setItem(storageKey, JSON.stringify({
      accessToken: value.accessToken,
      expiresAt: value.expiresAt,
      origin: aiApiOrigin(),
    }));
  } catch { /* The current in-memory session remains usable. */ }
  expiry = setTimeout(() => clearMemberSession("로그인이 만료됐습니다. 다시 로그인해주세요."),
    Math.max(1, Math.min(2_147_483_647, value.expiresAt * 1000 - Date.now())));
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
    response = await fetch(`${origin}${path}`, {
      ...init, headers, cache: "no-store", credentials: "omit",
      signal: init.signal || AbortSignal.timeout(20_000),
    });
  } catch {
    throw new MemberRequestError(0, "회원 서버에 연결하지 못했습니다. 네트워크를 확인한 뒤 다시 시도해주세요.");
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && token && token === state.accessToken && data?.code === "LOGIN_REQUIRED")
      clearMemberSession("로그인이 만료됐습니다. 다시 로그인해주세요.");
    const detail = data && typeof data.detail === "string" && data.detail.length <= 500 ? data.detail : null;
    throw new MemberRequestError(response.status, detail || (
      response.status === 429 ? "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." :
      response.status === 401 ? "먼저 로그인을 해주세요." : "요청을 처리하지 못했습니다. 다시 시도해주세요."
    ));
  }
  return data as T;
}

export async function refreshMemberSession() {
  const token = state.accessToken;
  if (!token) return;
  try {
    const data = await memberRequest<{ user: MemberUser; quota: MemberQuota }>("/v1/members/me");
    if (token !== state.accessToken) return;
    if (!validUser(data.user) || !validQuota(data.quota)) throw new Error();
    emit({ ...state, user: data.user, quota: data.quota, loading: false, error: null });
  } catch (failure) {
    if (token === state.accessToken) emit({ ...state, loading: false,
      error: failure instanceof Error ? failure.message : "로그인 정보를 확인하지 못했습니다." });
  }
}

async function initializeMemberSession() {
  if (typeof window !== "undefined" && !eventsBound) {
    eventsBound = true;
    window.addEventListener("evan:refresh-member", () => { void refreshMemberSession(); });
    window.addEventListener("evan:member-expired", () => {
      clearMemberSession("로그인이 만료됐습니다. 다시 로그인해주세요.");
      requestMemberLogin();
    });
    window.addEventListener("focus", () => { void refreshMemberSession(); });
    window.setInterval(() => { if (document.visibilityState === "visible") void refreshMemberSession(); }, 60_000);
  }
  const origin = aiApiOrigin();
  if (!origin) { emit({ ...initial, loading: false }); return; }
  emit({ ...state, loading: true, error: null });
  try {
    const config = await memberRequest<{ configured: boolean; mode: string }>("/v1/auth/config");
    if (!config.configured || config.mode !== "member")
      throw new Error("회원 기능을 준비하고 있습니다. 잠시 후 다시 시도해주세요.");
    emit({ ...state, configured: true, loading: false, error: null });
    if (!state.accessToken) {
      let saved: { origin?: string; accessToken?: string; expiresAt?: number } | null = null;
      try { saved = JSON.parse(sessionStorage.getItem(storageKey) || "null"); } catch { /* Ignore unreadable storage. */ }
      if (saved?.origin === origin && typeof saved.accessToken === "string" && saved.accessToken.length <= 8192 &&
        typeof saved.expiresAt === "number" && saved.expiresAt > Date.now() / 1000 &&
        saved.expiresAt <= Date.now() / 1000 + 8 * 60 * 60 + 30) {
        emit({ ...state, accessToken: saved.accessToken, expiresAt: saved.expiresAt, loading: true });
        await refreshMemberSession();
        if (state.user && state.accessToken && state.quota)
          acceptSession({ accessToken: state.accessToken, expiresAt: saved.expiresAt, user: state.user, quota: state.quota });
      } else clearMemberSession();
    } else await refreshMemberSession();
  } catch (failure) {
    emit({ ...state, configured: false, loading: false,
      error: failure instanceof Error ? failure.message : "회원 서버에 연결하지 못했습니다." });
  }
}

async function retryConnection() {
  if (!initialization) initialization = initializeMemberSession().finally(() => { initialization = null; initialized = true; });
  await initialization;
}

async function authenticate(path: "login" | "signup", body: { username: string; password: string } | MemberSignup) {
  emit({ ...state, loading: true, error: null });
  try {
    const value = await memberRequest<MemberSessionResponse>(`/v1/members/${path}`, {
      method: "POST", body: JSON.stringify(body),
    });
    acceptSession(value);
    return true;
  } catch (failure) {
    emit({ ...state, loading: false, error: failure instanceof Error ? failure.message : "로그인에 실패했습니다." });
    return false;
  }
}

async function signOut() {
  if (state.accessToken) await memberRequest("/v1/members/logout", { method: "POST", body: "{}" });
  clearMemberSession();
}

export function requestMemberLogin(message = "먼저 로그인을 해주세요") {
  if (typeof window !== "undefined")
    window.dispatchEvent(new CustomEvent(MEMBER_LOGIN_EVENT, { detail: { message } }));
}

export function useMemberSession() {
  const session = useSyncExternalStore(subscribe, () => state, () => initial);
  useEffect(() => { if (!initialized) void retryConnection(); }, []);
  return {
    ...session,
    signIn: (username: string, password: string) => authenticate("login", { username, password }),
    signUp: (value: MemberSignup) => authenticate("signup", value),
    signOut, retryConnection,
  };
}
