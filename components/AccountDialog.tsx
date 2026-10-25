"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, X, LogOut, LoaderCircle } from "lucide-react";
import { MEMBER_LOGIN_EVENT, clearMemberSession, memberRequest, refreshMemberSession, useMemberSession } from "@/lib/member-session";
import "@/app/account.css";

type AccountMode = "login" | "signup" | "recover-username" | "reset-password";
type IssuedCode = { value: string; purpose: "account" | "reset" };

export default function AccountDialog() {
  const member = useMemberSession();
  const panel = useRef<HTMLDialogElement>(null);
  const codeField = useRef<HTMLTextAreaElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<AccountMode>("login");
  const [reason, setReason] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [name, setName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [historyConsent, setHistoryConsent] = useState(false);
  const [rememberDevice, setRememberDevice] = useState(false);
  const [recoveryInput, setRecoveryInput] = useState("");
  const [issuedCode, setIssuedCode] = useState<IssuedCode | null>(null);
  const [foundUsername, setFoundUsername] = useState("");
  const [issuingCode, setIssuingCode] = useState(false);
  const [copyNotice, setCopyNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [deleting, setDeleting] = useState(false);
  const recoveryCode = issuedCode?.value || member.recoveryCode;
  const recovering = mode === "recover-username" || mode === "reset-password";

  useEffect(() => {
    function show(event: Event) {
      const detail = event instanceof CustomEvent ? event.detail : null;
      setReason(typeof detail?.message === "string" ? detail.message : "");
      setMode("login"); setError(""); setNotice(""); setDeleting(false); setIssuingCode(false);
      setPassword(""); setConfirmation(""); setRecoveryInput(""); setFoundUsername("");
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

  function clearSensitiveFields() {
    setPassword(""); setConfirmation(""); setName(""); setBirthDate("");
    setRecoveryInput(""); setPrivacyAccepted(false); setHistoryConsent(false);
  }

  function close() {
    if (busy) return;
    setOpen(false); clearSensitiveFields(); setRememberDevice(false);
    setDeleting(false); setIssuingCode(false); setIssuedCode(null); setCopyNotice("");
    setFoundUsername(""); member.dismissRecoveryCode();
  }

  function changeMode(next: AccountMode) {
    setMode(next); setError(""); setNotice(""); setFoundUsername("");
    setPassword(""); setConfirmation(""); setRecoveryInput("");
  }

  async function authenticate(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(""); setNotice("");
    if (mode === "signup" && password !== confirmation) { setError("비밀번호가 일치하지 않습니다."); return; }
    setBusy(true);
    try {
      const ok = mode === "signup"
        ? await member.signUp({ username: username.trim(), password, name: name.trim(), birthDate, privacyAccepted: true, historyConsent, rememberDevice })
        : await member.signIn(username.trim(), password, rememberDevice);
      if (ok) {
        clearSensitiveFields();
        if (mode === "signup") setNotice("가입이 완료되었습니다. 복구 코드를 안전하게 보관해주세요.");
        else { setOpen(false); setRememberDevice(false); }
      }
    } finally { setBusy(false); }
  }

  async function recoverAccount(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(""); setNotice("");
    if (mode === "reset-password" && password !== confirmation) { setError("비밀번호가 일치하지 않습니다."); return; }
    setBusy(true);
    try {
      if (mode === "recover-username") {
        const result = await memberRequest<{ username: string }>("/v1/members/recover-username", {
          method: "POST", body: JSON.stringify({ recoveryCode: recoveryInput.trim() }),
        });
        if (typeof result.username !== "string" || !/^[A-Za-z0-9_]{4,24}$/.test(result.username)) throw new Error("아이디를 확인하지 못했습니다.");
        setFoundUsername(result.username); setUsername(result.username); setRecoveryInput("");
      } else {
        const result = await memberRequest<{ username: string; recoveryCode: string }>("/v1/members/reset-password", {
          method: "POST", body: JSON.stringify({ username: username.trim(), recoveryCode: recoveryInput.trim(), newPassword: password }),
        });
        if (typeof result.recoveryCode !== "string" || !result.recoveryCode || result.recoveryCode.length > 256) throw new Error("새 복구 코드를 확인하지 못했습니다. 변경한 비밀번호로 로그인해주세요.");
        clearMemberSession();
        setIssuedCode({ value: result.recoveryCode, purpose: "reset" });
        setPassword(""); setConfirmation(""); setRecoveryInput(""); setCopyNotice("");
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : "계정 복구를 처리하지 못했습니다."); }
    finally { setBusy(false); }
  }

  async function issueRecoveryCode(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await memberRequest<{ recoveryCode: string }>("/v1/members/recovery-code", {
        method: "POST", body: JSON.stringify({ password }),
      });
      if (typeof result.recoveryCode !== "string" || !result.recoveryCode || result.recoveryCode.length > 256) throw new Error("복구 코드를 확인하지 못했습니다. 다시 발급해주세요.");
      setIssuedCode({ value: result.recoveryCode, purpose: "account" }); setCopyNotice("");
      setPassword(""); setIssuingCode(false);
      await refreshMemberSession();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "복구 코드를 발급하지 못했습니다."); }
    finally { setBusy(false); }
  }

  async function copyRecoveryCode() {
    if (!recoveryCode) return;
    try {
      await navigator.clipboard.writeText(recoveryCode);
      setCopyNotice("복사했습니다. 다른 사람이 볼 수 없는 곳에 보관해주세요.");
    } catch {
      codeField.current?.focus(); codeField.current?.select();
      setCopyNotice("자동 복사를 사용할 수 없습니다. 선택된 코드를 직접 복사해주세요.");
    }
  }

  function finishRecoveryCode() {
    const wasReset = issuedCode?.purpose === "reset";
    setIssuedCode(null); setCopyNotice(""); member.dismissRecoveryCode();
    if (wasReset) {
      changeMode("login"); setNotice("비밀번호를 변경했습니다. 새 비밀번호로 로그인해주세요.");
    } else close();
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

  const title = recoveryCode ? "복구 코드 보관" : member.user ? "내 계정" : mode === "signup" ? "회원가입" : mode === "recover-username" ? "아이디 찾기" : mode === "reset-password" ? "비밀번호 재설정" : "로그인";
  const unavailable = busy || !member.configured || member.loading;

  return <dialog ref={panel} className="member-dialog" aria-labelledby="member-dialog-title"
    onCancel={event => { event.preventDefault(); close(); }} onClose={() => { if (!busy) setOpen(false); }}
    onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <div className="member-dialog-shell">
      <header><div><span className="member-brand">EVAN</span><h2 id="member-dialog-title">{title}</h2></div>
        <button type="button" onClick={close} disabled={busy} aria-label="계정 창 닫기"><X size={22} /></button></header>
      {recoveryCode ? <section className="member-recovery-result" aria-label="복구 코드">
        <p>{issuedCode?.purpose === "reset" ? "비밀번호가 변경되었습니다. 이전 복구 코드는 무효화되었습니다." : "아이디 찾기와 비밀번호 재설정에 사용할 코드입니다. 이전에 발급한 코드는 무효화됩니다."}</p>
        <p className="member-code-warning">이 코드는 지금 한 번만 표시합니다. 비밀번호 관리자 등 안전한 곳에 보관하고, 다른 사람에게 보내지 마세요.</p>
        <p className="member-code-owner">아이디: <strong>{member.user?.username || username}</strong></p>
        {member.error && <p className="member-error" role="alert">{member.error}</p>}
        <label htmlFor="member-issued-code">내 계정 복구 코드</label>
        <textarea ref={codeField} id="member-issued-code" value={recoveryCode} readOnly rows={3} autoComplete="off" spellCheck={false} />
        <button type="button" onClick={() => void copyRecoveryCode()}><Copy size={16} /> 복구 코드 복사</button>
        {copyNotice && <p className="member-help" role="status">{copyNotice}</p>}
        <button type="button" className="member-primary" onClick={finishRecoveryCode}>코드를 보관했습니다</button>
      </section> : !member.user ? <>
        {reason && reason !== "로그인" && <p className="member-login-reason" role="status">{reason} <a href="#member-login-form" onClick={() => changeMode("login")}>로그인하기</a></p>}
        <nav className="member-tabs" aria-label="계정 메뉴"><button type="button" aria-pressed={mode === "login"} disabled={busy} onClick={() => changeMode("login")}>로그인</button><button type="button" aria-pressed={mode === "signup"} disabled={busy} onClick={() => changeMode("signup")}>회원가입</button></nav>
        <p className="member-intro">{recovering ? "가입할 때 또는 내 계정에서 발급해 보관한 복구 코드로 본인을 확인합니다." : "로그인하면 AI 질문을 하루 10회 이용하고, 댓글로 의견을 나눌 수 있습니다."}</p>
        {!member.configured && !member.loading && <div className="member-notice" role="status"><p>{member.error || "회원 서버에 연결하지 못했습니다."}</p><button type="button" onClick={() => void member.retryConnection()}>다시 연결</button></div>}
        {notice && <p className="member-notice" role="status">{notice}</p>}
        {recovering ? <>
          {foundUsername ? <section className="member-recovery-result"><p>복구 코드에 연결된 아이디입니다.</p><strong className="member-found-username">{foundUsername}</strong><button type="button" className="member-primary" onClick={() => changeMode("login")}>이 아이디로 로그인</button><button type="button" onClick={() => changeMode("reset-password")}>비밀번호도 재설정하기</button></section> : <form id="member-login-form" className="member-form" onSubmit={recoverAccount}>
            {mode === "reset-password" && <label htmlFor="member-recover-username">아이디<input id="member-recover-username" name="username" autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} minLength={4} maxLength={24} pattern="[A-Za-z0-9_]{4,24}" required disabled={busy} /></label>}
            <label htmlFor="member-recovery-code">복구 코드<input id="member-recovery-code" type="text" autoComplete="off" autoCapitalize="none" spellCheck={false} value={recoveryInput} onChange={e => setRecoveryInput(e.target.value)} maxLength={256} required disabled={busy} placeholder="보관한 복구 코드 전체 입력" /></label>
            {mode === "reset-password" && <>
              <label htmlFor="member-new-password">새 비밀번호<input id="member-new-password" type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} minLength={6} maxLength={128} required disabled={busy} placeholder="6자 이상" /></label>
              <label htmlFor="member-new-confirmation">새 비밀번호 확인<input id="member-new-confirmation" type="password" autoComplete="new-password" value={confirmation} onChange={e => setConfirmation(e.target.value)} minLength={6} maxLength={128} required disabled={busy} /></label>
              <p className="member-help">변경하면 모든 기기의 로그인이 해제되고 복구 코드가 새로 발급됩니다. AI 이용 횟수는 초기화되지 않습니다.</p>
            </>}
            {error && <p className="member-error" role="alert">{error}</p>}
            <button type="submit" className="member-primary" disabled={unavailable}>{busy ? <><LoaderCircle className="member-spinner" size={18} /> 확인 중…</> : mode === "recover-username" ? "아이디 확인" : "비밀번호 변경"}</button>
          </form>}
          <p className="member-help member-recovery-help">복구 코드가 없는 기존 계정은 로그인 후 내 계정에서 먼저 발급해주세요. 이름·생년월일만으로는 계정을 복구하지 않으며, 이메일로 코드를 보내는 기능은 제공하지 않습니다.</p>
          <button type="button" className="member-back" disabled={busy} onClick={() => changeMode("login")}>로그인으로 돌아가기</button>
        </> : <>
          <form id="member-login-form" className="member-form" onSubmit={authenticate}>
            <label htmlFor="member-username">아이디<input id="member-username" name="username" autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} minLength={4} maxLength={24} pattern="[A-Za-z0-9_]{4,24}" required disabled={busy} placeholder="영문·숫자·밑줄 4~24자" /></label>
            <label htmlFor="member-password">비밀번호<input id="member-password" name="password" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} value={password} onChange={e => setPassword(e.target.value)} minLength={mode === "signup" ? 6 : 1} maxLength={128} required disabled={busy} placeholder={mode === "signup" ? "6자 이상" : "비밀번호"} /></label>
            {mode === "signup" && <>
              <label htmlFor="member-confirmation">비밀번호 확인<input id="member-confirmation" type="password" autoComplete="new-password" value={confirmation} onChange={e => setConfirmation(e.target.value)} minLength={6} maxLength={128} required disabled={busy} /></label>
              <div className="member-form-pair"><label htmlFor="member-name">이름 · 비공개<input id="member-name" name="name" autoComplete="name" value={name} onChange={e => setName(e.target.value)} maxLength={50} required disabled={busy} /></label>
                <label htmlFor="member-birthday">생년월일 · 비공개<input id="member-birthday" name="birthdate" type="date" autoComplete="bday" value={birthDate} onChange={e => setBirthDate(e.target.value)} required disabled={busy} /></label></div>
              <p className="member-help">나이는 생년월일로 계산합니다. 임시 가입은 만 14세 이상만 가능합니다. 댓글에는 이름 대신 아이디가 표시됩니다.</p>
              <label className="member-consent"><input type="checkbox" checked={privacyAccepted} onChange={e => setPrivacyAccepted(e.target.checked)} required disabled={busy} /><span>[필수] 계정 관리·연령 확인을 위한 아이디, 이름, 생년월일 수집·이용에 동의합니다. 탈퇴 시 삭제합니다. 비밀번호는 해시로 보관합니다.</span></label>
              <label className="member-consent"><input type="checkbox" checked={historyConsent} onChange={e => setHistoryConsent(e.target.checked)} disabled={busy} /><span>[선택] 관심 뉴스 파악을 위한 기사 열람 기록 저장에 동의합니다. 기사 식별자와 최근 열람 시각을 최대 90일 보관합니다. 내 계정에서 철회·삭제할 수 있으며, 미동의해도 서비스 이용이 가능합니다.</span></label>
              <p className="member-help">가입 후 발급되는 복구 코드를 반드시 보관해주세요. 아이디 찾기·비밀번호 재설정에 필요합니다. 다른 사이트와 같은 비밀번호는 사용하지 마세요.</p>
            </>}
            <label className="member-consent member-remember"><input type="checkbox" checked={rememberDevice} onChange={e => setRememberDevice(e.target.checked)} disabled={busy} /><span><strong>이 브라우저에서 30일 자동 로그인</strong><span>비밀번호는 저장하지 않습니다. 공용 기기에서는 선택하지 마세요.</span></span></label>
            {(error || (member.configured && member.error)) && <p className="member-error" role="alert">{error || member.error}</p>}
            <button type="submit" className="member-primary" disabled={unavailable || (mode === "signup" && !privacyAccepted)}>{busy ? <><LoaderCircle className="member-spinner" size={18} /> 처리 중…</> : mode === "signup" ? "동의하고 가입하기" : "로그인"}</button>
          </form>
          {mode === "login" && <nav className="member-recovery-links" aria-label="계정 찾기"><button type="button" disabled={busy} onClick={() => changeMode("recover-username")}>아이디 찾기</button><button type="button" disabled={busy} onClick={() => changeMode("reset-password")}>비밀번호 재설정</button></nav>}
        </>}
      </> : <div className="member-account">
        <p><strong>{member.user.username}</strong>님, 반갑습니다.</p>
        {member.remembered && <p className="member-help">이 브라우저의 자동 로그인이 켜져 있습니다. 로그아웃하면 자동 로그인도 해제됩니다.</p>}
        <div className="member-quota"><strong>오늘 AI 질문 {member.quota?.remaining ?? "—"} / 10회 남음</strong><span>한국 시간 자정 초기화 · 댓글 작성은 AI 횟수와 별개입니다.</span></div>
        <dl><div><dt>이름 · 비공개</dt><dd>{member.user.name}</dd></div><div><dt>생년월일 · 비공개</dt><dd>{member.user.birthDate} · 만 {member.user.age}세</dd></div></dl>
        <section className="member-account-recovery" aria-labelledby="member-recovery-title"><h3 id="member-recovery-title">계정 복구 코드</h3><p className="member-help">{member.recoveryReady ? "보관한 코드로 아이디와 비밀번호를 복구할 수 있습니다." : "아직 복구 코드가 없습니다. 계정을 잊어버리기 전에 발급해 보관해주세요."} 재발급하면 이전 코드는 사용할 수 없습니다.</p>
          {!issuingCode ? <button type="button" disabled={busy} onClick={() => { setIssuingCode(true); setDeleting(false); setPassword(""); setError(""); }}>복구 코드 발급·재발급</button> : <form className="member-form" onSubmit={issueRecoveryCode}><label htmlFor="member-reissue-password">현재 비밀번호 확인<input id="member-reissue-password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} maxLength={128} required disabled={busy} /></label><div className="member-inline-actions"><button type="button" disabled={busy} onClick={() => { setIssuingCode(false); setPassword(""); }}>취소</button><button type="submit" className="member-primary" disabled={busy}>{busy ? "발급 중…" : "새 코드 발급"}</button></div></form>}
        </section>
        <label className="member-consent"><input type="checkbox" checked={member.user.historyConsent} onChange={e => void changePrivacy(e.target.checked)} disabled={busy} /><span>관심 뉴스 파악을 위한 열람 기록 저장 (최대 90일). 동의를 끄면 기존 기록도 삭제합니다.</span></label>
        <button type="button" disabled={busy} onClick={async () => { setBusy(true); setError(""); try { await memberRequest("/v1/members/history/clear", { method: "POST", body: "{}" }); setNotice("열람 기록을 삭제했습니다."); } catch (e) { setError(e instanceof Error ? e.message : "삭제하지 못했습니다."); } finally { setBusy(false); } }}>열람 기록 비우기</button>
        {notice && <p role="status">{notice}</p>}{(error || member.error) && <p className="member-error" role="alert">{error || member.error}</p>}
        <button type="button" disabled={busy} onClick={async () => { setBusy(true); setError(""); try { await member.signOut(); setOpen(false); clearSensitiveFields(); setRememberDevice(false); } catch (e) { setError(e instanceof Error ? e.message : "로그아웃하지 못했습니다."); } finally { setBusy(false); } }}><LogOut size={16} /> 로그아웃</button>
        {!deleting ? <button type="button" className="member-danger" disabled={busy} onClick={() => { setDeleting(true); setIssuingCode(false); setPassword(""); }}>회원 탈퇴</button> : <form className="member-form member-delete" onSubmit={deleteAccount}><p>탈퇴하면 계정·열람 기록과 작성한 댓글 내용이 삭제됩니다. 복구할 수 없습니다.</p><label htmlFor="member-delete-password">비밀번호 확인<input id="member-delete-password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required disabled={busy} maxLength={128} /></label><div><button type="button" onClick={() => { setDeleting(false); setPassword(""); }} disabled={busy}>취소</button><button type="submit" className="member-danger" disabled={busy}>탈퇴 확정</button></div></form>}
      </div>}
    </div>
  </dialog>;
}
