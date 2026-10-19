/** Executes the production migration in real PostgreSQL (PGlite/WASM).
 * Only Supabase's auth schema/claims helpers are stubbed. No production data.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const unverified = "33333333-3333-4333-8333-333333333333";
const article = "article_0123456789abcdef0123";
const another = "article_abcdef0123456789abcd";
let assertions = 0;

async function check(label, callback) {
  await callback();
  assertions += 1;
  console.log(`ok ${assertions} - ${label}`);
}
async function query(sql, values = []) { return (await db.query(sql, values)).rows; }
async function role(name, user, extra = {}) {
  assert.ok(["anon", "authenticated", "service_role"].includes(name));
  await db.exec("reset role");
  await query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ role: name, sub: user, is_anonymous: false, ...extra })]);
  await db.exec(`set role ${name}`);
}
async function deny(sql, values, code, text) {
  await assert.rejects(query(sql, values), (error) => error.code === code && (!text || error.message.includes(text)));
}
async function clearLimits() {
  await db.exec("reset role; delete from community_private.write_events; set role authenticated");
}
async function create(body, parent = null, target = article, name = null) {
  return (await query("select public.create_news_comment($1,$2,$3,$4) as id", [target, body, parent, name]))[0].id;
}

try {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    grant usage on schema auth, public to anon, authenticated, service_role;
    create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz, banned_until timestamptz);
    create function auth.jwt() returns jsonb language sql stable as
      $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
    insert into auth.users(id,email,email_confirmed_at) values
      ('${owner}','owner@example.invalid',now()),('${other}','other@example.invalid',now()),('${unverified}','unverified@example.invalid',null);
  `);
  const migration = await readFile(new URL("../migrations/202610180001_news_comments.sql", import.meta.url), "utf8");
  await check("production migration executes without SQL errors", () => db.exec(migration));
  await role("anon");
  await check("signed-out reader sees a genuinely empty comment list", async () => assert.equal((await query("select * from public.news_comments")).length, 0));
  await check("anon cannot call the write RPC", () => deny("select public.create_news_comment($1,'anonymous',null,null)", [article], "42501"));
  await role("authenticated", unverified);
  await check("unverified email cannot write", () => deny("select public.create_news_comment($1,'unverified',null,null)", [article], "42501", "EVAN_LOGIN_REQUIRED"));
  await role("authenticated", owner, { is_anonymous: true });
  await check("anonymous Auth account cannot write", () => deny("select public.create_news_comment($1,'anonymous account',null,null)", [article], "42501", "EVAN_LOGIN_REQUIRED"));
  await role("authenticated", owner);
  await check("arbitrary issue identifiers cannot become article IDs", () => deny("select public.create_news_comment('issue_x','invalid',null,null)", [], "22023", "EVAN_INVALID_ARTICLE"));
  await check("blank body is rejected by the database", () => deny("select public.create_news_comment($1,'   ',null,null)", [article], "22023", "EVAN_INVALID_BODY"));
  await check("oversized body is rejected", () => deny("select public.create_news_comment($1,$2,null,null)", [article, "x".repeat(2001)], "22023", "EVAN_INVALID_BODY"));
  await check("control characters are rejected", () => deny("select public.create_news_comment($1,$2,null,null)", [article, "bad\u0007text"], "22023", "EVAN_INVALID_BODY"));
  await check("more than three links is rejected", () => deny("select public.create_news_comment($1,$2,null,null)", [article, "https://a https://b http://c www.d"], "22023", "EVAN_INVALID_LINK_COUNT"));
  await check("reserved administrator display name is rejected", () => deny("select public.create_news_comment($1,'name test',null,'EVAN')", [article], "22023", "EVAN_INVALID_NAME"));
  const first = await create("독자 의견 @EVAN: 확인된 기사 근거가 궁금합니다.", null, article, "첫 번째 독자");
  await check("authenticated reader creates an opinion with mention metadata", async () => {
    const [row] = await query("select content_kind,mentions_evan,author_id from public.news_comments where id=$1", [first]);
    assert.deepEqual(row, { content_kind: "reader_opinion", mentions_evan: true, author_id: owner });
  });
  await check("rapid create requests are throttled", () => deny("select public.create_news_comment($1,'second post',null,null)", [article], "P0001", "EVAN_RATE_LIMIT"));
  await clearLimits();
  await check("duplicate opinion cannot be spammed across articles", () => deny("select public.create_news_comment($1,$2,null,null)", [another, "독자 의견 @EVAN: 확인된 기사 근거가 궁금합니다."], "23505", "EVAN_DUPLICATE"));
  await check("direct INSERT cannot bypass the limiter", () => deny("insert into public.news_comments(article_id,author_id,body) values($1,$2,'bypass')", [article, owner], "42501"));
  await check("direct profile UPDATE cannot bypass profile validation", () => deny("update public.community_profiles set display_name='관리자'", [], "42501"));
  await role("anon");
  await check("signed-out reader can read published comments", async () => assert.equal((await query("select id from public.news_comments where id=$1", [first])).length, 1));
  await check("public profile has no email field", async () => {
    const [profile] = await query("select * from public.community_profiles where user_id=$1", [owner]);
    assert.deepEqual(Object.keys(profile).sort(), ["created_at", "display_name", "user_id"]);
  });
  await check("signed-out reader cannot UPDATE", () => deny("update public.news_comments set body='bad'", [], "42501"));
  await check("signed-out reader cannot DELETE", () => deny("delete from public.news_comments", [], "42501"));
  await check("signed-out reader cannot inspect reports", () => deny("select * from public.news_comment_reports", [], "42501"));
  await role("authenticated", other);
  await check("another user cannot edit the owner comment", () => deny("select public.edit_news_comment($1,'hijack')", [first], "42501", "EVAN_NOT_OWNER"));
  await check("another user cannot delete the owner comment", () => deny("select public.delete_news_comment($1)", [first], "42501", "EVAN_NOT_OWNER"));
  await check("cross-article reply is rejected", () => deny("select public.create_news_comment($1,'wrong parent',$2,null)", [another, first], "22023", "EVAN_INVALID_PARENT"));
  const reply = await create("다른 관점의 답글입니다.", first);
  await clearLimits();
  await check("same-article reply is linked to its root", async () => assert.equal((await query("select parent_id from public.news_comments where id=$1", [reply]))[0].parent_id, first));
  await check("nested reply cannot evade bounded reply depth", () => deny("select public.create_news_comment($1,'deep nesting',$2,null)", [article, reply], "22023", "EVAN_INVALID_PARENT"));
  await query("select public.report_news_comment($1,'spam','검토 요청')", [first]);
  await check("ordinary reader cannot read even their own report record", async () => assert.equal((await query("select * from public.news_comment_reports")).length, 0));
  await check("a report alone never automatically hides a comment", async () => assert.equal((await query("select status from public.news_comments where id=$1", [first]))[0].status, "published"));
  await clearLimits();
  await check("duplicate report is rejected", () => deny("select public.report_news_comment($1,'other','again')", [first], "23505", "EVAN_DUPLICATE"));
  await check("direct report INSERT is forbidden", () => deny("insert into public.news_comment_reports(comment_id,reporter_id,reason,evidence) values($1,$2,'spam','bad')", [first, other], "42501"));
  await role("authenticated", other, { user_metadata: { role: "admin" } });
  await check("user-editable metadata cannot grant moderation permission", () => deny("select public.moderate_news_comment($1,'hidden','spoof')", [first], "42501", "EVAN_ADMIN_REQUIRED"));
  await role("authenticated", owner);
  await query("select public.edit_news_comment($1,'수정한 독자 의견')", [first]);
  await check("owner can edit their published comment", async () => assert.equal((await query("select body from public.news_comments where id=$1", [first]))[0].body, "수정한 독자 의견"));
  await check("authenticated direct UPDATE is forbidden", () => deny("update public.news_comments set body='direct' where id=$1", [first], "42501"));
  await check("authenticated direct DELETE is forbidden", () => deny("delete from public.news_comments where id=$1", [first], "42501"));
  await role("authenticated", owner, { app_metadata: { role: "admin" } });
  await check("trusted administrator can inspect report evidence", async () => assert.equal((await query("select evidence from public.news_comment_reports where comment_id=$1", [first]))[0].evidence.includes("@EVAN"), true));
  await query("select public.moderate_news_comment($1,'hidden','스팸 검토')", [first]);
  await role("anon");
  await check("hidden content is excluded from direct public SELECT", async () => assert.equal((await query("select body from public.news_comments where id=$1", [first])).length, 0));
  await role("authenticated", owner, { app_metadata: { role: "admin" } });
  await query("select public.moderate_news_comment($1,'published','검토 후 복원')", [first]);
  await role("authenticated", owner);
  await query("select public.delete_news_comment($1)", [first]);
  await role("anon");
  await check("soft deletion exposes no deleted content", async () => assert.deepEqual((await query("select body,status from public.news_comments where id=$1", [first]))[0], { body: "", status: "deleted" }));
  await check("soft deletion preserves replies", async () => assert.equal((await query("select parent_id from public.news_comments where id=$1", [reply]))[0].parent_id, first));
  await role("authenticated", owner);
  await clearLimits();
  await check("owner cannot undelete through edit RPC", () => deny("select public.edit_news_comment($1,'restore')", [first], "P0002", "EVAN_NOT_FOUND"));
  await role("authenticated", owner, { app_metadata: { role: "admin" } });
  await check("moderator cannot restore erased text", () => deny("select public.moderate_news_comment($1,'published','restore')", [first], "P0002", "EVAN_NOT_FOUND"));
  await db.exec("reset role");
  await query("insert into community_private.write_events(user_id,action,created_at) select $1,'create',now()-interval '2 minutes' from generate_series(1,20)", [other]);
  await role("authenticated", other);
  await check("hourly limit applies even outside the cooldown", () => deny("select public.create_news_comment($1,'hourly overflow',null,null)", [article], "P0001", "EVAN_RATE_LIMIT"));
  await check("authenticated reader cannot inspect private rate records", () => deny("select * from community_private.write_events", [], "42501"));
  await check("private security helpers cannot be directly invoked", () => deny("select community_private.require_member('create')", [], "42501"));
  console.log(`${assertions} PostgreSQL security assertions passed.`);
} finally {
  await db.close();
}
