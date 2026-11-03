# Why there is no hosted demo link

LearnAble AI runs its AI locally. The FastAPI backend sends prompts only to Ollama at `http://127.0.0.1:11434` on the same Mac. There is no setting for a remote Ollama host, no cloud model, no API key, and no telemetry.

A backend deployed to a cloud host cannot reach Ollama on this Mac through loopback, so lesson and question generation would not work there. For that reason this repository does **not** include a hosting recipe (an earlier `render.yaml` was removed) and the README gives no deployment link. The supported way to use or judge the project is to run it locally, or to watch the recorded demo video.

A hosted version would need a different design (for example, each user running the backend and Ollama on their own computer), which is outside this hackathon scope. Never expose Ollama's port to the public internet.

## Environment variables

| Variable | Used by | Purpose |
| --- | --- | --- |
| `OLLAMA_MODEL` | Backend | Local model tag, default `qwen3.5:4b`. Tags ending in `:cloud` are rejected. |
| `LEARNABLE_DB_PATH` | Backend | SQLite file path (default `backend/data/learnable.sqlite3`) |
| `FRONTEND_ORIGINS` | Backend | Allowed browser origins for CORS (default: the local Vite dev server) |
| `VITE_API_BASE_URL` | Frontend | Backend URL (default `http://localhost:8000`) |
