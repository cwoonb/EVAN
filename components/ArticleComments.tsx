"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Flag, LoaderCircle, MessageCircle, Reply, Send, UserRound } from "lucide-react";
import { memberRequest, requestMemberLogin, useMemberSession } from "@/lib/member-session";
import "@/app/news/comments.css";

interface Comment {
  id: string;
  article_id: string;
  parent_id: string | null;
  author_id: string | null;
  body: string;
  status: "published" | "deleted" | "hidden";
  created_at: string;
  updated_at: string;
  author: { display_name: string } | null;
}

export function CommunityAuthPanel() {
  const member = useMemberSession();
  return <div className="community-auth">
    {member.user ? <p>{member.user.username} 아이디로 의견을 남깁니다. 이름·생년월일은 공개되지 않습니다.</p> : <button type="button" onClick={() => requestMemberLogin()}>로그인하고 댓글 작성하기</button>}
  </div>;
}

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "시간 정보 없음" : new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

export default function ArticleComments({ articleId }: { articleId: string }) {
  const member = useMemberSession();
  const session = member.user ? { user: member.user } : null;
  const configured = member.configured;
  const authLoading = member.loading;
  const [comments, setComments] = useState<Comment[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(configured);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [reportId, setReportId] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState("spam");
  const [reportDetail, setReportDetail] = useState("");
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const requestVersion = useRef(0);

  const fetchComments = useCallback(async (append = false, existingCount = 0) => {
    const version = ++requestVersion.current;
    setLoading(true); setError("");
    try {
      const data = await memberRequest<{ comments: Array<{ id: string; articleId: string; parentId: string | null; authorId: string | null; username: string; body: string; status: string; createdAt: string; updatedAt: string }>; total: number }>(`/v1/comments?articleId=${articleId}&offset=${append ? existingCount : 0}`);
      if (version !== requestVersion.current) return;
      const normalized: Comment[] = data.comments.map(row => ({ id: row.id, article_id: row.articleId, parent_id: row.parentId, author_id: row.authorId, body: row.body, status: row.status === "active" ? "published" : row.status === "hidden" ? "hidden" : "deleted", created_at: row.createdAt, updated_at: row.updatedAt, author: row.username ? { display_name: row.username } : null }));
      setComments(current => append ? [...current, ...normalized.filter(item => !current.some(entry => entry.id === item.id))] : normalized);
      setTotal(data.total);
    } catch { if (version === requestVersion.current) setError("댓글을 불러오지 못했습니다. 연결 상태를 확인해주세요."); }
    finally { if (version === requestVersion.current) setLoading(false); }
  }, [articleId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void fetchComments(); }, 0);
    const interval = window.setInterval(() => { if (document.visibilityState === "visible") void fetchComments(); }, 60_000);
    return () => { window.clearTimeout(timer); window.clearInterval(interval); requestVersion.current += 1; };
  }, [fetchComments]);

  async function mutate(name: string, args: Record<string, unknown>, success: string) {
    if (!session) { requestMemberLogin(); return false; }
    if (busy) return false;
    setBusy(true); setError(""); setNotice("");
    try {
      const commentId = String(args.p_comment_id || "");
      const path = name === "create_news_comment" ? "/v1/comments" : `/v1/comments/${commentId}/${name === "edit_news_comment" ? "edit" : name === "delete_news_comment" ? "delete" : "report"}`;
      const payload = name === "create_news_comment" ? { articleId, body: args.p_body, parentId: args.p_parent_id } : name === "edit_news_comment" ? { body: args.p_body } : name === "report_news_comment" ? { reason: args.p_reason, detail: args.p_detail } : {};
      await memberRequest(path, { method: "POST", body: JSON.stringify(payload) });
      setNotice(success);
      await fetchComments();
      return true;
    } catch (failure) { setError(failure instanceof Error ? failure.message : "댓글 서버에 연결하지 못했습니다. 작성한 내용은 그대로 유지됩니다."); return false; }
    finally { setBusy(false); }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!body.trim()) return;
    const done = await mutate("create_news_comment", { p_article_id: articleId, p_body: body.trim(), p_parent_id: replyTo?.id ?? null }, "댓글을 등록했습니다.");
    if (done) { setBody(""); setReplyTo(null); }
  }

  return <section className="article-comments" aria-label="독자 댓글">
    <div className="community-heading"><div><h2><MessageCircle size={20} aria-hidden="true" /> 독자 댓글</h2><p>독자 의견입니다. 뉴스에서 확인된 사실이나 AI 답변과 구분됩니다.</p></div></div>
    <CommunityAuthPanel />
    {configured && session && !authLoading && <form className="community-composer" onSubmit={submit}>
      {replyTo && <div className="community-reply-target"><span>{replyTo.author?.display_name ?? "독자"}님에게 답글</span><button type="button" onClick={() => setReplyTo(null)}>취소</button></div>}
      <label htmlFor={`comment-${articleId}`}>{replyTo ? "답글 작성" : "의견 작성"}</label>
      <textarea ref={bodyRef} id={`comment-${articleId}`} maxLength={2000} rows={4} value={body} onChange={(event) => setBody(event.target.value)} placeholder="기사에 대한 생각을 나눠주세요. 개인정보·욕설·스팸은 남기지 마세요." required disabled={busy} />
      <div className="community-composer-bottom"><span>{body.length.toLocaleString()} / 2,000</span><button type="submit" disabled={busy || !body.trim()}>{busy ? <LoaderCircle size={16} className="community-spinner" aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}{busy ? "처리 중…" : replyTo ? "답글 등록" : "댓글 등록"}</button></div>
    </form>}
    {error && <p className="community-error" role="alert">{error}</p>}
    {notice && <p className="community-notice" role="status">{notice}</p>}
    {configured && <div className="community-list-heading"><span>최신순</span><span>여러 독자가 신고한 댓글은 임시 숨김 처리됩니다.</span></div>}
    {loading && !comments.length && <p className="community-empty" role="status"><LoaderCircle className="community-spinner" size={18} aria-hidden="true" /> 댓글을 불러오는 중…</p>}
    {configured && !loading && !error && comments.length === 0 && <p className="community-empty">아직 댓글이 없습니다. 첫 의견을 남겨보세요.</p>}
    <ol className="community-list">
      {comments.map((comment) => <li key={comment.id} className={comment.parent_id ? "community-comment is-reply" : "community-comment"}>
        <div className="community-comment-meta"><span className="community-avatar" aria-hidden="true"><UserRound size={18} /></span><strong>{comment.status !== "published" ? "독자" : comment.author?.display_name ?? "탈퇴한 독자"}</strong><time dateTime={comment.created_at}>{dateLabel(comment.created_at)}</time>{comment.updated_at !== comment.created_at && comment.status === "published" && <span>수정됨</span>}</div>
        {comment.parent_id && <p className="community-parent"><Reply size={13} aria-hidden="true" /> {comments.find((item) => item.id === comment.parent_id)?.author?.display_name ?? "이전 댓글"}에 대한 답글</p>}
        {comment.status !== "published" ? <p className="community-deleted">{comment.status === "hidden" ? "신고로 임시 숨김 처리된 댓글입니다." : "작성자가 삭제한 댓글입니다."}</p> : editId === comment.id ? <form className="community-inline-form" onSubmit={async (event) => { event.preventDefault(); if (await mutate("edit_news_comment", { p_comment_id: comment.id, p_body: editBody.trim() }, "댓글을 수정했습니다.")) setEditId(null); }}><label htmlFor={`edit-${comment.id}`}>댓글 수정</label><textarea id={`edit-${comment.id}`} maxLength={2000} rows={4} value={editBody} onChange={(event) => setEditBody(event.target.value)} disabled={busy} required /><div><button type="button" onClick={() => setEditId(null)} disabled={busy}>취소</button><button type="submit" disabled={busy || !editBody.trim()}>수정 저장</button></div></form> : <p className="community-comment-body">{comment.body}</p>}
        {comment.status === "published" && <div className="community-comment-actions">
          <button type="button" disabled={busy} onClick={() => { if (!session) { requestMemberLogin(); return; } setReplyTo(comment.parent_id ? comments.find((item) => item.id === comment.parent_id) ?? { ...comment, id: comment.parent_id } : comment); bodyRef.current?.focus(); bodyRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }); }}>답글</button>
          {session?.user.id === comment.author_id && <><button type="button" disabled={busy} onClick={() => { setEditId(comment.id); setEditBody(comment.body); }}>수정</button><button type="button" disabled={busy} onClick={() => setDeleteId(comment.id)}>삭제</button></>}
          <button type="button" className="community-report-action" disabled={busy} onClick={() => { if (!session) { requestMemberLogin(); return; } setReportId(comment.id); setReportDetail(""); }}><Flag size={12} aria-hidden="true" /> 신고</button>
        </div>}
        {deleteId === comment.id && <div className="community-inline-confirm"><p>댓글을 삭제할까요? 삭제한 내용은 복구할 수 없습니다.</p><button type="button" onClick={() => setDeleteId(null)} disabled={busy}>취소</button><button type="button" disabled={busy} onClick={async () => { if (await mutate("delete_news_comment", { p_comment_id: comment.id }, "댓글을 삭제했습니다.")) setDeleteId(null); }}>삭제 확인</button></div>}
        {reportId === comment.id && <form className="community-inline-form" onSubmit={async (event) => { event.preventDefault(); if (await mutate("report_news_comment", { p_comment_id: comment.id, p_reason: reportReason, p_detail: reportDetail.trim() }, "신고를 접수했습니다. 여러 독자가 신고한 댓글은 임시 숨김 처리됩니다.")) setReportId(null); }}><label htmlFor={`report-reason-${comment.id}`}>신고 사유</label><select id={`report-reason-${comment.id}`} value={reportReason} onChange={(event) => setReportReason(event.target.value)} disabled={busy}><option value="spam">스팸·광고</option><option value="abuse">욕설·혐오·괴롭힘</option><option value="misinformation">허위 정보</option><option value="privacy">개인정보 노출</option><option value="other">기타</option></select><label htmlFor={`report-detail-${comment.id}`}>추가 설명 (선택)</label><textarea id={`report-detail-${comment.id}`} rows={2} maxLength={500} value={reportDetail} onChange={(event) => setReportDetail(event.target.value)} disabled={busy} /><div><button type="button" onClick={() => setReportId(null)} disabled={busy}>취소</button><button type="submit" disabled={busy}>신고 접수</button></div></form>}
      </li>)}
    </ol>
    {total !== null && comments.length < total && <button className="community-load-more" type="button" onClick={() => void fetchComments(true, comments.length)} disabled={loading}>{loading ? "불러오는 중…" : "댓글 더 보기"}</button>}
  </section>;
}
