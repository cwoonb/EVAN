"""Regression checks for public serialization and conservative incident grouping."""

import csv
from datetime import datetime, timezone
import io
import json
from pathlib import Path
import random
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from scripts import build_news_feed as pipeline


def row(index=1, **changes):
    value = {
        "title": "Acme launches Atlas 3.1 for document search",
        "published": "2026-10-17T01:00:00+00:00",
        "source": "Example News",
        "article_url": f"https://example.com/story-{index}",
        "content": "PRIVATE RAW ARTICLE NEVER PUBLISH",
        "important": "중요", "important_score": "",
        "category": "기술", "event_type": "출시",
        "summary": "Acme가 문서 검색용 Atlas 3.1을 출시했다.",
        "keywords": "Acme | Atlas | 문서 검색",
        "search_keywords": "['AI Agent']", "search_keyword": "Atlas",
        "new_technologies": '["Atlas"]',
        "event_subject": "Acme", "event_action": "출시",
        "event_object": "문서 검색 엔진 Atlas 3.1",
        "event_version": "3.1", "event_date": "2026-10-17",
        "event_summary": "Acme가 문서 검색 엔진 Atlas 3.1을 출시했다.",
        "analysis_status": "partial_failed", "qwen_status": "ok", "cluster_id": "",
    }
    value.update(changes)
    return value


class NormalizationTests(unittest.TestCase):
    def test_empty_and_nonfinite_cells(self):
        for value in (None, "NaN", " nan ", "None", "null", "NaT", float("nan"), float("inf")):
            self.assertEqual(pipeline.clean_text(value), "")
        self.assertEqual(pipeline.parse_list("not-a-list"), ("not-a-list",))

    def test_lists_support_python_json_and_legacy_without_execution(self):
        for value in ('["Atlas", "Acme"]', "['Atlas', 'Acme']", "Atlas | Acme | Atlas"):
            self.assertEqual(pipeline.parse_list(value), ("Acme", "Atlas"))
        self.assertEqual(pipeline.parse_list('{"unexpected": "dictionary"}'), ())
        self.assertEqual(pipeline.parse_list("[__import__('os').system('echo bad')]"), ())
        self.assertEqual(pipeline.parse_list('["Atlas", null, {}, true, "NaN"]'), ("Atlas",))

    def test_importance_preserves_analyzer_scale_and_valid_numeric_score(self):
        for name, score in pipeline.IMPORTANCE.items():
            self.assertEqual(pipeline.importance_value(name), score)
        self.assertEqual(pipeline.importance_value("매우 중요", "1"), 1)
        self.assertEqual(pipeline.importance_value("매우 중요", "NaN"), 4)
        self.assertEqual(pipeline.importance_value("", "3.0"), 3)
        for score in ("NaN", "Infinity", "6", "0", "2.5", "garbage"):
            self.assertEqual(pipeline.importance_value("", score), 1)

    def test_urls_validate_and_remove_trackers_secrets_fragments(self):
        self.assertEqual(
            pipeline.canonical_url("https://EXAMPLE.com:443/article?utm_source=mail&id=7&token=private#section"),
            "https://example.com/article?id=7",
        )
        for url in ("javascript:alert(1)", "file:///Users/private.csv", "https://user:pass@example.com/a", "http://127.0.0.1/a", "https://localhost/a", "https://example.com:bad/a", "https://example.com/a b"):
            self.assertEqual(pipeline.canonical_url(url), "", url)

    def test_public_text_redacts_private_paths_and_credentials(self):
        text = pipeline.clean_text("로그 /Users/person/private/file.csv ghp_" + "x" * 30)
        self.assertNotIn("/Users/", text)
        self.assertNotIn("ghp_", text)

    def test_typed_keywords_fill_missing_legacy_tags_without_exporting_raw_fields(self):
        typed = '{"company":["Acme"],"model":["Atlas"],"product":[],"technology":["RAG"],"framework":["GraphKit"],"private_key":["NEVER"]}'
        feed = pipeline.build_feed([row(keywords="NaN", keyword_types=typed)])
        self.assertEqual(feed["issues"][0]["keywords"], ["Acme", "Atlas", "GraphKit", "RAG"])
        self.assertNotIn("NEVER", json.dumps(feed))
        self.assertEqual(pipeline.typed_keywords("{'company': ['Acme']}"), ("Acme",))
        self.assertEqual(pipeline.typed_keywords("{broken"), ())

    def test_bad_rows_count_skipped_without_inventing_dates(self):
        feed = pipeline.build_feed([row(), row(2, published="not-a-date"), row(3, article_url="javascript:alert(1)"), row(4, title="NaN")])
        self.assertEqual(feed["stats"], {"inputRows": 4, "articles": 1, "issues": 1, "duplicates": 0, "skipped": 3})
        self.assertEqual(feed["latestPublishedAt"], "2026-10-17T01:00:00Z")


class GroupingTests(unittest.TestCase):
    def articles(self, *rows):
        return [pipeline.article_from_row(value) for value in rows]

    def test_same_concrete_event_groups_distinct_sources(self):
        first, second = self.articles(row(), row(2, source="Other News", title="Acme Atlas 3.1 document search launch explained"))
        self.assertTrue(pipeline.same_event(first, second))
        feed = pipeline.build_feed([row(), row(2)])
        self.assertEqual(feed["stats"]["issues"], 1)
        self.assertEqual(len(feed["issues"][0]["sources"]), 2)

    def test_related_company_keywords_do_not_group_different_objects(self):
        first, second = self.articles(row(), row(2, event_object="Atlas API enterprise billing dashboard"))
        self.assertFalse(pipeline.same_event(first, second))
        self.assertEqual(len(pipeline.build_feed([row(), row(2, event_subject="Other Company")])["issues"]), 2)

    def test_action_conflicts_and_planned_actions_stay_separate(self):
        first = pipeline.article_from_row(row())
        for action in ("업데이트", "출시 예정 발표", "출시 연기", "출시 취소", "출시 (보도)"):
            self.assertFalse(pipeline.same_event(first, pipeline.article_from_row(row(2, event_action=action))), action)

    def test_explicit_and_inferred_version_conflicts(self):
        for changes in (
            {"event_version": "3.2"},
            {"event_version": "31"},
            {"event_version": "", "event_object": "GPT-5.2 document search", "title": "GPT-5.2 release"},
        ):
            first = row(event_object="GPT-5.1 document search", title="GPT-5.1 release", event_version="3.1") if not changes.get("event_version") else row()
            self.assertFalse(pipeline.same_event(*self.articles(first, row(2, **changes))))
        self.assertTrue(pipeline.same_event(*self.articles(row(), row(2, event_version="v3.1"))))

    def test_dates_and_publication_window_block_repeated_announcements(self):
        first = pipeline.article_from_row(row())
        for changes in ({"event_date": "2026-10-16"}, {"published": "2026-10-21T01:00:00Z", "event_date": ""}):
            self.assertFalse(pipeline.same_event(first, pipeline.article_from_row(row(2, **changes))))

    def test_explicit_cluster_never_overrides_a_conflict(self):
        rows = [row(cluster_id="same-upstream"), row(2, cluster_id="same-upstream", event_action="업데이트")]
        self.assertEqual(len(pipeline.build_feed(rows)["issues"]), 2)
        compatible = pipeline.build_feed([row(cluster_id="hint"), row(2, cluster_id="hint")])
        self.assertIn("verified-cluster-hint", compatible["issues"][0]["analysis"]["groupingMethod"])

    def test_missing_structured_data_or_generic_objects_never_use_keywords(self):
        for changes in ({"event_subject": ""}, {"event_action": ""}, {"event_object": ""}, {"event_object": "AI"}):
            self.assertEqual(len(pipeline.build_feed([row(**changes), row(2, **changes)])["issues"]), 2)

    def test_amount_and_transaction_targets_conflict(self):
        first, second = self.articles(row(event_object="$1 billion Atlas research investment"), row(2, event_object="$2 billion Atlas research investment"))
        self.assertFalse(pipeline.same_event(first, second))
        first, second = self.articles(row(title="Acme Stock Sold by Alpha Capital"), row(2, title="Acme Stock Sold by Beta Capital"))
        self.assertFalse(pipeline.same_event(first, second))

    def test_complete_linkage_prevents_time_chain_merging(self):
        rows = [row(published="2026-10-10T01:00:00Z"), row(2, published="2026-10-12T01:00:00Z"), row(3, published="2026-10-14T01:00:00Z")]
        feed = pipeline.build_feed(rows)
        self.assertEqual(sorted(len(issue["sources"]) for issue in feed["issues"]), [1, 2])


class FeedTests(unittest.TestCase):
    def test_tracking_duplicates_are_one_article_and_functional_ids_differ(self):
        rows = [row(article_url="https://www.example.com/a/?id=2&utm_medium=email"), row(2, article_url="http://example.com/a?id=2#part"), row(3, article_url="https://example.com/a?id=3")]
        feed = pipeline.build_feed(rows)
        self.assertEqual(feed["stats"]["articles"], 2)
        self.assertEqual(feed["stats"]["duplicates"], 1)
        self.assertEqual(sum(len(issue["sources"]) for issue in feed["issues"]), 2)

    def test_ids_revision_and_duplicate_selection_do_not_depend_on_row_order(self):
        rows = [row(), row(2), row(3, event_object="Other concrete object"), row(title="Duplicate poorer metadata", event_summary="", event_subject="", summary="")]
        reference = pipeline.build_feed(rows, generated_at=datetime(2026, 1, 1, tzinfo=timezone.utc))
        for seed in range(10):
            shuffled = rows.copy()
            random.Random(seed).shuffle(shuffled)
            actual = pipeline.build_feed(shuffled, generated_at=datetime(2026, 2, 1, tzinfo=timezone.utc))
            self.assertEqual(reference["revision"], actual["revision"])
            self.assertEqual(reference["issues"], actual["issues"])
            self.assertNotEqual(reference["generatedAt"], actual["generatedAt"])

    def test_equal_quality_conflicting_duplicate_is_still_order_stable(self):
        first, second = row(), row(event_object="문서 검색 엔진 Atlas 3.2")
        self.assertEqual(pipeline.build_feed([first, second])["revision"], pipeline.build_feed([second, first])["revision"])

    def test_output_is_whitelisted_finite_and_metadata_is_honest(self):
        feed = pipeline.build_feed([row(extra_secret="NEVER", raw_path="/Users/private", important_score=float("nan"))])
        encoded = json.dumps(feed, allow_nan=False)
        for forbidden in ("PRIVATE RAW ARTICLE", "NEVER", "/Users/private", "raw_path", "extra_secret", "cluster_id"):
            self.assertNotIn(forbidden, encoded)
        issue = feed["issues"][0]
        self.assertEqual(issue["analysis"]["status"], "partial_failed")
        self.assertEqual(issue["analysis"]["summaryMethod"], "existing-qwen-extractive-v1")
        self.assertNotIn("llm", issue["analysis"]["groupingMethod"])
        self.assertEqual(set(issue["sources"][0]), {"id", "title", "source", "url", "publishedAt", "summary", "searchKeywords"})

    def test_summary_keeps_existing_independent_facts_without_new_generation(self):
        feed = pipeline.build_feed([row(), row(2, event_summary="Atlas 3.1은 문서 검색에 사용할 수 있다.")])
        summary = feed["issues"][0]["summary"]
        self.assertIn("출시했다", summary)
        self.assertIn("사용할 수 있다", summary)

    def test_atomic_failure_preserves_old_output_and_removes_temporary(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "news.json"
            output.write_text("old feed")
            with patch.object(pipeline.os, "replace", side_effect=OSError("disk failure")):
                with self.assertRaises(OSError):
                    pipeline.atomic_write(pipeline.build_feed([row()]), output)
            self.assertEqual(output.read_text(), "old feed")
            self.assertEqual([path.name for path in output.parent.iterdir()], ["news.json"])

    def test_empty_header_only_and_truncated_csv_are_fatal(self):
        samples = ("", "title,published,article_url\n", 'title,published,article_url\n"unfinished,2026-10-17,https://example.com/a', "title,published,article_url\nExample,2026-10-17\n")
        with tempfile.TemporaryDirectory() as directory:
            csv_path = Path(directory) / "source.csv"
            output = Path(directory) / "news.json"
            output.write_text("old feed")
            for sample in samples:
                csv_path.write_text(sample)
                with patch("sys.stderr", new=io.StringIO()):
                    self.assertEqual(pipeline.main(["--csv", str(csv_path), "--output", str(output)]), 1)
                self.assertEqual(output.read_text(), "old feed")

    def test_all_invalid_rows_leave_existing_feed_untouched(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.csv"
            output = Path(directory) / "news.json"
            source.write_text("title,published,article_url\nInvalid,NaN,javascript:bad\n")
            output.write_text("old feed")
            with patch("sys.stderr", new=io.StringIO()):
                self.assertEqual(pipeline.main(["--csv", str(source), "--output", str(output)]), 1)
            self.assertEqual(output.read_text(), "old feed")

    def test_cli_end_to_end_csv_and_env_input(self):
        with tempfile.TemporaryDirectory() as directory:
            csv_path = Path(directory) / "source.csv"
            output = Path(directory) / "nested" / "news.json"
            sample = row()
            with csv_path.open("w", newline="", encoding="utf-8-sig") as file:
                writer = csv.DictWriter(file, fieldnames=list(sample))
                writer.writeheader()
                writer.writerow(sample)
            result = subprocess.run([sys.executable, str(Path(pipeline.__file__)), "--csv", str(csv_path), "--output", str(output)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            feed = json.loads(output.read_text())
            self.assertEqual(feed["stats"]["articles"], 1)
            with patch.dict(pipeline.os.environ, {"NEWS_CSV_PATH": str(csv_path)}), patch("sys.stdout", new=io.StringIO()):
                self.assertEqual(pipeline.main(["--output", str(output)]), 0)
            self.assertEqual(feed["revision"], json.loads(output.read_text())["revision"])


if __name__ == "__main__":
    unittest.main()
