"use client";

import { useEffect, useSyncExternalStore } from "react";
import { aiApiOrigin } from "@/lib/ai-conversation";
import { getCommunityClient, useCommunitySession } from "@/lib/community-client";

export { aiApiOrigin };
type Mode = "code" | "supabase" | "unavailable";
interface AccessState {
  configured: boolean;
  loading: boolean;
  mode: Mode;
  accessToken: string | null;
  owner: string;
  error?: string;
  expiresAt?: number;
}
const initial: AccessState = { configured: false, loading: true, mode: "unavailable", accessToken: null, owner: "guest" };
let state = initial;
let initialization: Promise<void> | null = null;
let expiry: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
// A session token survives navigation/reload in this tab. The access code is never stored.
const storageKey = "evan-ai-session";

function emit(next: AccessState) {
  state = next;
  listeners.forEach((listener) => listener());
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function forgetSession() {
  clearTimeout(expiry);
  try { sessionStorage.removeItem(storageKey); } catch { /* Private browsing may disable storage. */ }
}
function setSession(value: { accessToken: string; owner: string; expiresAt: number }) {
  if (typeof value.accessToken !== "string" || value.accessToken.length > 8192 ||
      !/^[\da-f-]{36}$/i.test(value.owner) || !Number.isFinite(value.expiresAt) || value.expiresAt <= Date.now() / 1000 || value.expiresAt > Date.now() / 1000 + 8 * 60 * 60 + 30) throw new Error("접속 정보를 확인하지 못했습니다.");
  emit({ ...state, ...value, loading: false, error: undefined });
  clearTimeout(expiry);
  expiry = setTimeout(() => {
    forgetSession();
    emit({ ...state, accessToken: null, owner: "guest", expiresAt: undefined, error: "접속이 만료됐습니다. 접속 코드를 다시 입력해주세요." });
  }, Math.max(1, value.expiresAt * 1000 - Date.now()));
}
async function initialize() {
  const origin = aiApiOrigin();
  if (!origin) { emit({ ...initial, loading: false }); return; }
  emit({ ...state, loading: true, error: undefined });
  try {
    const response = await fetch(`${origin}/v1/auth/config`, { cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(10_000) });
    const config = await response.json();
    if (!response.ok || config.configured !== true || !["code", "supabase"].includes(config.mode)) throw new Error();
    emit({ ...state, configured: true, loading: false, mode: config.mode, error: undefined });
    if (config.mode === "code" && !state.accessToken) {
      try {
        const stored = JSON.parse(sessionStorage.getItem(storageKey) || "null");
        if (stored?.origin === origin) setSession(stored);
      } catch { forgetSession(); }
    }
  } catch {
    emit({ ...initial, loading: false, error: "AI 서버에 연결하지 못했습니다. 서버가 켜져 있는지 확인한 뒤 다시 연결해주세요." });
  }
}
async function retryConnection() {
  if (!initialization) initialization = initialize().finally(() => { initialization = null; });
  await initialization;
}
async function loginWithCode(code: string): Promise<boolean> {
  const origin = aiApiOrigin();
  if (!origin || state.mode !== "code" || state.loading) return false;
  emit({ ...state, loading: true, error: undefined });
  try {
    const response = await fetch(`${origin}/v1/auth/session`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }), cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(response.status === 401 ? "접속 코드가 올바르지 않습니다." : response.status === 429 ? "접속 시도가 너무 많습니다. 잠시 후 다시 시도해주세요." : "AI 서버에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.");
    const session = await response.json();
    setSession(session);
    try { sessionStorage.setItem(storageKey, JSON.stringify({ accessToken: session.accessToken, owner: session.owner, expiresAt: session.expiresAt, origin })); } catch { /* The in-memory session remains usable. */ }
    return true;
  } catch (failure) {
    emit({ ...state, loading: false, error: failure instanceof Error && failure.name !== "TimeoutError" && !(failure instanceof TypeError) ? failure.message : "AI 서버에 연결하지 못했습니다. 다시 시도해주세요." });
    return false;
  }
}
async function signOut() {
  if (state.mode === "supabase") await getCommunityClient()?.auth.signOut();
  forgetSession();
  emit({ ...state, accessToken: null, owner: "guest", expiresAt: undefined, error: undefined });
}

export function useAiAccess() {
  const access = useSyncExternalStore(subscribe, () => state, () => initial);
  const community = useCommunitySession();
  useEffect(() => { void retryConnection(); }, []);
  return {
    ...access,
    accessToken: access.mode === "supabase" ? community.session?.access_token ?? null : access.accessToken,
    owner: access.mode === "supabase" ? community.session?.user.id ?? "guest" : access.owner,
    loading: access.loading || (access.mode === "supabase" && community.loading),
    loginWithCode, signOut, retryConnection,
  };
}
