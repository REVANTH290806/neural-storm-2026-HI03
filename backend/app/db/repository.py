import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator
from uuid import uuid4

from app.services.question_generation import QuestionSet


def _database_path() -> Path:
    configured = os.getenv("LEARNABLE_DB_PATH")
    return Path(configured) if configured else Path(__file__).resolve().parents[2] / "data" / "learnable.sqlite3"


@contextmanager
def _connection() -> Iterator[sqlite3.Connection]:
    path = _database_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA journal_mode = WAL")
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS practice_sessions (
            session_id TEXT PRIMARY KEY,
            learner_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            difficulty TEXT NOT NULL,
            strategy TEXT NOT NULL,
            question_count INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_sessions_learner
            ON practice_sessions(learner_id, created_at);

        CREATE TABLE IF NOT EXISTS practice_questions (
            session_id TEXT NOT NULL,
            question_index INTEGER NOT NULL,
            question_text TEXT NOT NULL,
            options_json TEXT NOT NULL,
            correct_option_index INTEGER NOT NULL,
            explanation TEXT NOT NULL,
            source_pages_json TEXT NOT NULL,
            source_evidence_json TEXT NOT NULL DEFAULT '[]',
            PRIMARY KEY (session_id, question_index),
            FOREIGN KEY (session_id) REFERENCES practice_sessions(session_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS practice_attempts (
            attempt_id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            question_index INTEGER NOT NULL,
            selected_option_index INTEGER NOT NULL,
            is_correct INTEGER NOT NULL,
            answered_at TEXT NOT NULL,
            FOREIGN KEY (session_id, question_index)
                REFERENCES practice_questions(session_id, question_index) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_attempts_session
            ON practice_attempts(session_id, answered_at);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_one_attempt_per_question
            ON practice_attempts(session_id, question_index);
        """
    )
    question_columns = {
        row["name"] for row in connection.execute("PRAGMA table_info(practice_questions)").fetchall()
    }
    if "source_evidence_json" not in question_columns:
        connection.execute(
            "ALTER TABLE practice_questions ADD COLUMN source_evidence_json TEXT NOT NULL DEFAULT '[]'"
        )
    # Privacy: earlier versions saved verbatim PDF excerpts here. Quotes now live only
    # in the browser's memory, so clear any that an older database still holds.
    connection.execute("UPDATE practice_questions SET source_evidence_json = '[]' WHERE source_evidence_json != '[]'")
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def save_practice_session(
    learner_id: str,
    question_set: QuestionSet,
    difficulty: str,
    strategy: str,
) -> str:
    session_id = str(uuid4())
    created_at = datetime.now(timezone.utc).isoformat()
    with _connection() as connection:
        connection.execute(
            "INSERT INTO practice_sessions VALUES (?, ?, ?, ?, ?, ?)",
            (session_id, learner_id, created_at, difficulty, strategy, len(question_set.questions)),
        )
        connection.executemany(
            """INSERT INTO practice_questions
               (session_id, question_index, question_text, options_json, correct_option_index,
                explanation, source_pages_json, source_evidence_json)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            [
                (
                    session_id,
                    index,
                    question.question,
                    json.dumps(question.options),
                    question.correct_option_index,
                    question.explanation,
                    json.dumps(question.source_pages),
                    # Verbatim PDF excerpts are deliberately NOT saved; see _connection().
                    "[]",
                )
                for index, question in enumerate(question_set.questions)
            ],
        )
    return session_id


def load_question_for_learner(
    session_id: str,
    learner_id: str,
    question_index: int,
) -> sqlite3.Row | None:
    with _connection() as connection:
        return connection.execute(
            """SELECT q.* FROM practice_questions q
               JOIN practice_sessions s ON s.session_id = q.session_id
               WHERE q.session_id = ? AND s.learner_id = ? AND q.question_index = ?""",
            (session_id, learner_id, question_index),
        ).fetchone()


def save_attempt(
    session_id: str,
    question_index: int,
    selected_option_index: int,
    is_correct: bool,
) -> bool:
    try:
        with _connection() as connection:
            connection.execute(
                """INSERT INTO practice_attempts
                   (session_id, question_index, selected_option_index, is_correct, answered_at)
                   VALUES (?, ?, ?, ?, ?)""",
                (
                    session_id,
                    question_index,
                    selected_option_index,
                    int(is_correct),
                    datetime.now(timezone.utc).isoformat(),
                ),
            )
    except sqlite3.IntegrityError:
        # The unique index is the final guard if two requests race past has_attempt.
        return False
    return True


def has_attempt(session_id: str, question_index: int) -> bool:
    with _connection() as connection:
        row = connection.execute(
            "SELECT 1 FROM practice_attempts WHERE session_id = ? AND question_index = ? LIMIT 1",
            (session_id, question_index),
        ).fetchone()
    return row is not None


def get_progress(learner_id: str) -> dict:
    with _connection() as connection:
        totals = connection.execute(
            """SELECT COUNT(a.attempt_id) AS attempt_count,
                      COALESCE(SUM(a.is_correct), 0) AS correct_count,
                      COUNT(DISTINCT s.session_id) AS session_count
               FROM practice_sessions s
               LEFT JOIN practice_attempts a ON a.session_id = s.session_id
               WHERE s.learner_id = ?""",
            (learner_id,),
        ).fetchone()
        recent = connection.execute(
            """SELECT a.is_correct FROM practice_attempts a
               JOIN practice_sessions s ON s.session_id = a.session_id
               WHERE s.learner_id = ?
               ORDER BY a.attempt_id DESC LIMIT 5""",
            (learner_id,),
        ).fetchall()

    attempts = int(totals["attempt_count"])
    correct = int(totals["correct_count"])
    recent_correct = sum(int(row["is_correct"]) for row in recent)
    return {
        "attempt_count": attempts,
        "correct_count": correct,
        "session_count": int(totals["session_count"]),
        "accuracy_percent": round(100 * correct / attempts) if attempts else None,
        "recent_attempt_count": len(recent),
        "recent_accuracy_percent": round(100 * recent_correct / len(recent)) if recent else None,
    }
