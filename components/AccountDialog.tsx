"use client";

import { useEffect, useRef, useState } from "react";
import { X, LogOut, LoaderCircle } from "lucide-react";
import { MEMBER_LOGIN_EVENT, clearMemberSession, memberRequest, refreshMemberSession, useMemberSession } from "@/lib/member-session";
import "@/app/account.css";

export default function AccountDialog() {
  const member = useMemberSession();
  const panel = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [reason, setReason] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [name, setName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [historyConsent, setHistoryConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    function show(event: Event) {
      const detail = event instanceof CustomEvent ? event.detail : null;
      setReason(typeof detail?.message === "string" ? detail.message : "");
      setMode("login"); setError(""); setNotice(""); setDeleting(false);
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setOpen(true);
    }
    window.addEventListener(MEMBER_LOGIN_EVENT, show);
    return () => window.removeEventListener(MEMBER_LOGIN_EVENT, show);
  }, []);

  useEffect(() => {
    const dialog = panel.current;
    if (!dialog) return;
    if (!open) {
      if (dialog.open) dialog.close();
      return;
    }
    if (!dialog.open) dialog.showModal();
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = before;
      if (dialog.open) dialog.close();
      if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true });
    };
  }, [open]);

  function close() {
    if (busy) return;
    setOpen(false); setPassword(""); setConfirmation(""); setName(""); setBirthDate("");
    setPrivacyAccepted(false); setHistoryConsent(false); setDeleting(false);
  }

  async function authenticate(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(""); setNotice("");
    if (mode === "signup" && password !== confirmation) { setError("비밀번호가 일치하지 않습니다."); return; }
    setBusy(true);
    try {
      const ok = mode === "signup"
        ? await member.signUp({ username: username.trim(), password, name: name.trim(), birthDate, privacyAccepted: true, historyConsent })
        : await member.signIn(username.trim(), password);
      if (ok) { setOpen(false); setPassword(""); setConfirmation(""); setName(""); setBirthDate(""); setPrivacyAccepted(false); setHistoryConsent(false); }
    } finally { setBusy(false); }
  }

  async function changePrivacy(value: boolean) {
    setBusy(true); setError(""); setNotice("");
    try {
      await memberRequest("/v1/members/privacy", { method: "POST", body: JSON.stringify({ historyConsent: value }) });
      await refreshMemberSession();
      setNotice(value ? "열람 기록 저장에 동의했습니다. 지금부터 방문한 기사만 기록합니다." : "열람 기록 동의를 철회하고 기존 기록을 삭제했습니다.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "설정을 저장하지 못했습니다."); }
    finally { setBusy(false); }
  }

  async function deleteAccount(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await memberRequest("/v1/members/delete", { method: "POST", body: JSON.stringify({ password }) });
      clearMemberSession(); setOpen(false); setPassword(""); setDeleting(false);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "탈퇴를 처리하지 못했습니다."); }
    finally { setBusy(false); }
  }

  return <dialog ref={panel} className="member-dialog" aria-labelledby="member-dialog-title"
    onCancel={event => { event.preventDefault(); close(); }} onClose={() => { if (!busy) setOpen(false); }}
    onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <div className="member-dialog-shell">
      <header><div><span className="member-brand">EVAN</span><h2 id="member-dialog-title">{member.user ? "내 계정" : mode === "signup" ? "회원가입" : "로그인"}</h2></div>
        <button type="button" onClick={close} disabled={busy} aria-label="계정 창 닫기"><X size={22} /></button></header>
      {!member.user ? <>
        {reason && reason !== "로그인" && <p className="member-login-reason" role="status">{reason} <a href="#member-login-form" onClick={() => setMode("login")}>로그인하기</a></p>}
        <nav className="member-tabs" aria-label="계정 메뉴"><button type="button" aria-pressed={mode === "login"} onClick={() => { setMode("login"); setError(""); }}>로그인</button><button type="button" aria-pressed={mode === "signup"} onClick={() => { setMode("signup"); setError(""); }}>회원가입</button></nav>
        <p className="member-intro">로그인하면 AI 질문을 하루 10회 이용하고, 댓글로 의견을 나눌 수 있습니다.</p>
        {!member.configured && !member.loading && <div className="member-notice" role="status"><p>{member.error || "회원 서버에 연결하지 못했습니다."}</p><button type="button" onClick={() => void member.retryConnection()}>다시 연결</button></div>}
        <form id="member-login-form" className="member-form" onSubmit={authenticate}>
          <label htmlFor="member-username">아이디<input id="member-username" name="username" autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} minLength={4} maxLength={24} pattern="[A-Za-z0-9_]{4,24}" required disabled={busy} placeholder="영문·숫자·밑줄 4~24자" /></label>
          <label htmlFor="member-password">비밀번호<input id="member-password" name="password" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} value={password} onChange={e => setPassword(e.target.value)} minLength={mode === "signup" ? 6 : 1} maxLength={128} required disabled={busy} placeholder={mode === "signup" ? "6자 이상" : "비밀번호"} /></label>
          {mode === "signup" && <>
            <label htmlFor="member-confirmation">비밀번호 확인<input id="member-confirmation" type="password" autoComplete="new-password" value={confirmation} onChange={e => setConfirmation(e.target.value)} maxLength={128} required disabled={busy} /></label>
            <div className="member-form-pair"><label htmlFor="member-name">이름 · 비공개<input id="member-name" name="name" autoComplete="name" value={name} onChange={e => setName(e.target.value)} maxLength={50} required disabled={busy} /></label>
              <label htmlFor="member-birthday">생년월일 · 비공개<input id="member-birthday" name="birthdate" type="date" autoComplete="bday" value={birthDate} onChange={e => setBirthDate(e.target.value)} required disabled={busy} /></label></div>
            <p className="member-help">나이는 생년월일로 계산합니다. 임시 가입은 만 14세 이상만 가능합니다. 댓글에는 이름 대신 아이디가 표시됩니다.</p>
            <label className="member-consent"><input type="checkbox" checked={privacyAccepted} onChange={e => setPrivacyAccepted(e.target.checked)} required disabled={busy} /><span>[필수] 계정 관리·연령 확인을 위한 아이디, 이름, 생년월일 수집·이용에 동의합니다. 탈퇴 시 삭제합니다. 비밀번호는 해시로 보관합니다.</span></label>
            <label className="member-consent"><input type="checkbox" checked={historyConsent} onChange={e => setHistoryConsent(e.target.checked)} disabled={busy} /><span>[선택] 관심 뉴스 파악을 위한 기사 열람 기록 저장에 동의합니다. 기사 식별자와 최근 열람 시각을 최대 90일 보관합니다. 내 계정에서 철회·삭제할 수 있으며, 미동의해도 서비스 이용이 가능합니다.</span></label>
            <p className="member-help">임시 가입에는 이메일 인증·비밀번호 자동 복구가 없습니다. 아이디와 비밀번호를 안전하게 보관해주세요. 다른 사이트와 같은 비밀번호는 사용하지 마세요.</p>
          </>}
          {(error || (member.configured && member.error)) && <p className="member-error" role="alert">{error || member.error}</p>}
          <button type="submit" className="member-primary" disabled={busy || !member.configured || member.loading || (mode === "signup" && !privacyAccepted)}>{busy ? <><LoaderCircle className="member-spinner" size={18} /> 처리 중…</> : mode === "signup" ? "동의하고 가입하기" : "로그인"}</button>
        </form>
      </> : <div className="member-account">
        <p><strong>{member.user.username}</strong>님, 반갑습니다.</p>
        <div className="member-quota"><strong>오늘 AI 질문 {member.quota?.remaining ?? "—"} / 10회 남음</strong><span>한국 시간 자정 초기화 · 댓글 작성은 AI 횟수와 별개입니다.</span></div>
        <dl><div><dt>이름 · 비공개</dt><dd>{member.user.name}</dd></div><div><dt>생년월일 · 비공개</dt><dd>{member.user.birthDate} · 만 {member.user.age}세</dd></div></dl>
        <label className="member-consent"><input type="checkbox" checked={member.user.historyConsent} onChange={e => void changePrivacy(e.target.checked)} disabled={busy} /><span>관심 뉴스 파악을 위한 열람 기록 저장 (최대 90일). 동의를 끄면 기존 기록도 삭제합니다.</span></label>
        <button type="button" disabled={busy} onClick={async () => { setBusy(true); setError(""); try { await memberRequest("/v1/members/history/clear", { method: "POST", body: "{}" }); setNotice("열람 기록을 삭제했습니다."); } catch (e) { setError(e instanceof Error ? e.message : "삭제하지 못했습니다."); } finally { setBusy(false); } }}>열람 기록 비우기</button>
        {notice && <p role="status">{notice}</p>}{error && <p className="member-error" role="alert">{error}</p>}
        <button type="button" disabled={busy} onClick={async () => { setBusy(true); setError(""); try { await member.signOut(); setOpen(false); } catch (e) { setError(e instanceof Error ? e.message : "로그아웃하지 못했습니다."); } finally { setBusy(false); } }}><LogOut size={16} /> 로그아웃</button>
        {!deleting ? <button type="button" className="member-danger" onClick={() => { setDeleting(true); setPassword(""); }}>회원 탈퇴</button> : <form className="member-form member-delete" onSubmit={deleteAccount}><p>탈퇴하면 계정·열람 기록과 작성한 댓글 내용이 삭제됩니다. 복구할 수 없습니다.</p><label htmlFor="member-delete-password">비밀번호 확인<input id="member-delete-password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required disabled={busy} maxLength={128} /></label><div><button type="button" onClick={() => setDeleting(false)} disabled={busy}>취소</button><button type="submit" className="member-danger" disabled={busy}>탈퇴 확정</button></div></form>}
      </div>}
    </div>
  </dialog>;
}
