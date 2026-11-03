import sqlite3

from app.db.repository import _connection, save_attempt


def test_existing_database_gets_source_evidence_column(monkeypatch, tmp_path):
    database_path = tmp_path / "existing.sqlite3"
    with sqlite3.connect(database_path) as connection:
        connection.execute(
            """CREATE TABLE practice_questions (
                session_id TEXT NOT NULL,
                question_index INTEGER NOT NULL,
                question_text TEXT NOT NULL,
                options_json TEXT NOT NULL,
                correct_option_index INTEGER NOT NULL,
                explanation TEXT NOT NULL,
                source_pages_json TEXT NOT NULL,
                PRIMARY KEY (session_id, question_index)
            )"""
        )
    monkeypatch.setenv("LEARNABLE_DB_PATH", str(database_path))

    with _connection() as connection:
        columns = {row["name"]: row for row in connection.execute("PRAGMA table_info(practice_questions)")}

    assert "source_evidence_json" in columns
    assert columns["source_evidence_json"]["dflt_value"] == "'[]'"


def test_unique_attempt_rule_handles_concurrent_duplicate_submission(monkeypatch, tmp_path):
    monkeypatch.setenv("LEARNABLE_DB_PATH", str(tmp_path / "attempts.sqlite3"))
    with _connection() as connection:
        connection.execute(
            "INSERT INTO practice_sessions VALUES (?, ?, ?, ?, ?, ?)",
            ("session", "learner", "now", "steady", "direct", 1),
        )
        connection.execute(
            """INSERT INTO practice_questions
               (session_id, question_index, question_text, options_json, correct_option_index,
                explanation, source_pages_json, source_evidence_json)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            ("session", 0, "Question?", '["A", "B", "C", "D"]', 0, "Because.", "[1]", "[]"),
        )

    assert save_attempt("session", 0, 0, True) is True
    assert save_attempt("session", 0, 1, False) is False
    with _connection() as connection:
        count = connection.execute("SELECT COUNT(*) FROM practice_attempts").fetchone()[0]
    assert count == 1
