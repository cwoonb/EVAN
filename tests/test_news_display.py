"""Display enrichment must never mutate CSV, leak full text, or block news."""
import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

from scripts import build_news_display as display
from scripts import build_news_feed as feed


def row(index=1, **changes):
    result = {
        "title": "Acme releases Atlas 3.1 - Example News",
        "source": "Example News", "published": "2026-10-18T10:00:00Z",
        "article_url": f"https://example.com/story-{index}",
        "summary": "Acme가 Atlas 3.1을 출시했다.",
        "content": "PRIVATE FULL ARTICLE BODY NEVER SEND OR SAVE",
        "event_subject": "Acme", "event_action": "releases", "event_object": "Atlas 3.1",
        "qwen_status": "ok", "analysis_status": "ok", "content_status": "success",
    }
    result.update(changes)
    return result


def translated(article):
    return display.parse_response({"titleKo": "Acme, Atlas 3.1 출시", "event": {
        "subject": "Acme", "action": "출시", "object": "Atlas 3.1"}}, article)


class DisplayTests(unittest.TestCase):
    def test_unchanged_fingerprint_reuses_cache_without_model_request_or_rewrite(self):
        article = feed.article_from_row(row())
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "display.json"
            feed.atomic_write({"version": 1, "articles": {article.id: translated(article)}}, path)
            before = path.read_bytes()
            request = Mock(side_effect=AssertionError("Model must not be called"))
            stats = display.generate_cache([row()], path, request=request)
            self.assertEqual(stats["cached"], 1)
            request.assert_not_called()
            self.assertEqual(path.read_bytes(), before)

    def test_invalid_response_preserves_existing_success_and_retries_only_missing(self):
        first, second = feed.article_from_row(row()), feed.article_from_row(row(2))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "display.json"
            cache = {"version": 1, "articles": {first.id: translated(first)}}
            feed.atomic_write(cache, path)
            before = path.read_bytes()
            request = Mock(side_effect=ValueError("Invalid model response"))
            stats = display.generate_cache([row(), row(2)], path, request=request)
            self.assertEqual(stats["cached"], 1)
            self.assertEqual(stats["failed"], 1)
            self.assertEqual(request.call_args.args[0].id, second.id)
            self.assertEqual(path.read_bytes(), before)

    def test_changed_original_fingerprint_triggers_new_generation(self):
        original = row()
        article = feed.article_from_row(original)
        changed = row(summary="Acme가 Atlas 3.1의 업데이트를 설명했다.")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "display.json"
            feed.atomic_write({"version": 1, "articles": {article.id: translated(article)}}, path)
            request = Mock(side_effect=translated)
            stats = display.generate_cache([changed], path, request=request)
            self.assertEqual(stats["generated"], 1)
            self.assertEqual(json.loads(path.read_text())["articles"][article.id]["fingerprint"], feed.display_fingerprint(changed))

    def test_limit_bounds_requests_and_preserves_remaining_queue(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "display.json"
            request = Mock(side_effect=translated)
            stats = display.generate_cache([row(index) for index in range(1, 6)], path, limit=2, request=request)
            self.assertEqual(request.call_count, 2)
            self.assertEqual(stats["generated"], 2)
            self.assertEqual(stats["remaining"], 3)
            for invalid in (0, -1, 13):
                with self.assertRaises(ValueError):
                    display.generate_cache([row()], path, limit=invalid, request=request)

    def test_target_stable_id_and_duplicate_representative_match_feed_builder(self):
        incomplete = row(summary="", qwen_status="failed")
        complete = row()
        selected = display.selected_articles([incomplete, complete])
        self.assertEqual(len(selected), 1)
        self.assertEqual(selected[0].display_key, feed.display_fingerprint(complete))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "display.json"
            request = Mock(side_effect=translated)
            target = feed.article_from_row(row(2)).id
            stats = display.generate_cache([complete, row(2)], path, article_id=target, request=request)
            self.assertEqual(stats["generated"], 1)
            self.assertEqual(request.call_args.args[0].id, target)
            self.assertEqual(set(json.loads(path.read_text())["articles"]), {target})

    def test_public_projection_contains_only_display_fields_not_article_body(self):
        article = feed.article_from_row(row())
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "display.json"
            display.generate_cache([row()], path, request=translated)
            text = path.read_text()
            self.assertNotIn("PRIVATE FULL ARTICLE", text)
            self.assertNotIn("article_url", text)
            self.assertNotIn('"summary"', text)
            self.assertEqual(set(json.loads(text)["articles"][article.id]), {"fingerprint", "titleKo", "event"})
        payload = display.source_payload(article)
        self.assertEqual(set(payload), {"title", "summary", "event"})
        self.assertNotIn("PRIVATE FULL ARTICLE", json.dumps(payload))
        self.assertNotIn(" - Example News", payload["title"])

    def test_invalid_response_shape_length_language_and_new_numbers_rejected(self):
        article = feed.article_from_row(row())
        for value in (
            {"titleKo": "제목", "event": {}, "content": "raw"},
            {"titleKo": "가" * 61, "event": {"subject": "Acme", "action": "출시", "object": "Atlas 3.1"}},
            {"titleKo": "English only", "event": {"subject": "Acme", "action": "출시", "object": "Atlas 3.1"}},
            {"titleKo": "Acme, Atlas 9.9 출시", "event": {"subject": "Acme", "action": "출시", "object": "Atlas 3.1"}},
        ):
            with self.assertRaises(ValueError):
                display.parse_response(value, article)

    def test_absent_original_event_remains_empty_even_if_model_invents_fields(self):
        article = feed.article_from_row(row(event_subject="", event_action="", event_object=""))
        result = display.parse_response({"titleKo": "Acme, Atlas 3.1 출시", "event": {"subject": "invented", "action": "invented", "object": "invented"}}, article)
        self.assertEqual(result["event"], {"subject": "", "action": "", "object": ""})

    def test_new_flavours_cannot_be_mistranslated_as_sour_taste(self):
        article = feed.article_from_row(row(title="An Italian gelato maker creates new flavours", summary="이탈리아 장인이 새로운 맛을 개발했다.", event_subject="", event_action="", event_object=""))
        with self.assertRaisesRegex(ValueError, "Ambiguous flavour"):
            display.parse_response({"titleKo": "이탈리아 장인, 신맛 개발", "event": {"subject": "", "action": "", "object": ""}}, article)
        valid = display.parse_response({"titleKo": "이탈리아 장인, 새로운 맛 개발", "event": {"subject": "", "action": "", "object": ""}}, article)
        self.assertTrue(display.valid_entry(valid))

    def test_http_request_uses_bounded_timeout_and_secret_header_only(self):
        article = feed.article_from_row(row())
        response = json.dumps({"choices": [{"message": {"content": json.dumps({"titleKo": "Acme, Atlas 3.1 출시", "event": {"subject": "Acme", "action": "출시", "object": "Atlas 3.1"}}, ensure_ascii=False)}}]}).encode()
        connection = Mock()
        connection.__enter__ = Mock(return_value=connection)
        connection.__exit__ = Mock(return_value=False)
        connection.read.return_value = response
        with patch.object(display, "urlopen", return_value=connection) as open_mock:
            result = display.request_display(article, base_url="http://127.0.0.1:8000/v1", model="qwen-test", api_key="PRIVATE_MODEL_KEY", timeout=7)
        request = open_mock.call_args.args[0]
        self.assertEqual(open_mock.call_args.kwargs["timeout"], 7)
        self.assertEqual(request.get_header("Authorization"), "Bearer PRIVATE_MODEL_KEY")
        self.assertNotIn("PRIVATE_MODEL_KEY", request.data.decode())
        self.assertNotIn("PRIVATE FULL ARTICLE", request.data.decode())
        self.assertNotIn("PRIVATE_MODEL_KEY", json.dumps(result))

    def test_runtime_csv_failure_is_nonfatal_and_does_not_log_path_or_key(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "cache.json"
            stderr = io.StringIO()
            with patch.dict(display.os.environ, {"VLLM_API_KEY": "PRIVATE_MODEL_KEY"}), contextlib.redirect_stderr(stderr):
                status = display.main(["--csv", str(Path(directory) / "PRIVATE_PATH.csv"), "--output", str(output)])
            self.assertEqual(status, 0)
            self.assertNotIn("PRIVATE_PATH", stderr.getvalue())
            self.assertNotIn("PRIVATE_MODEL_KEY", stderr.getvalue())
            self.assertFalse(output.exists())

    def test_output_cannot_replace_csv(self):
        with self.assertRaises(SystemExit) as error, contextlib.redirect_stderr(io.StringIO()):
            display.main(["--csv", "news.csv", "--output", "news.csv"])
        self.assertEqual(error.exception.code, 2)


if __name__ == "__main__":
    unittest.main()
