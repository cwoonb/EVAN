"use client";

import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { useSyncExternalStore } from "react";

const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";

function publicConfigurationIsValid() {
  try {
    const url = new URL(projectUrl);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) return false;
    if (url.username || url.password || url.search || url.hash || !publishableKey) return false;
    if (publishableKey.startsWith("sb_publishable_")) return true;
    // Support existing anon keys, but never accept a service-role JWT or secret key.
    const claims = JSON.parse(atob(publishableKey.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return claims.role === "anon";
  } catch {
    return false;
  }
}

const configured = publicConfigurationIsValid();
let client: SupabaseClient | null = null;

export function getCommunityClient(): SupabaseClient | null {
  if (!configured || typeof window === "undefined") return null;
  client ??= createClient(projectUrl, publishableKey, {
    auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
  });
  return client;
}

export interface CommunitySessionState {
  session: Session | null;
  loading: boolean;
  error?: string;
  configured: boolean;
}

const initialState: CommunitySessionState = { session: null, loading: configured, configured };
let state = initialState;
let initialized = false;
const listeners = new Set<() => void>();

function emit(next: CommunitySessionState) {
  state = next;
  listeners.forEach((listener) => listener());
}

function initialize() {
  if (initialized) return;
  const connection = getCommunityClient();
  if (!connection) return;
  initialized = true;
  let authEventReceived = false;
  connection.auth.onAuthStateChange((_event, session) => {
    authEventReceived = true;
    emit({ session, loading: false, configured: true });
  });
  void connection.auth.getSession().then(({ data, error }) => {
    if (!authEventReceived || error) emit({ session: data.session, loading: false, configured: true, error: error ? "로그인 정보를 확인하지 못했습니다. 다시 로그인해주세요." : undefined });
  }).catch(() => emit({ session: null, loading: false, configured: true, error: "인증 서버에 연결하지 못했습니다." }));
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  initialize();
  return () => { listeners.delete(listener); };
}

export function useCommunitySession(): CommunitySessionState {
  return useSyncExternalStore(subscribe, () => state, () => initialState);
}

export function communityError(error: { message?: string; code?: string } | null): string {
  const message = error?.message ?? "";
  if (message.includes("EVAN_RATE_LIMIT")) return "요청이 너무 빠릅니다. 잠시 후 다시 시도해주세요.";
  if (message.includes("EVAN_DUPLICATE")) return "같은 댓글이나 신고가 이미 접수되었습니다.";
  if (message.includes("EVAN_LOGIN_REQUIRED") || error?.code === "PGRST301") return "이메일 인증을 마친 계정으로 다시 로그인해주세요.";
  if (message.includes("EVAN_NOT_OWNER")) return "본인이 작성한 댓글만 변경할 수 있습니다.";
  if (message.includes("EVAN_NOT_FOUND")) return "댓글이 삭제되었거나 더 이상 공개되지 않습니다.";
  if (message.includes("EVAN_INVALID")) return "입력을 확인해주세요. 댓글은 1~2,000자, 링크는 최대 3개입니다.";
  if (error?.code === "PGRST202" || error?.code === "42P01") return "댓글 DB 설정이 아직 완료되지 않았습니다.";
  return "요청을 완료하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해주세요.";
}
