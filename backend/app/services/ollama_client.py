"""Small HTTP client for local-only Ollama structured generations.

Privacy and cost guarantees enforced here:
* The endpoint is a fixed loopback URL. There is no setting for a remote host.
* `trust_env=False` makes httpx ignore HTTP(S)_PROXY / ALL_PROXY variables, so a
  system proxy cannot silently forward source text somewhere else.
* Ollama cloud model tags (":cloud") are rejected.
"""

import os
from typing import TypeVar

import httpx
from dotenv import load_dotenv
from pydantic import BaseModel, ValidationError

load_dotenv()

OLLAMA_BASE_URL = "http://127.0.0.1:11434"
OLLAMA_API_URL = f"{OLLAMA_BASE_URL}/api/chat"
OLLAMA_TAGS_URL = f"{OLLAMA_BASE_URL}/api/tags"
DEFAULT_OLLAMA_MODEL = "qwen3.5:4b"
CONNECT_TIMEOUT_SECONDS = 3.0
READ_TIMEOUT_SECONDS = 180.0
STATUS_TIMEOUT_SECONDS = 3.0
# One automatic retry for a malformed structured response. Small local models
# occasionally return invalid JSON; a second attempt often succeeds.
MAX_GENERATION_ATTEMPTS = 2

ModelT = TypeVar("ModelT", bound=BaseModel)


class OllamaUnavailableError(RuntimeError):
    """Raised when the local Ollama service or configured model is unavailable."""


class OllamaGenerationError(RuntimeError):
    """Raised when Ollama returns an unusable structured response."""


def configured_model() -> str:
    return os.getenv("OLLAMA_MODEL", DEFAULT_OLLAMA_MODEL).strip() or DEFAULT_OLLAMA_MODEL


def _local_client() -> httpx.Client:
    # trust_env=False: never route loopback traffic through a configured proxy.
    return httpx.Client(trust_env=False)


def check_ollama_status(*, client=None) -> dict:
    """Report whether local Ollama is reachable and the configured model is installed.

    Only contacts loopback. Returns a plain dict the UI can show; never raises.
    """
    model_name = configured_model()
    status = {"reachable": False, "model": model_name, "model_installed": False, "message": ""}
    if model_name.casefold().endswith(":cloud"):
        status["message"] = "Cloud model tags are disabled. Set OLLAMA_MODEL to a model downloaded for local use."
        return status

    owns_client = client is None
    http = client or _local_client()
    try:
        response = http.get(OLLAMA_TAGS_URL, timeout=httpx.Timeout(STATUS_TIMEOUT_SECONDS))
        payload = response.json()
    except (httpx.RequestError, ValueError):
        status["message"] = "Ollama is not running. Open the Ollama app on this Mac, then check again."
        return status
    finally:
        if owns_client:
            http.close()

    status["reachable"] = True
    try:
        installed = {str(item.get("name", "")).casefold() for item in payload.get("models", [])}
    except AttributeError:
        installed = set()
    # Ollama lists untagged pulls as "name:latest".
    wanted = model_name.casefold()
    status["model_installed"] = wanted in installed or (":" not in wanted and f"{wanted}:latest" in installed)
    status["message"] = (
        "Local AI is ready."
        if status["model_installed"]
        else f"Ollama is running, but the model '{model_name}' is not installed. In Terminal, run: ollama pull {model_name}"
    )
    return status


def generate_structured(
    response_model: type[ModelT],
    messages: list[dict[str, str]],
    *,
    max_output_tokens: int,
    client=None,
) -> ModelT:
    """Call Ollama on loopback and validate its JSON response against a Pydantic model.

    `client` is injectable so unit tests can provide a fake HTTP transport.
    """
    model_name = configured_model()
    if model_name.casefold().endswith(":cloud"):
        raise OllamaUnavailableError(
            "Cloud model tags are disabled. Set OLLAMA_MODEL to a model downloaded for local use."
        )

    owns_client = client is None
    http = client or _local_client()
    try:
        last_error: OllamaGenerationError | None = None
        for _attempt in range(MAX_GENERATION_ATTEMPTS):
            try:
                return _generate_once(http, response_model, messages, model_name, max_output_tokens)
            except OllamaGenerationError as exc:
                last_error = exc
        assert last_error is not None
        raise last_error
    finally:
        if owns_client:
            http.close()


def _generate_once(http, response_model: type[ModelT], messages, model_name: str, max_output_tokens: int) -> ModelT:
    try:
        response = http.post(
            OLLAMA_API_URL,
            json={
                "model": model_name,
                "messages": messages,
                "stream": False,
                "think": False,
                "format": response_model.model_json_schema(),
                "options": {"temperature": 0.2, "num_predict": max_output_tokens},
            },
            timeout=httpx.Timeout(READ_TIMEOUT_SECONDS, connect=CONNECT_TIMEOUT_SECONDS),
        )
    except (httpx.ConnectError, httpx.ConnectTimeout) as exc:
        raise OllamaUnavailableError(
            "Ollama is not responding on this Mac. Open the Ollama app, then retry."
        ) from exc
    except httpx.ReadTimeout as exc:
        # Ollama is running but too slow, usually because the model is still loading
        # or the Mac is short on memory. This is different from "not running".
        raise OllamaUnavailableError(
            f"The local model took longer than {int(READ_TIMEOUT_SECONDS)} seconds. It may still be loading "
            "or the Mac may be low on memory. Wait a moment and retry, or choose fewer pages."
        ) from exc
    except httpx.RequestError as exc:
        raise OllamaUnavailableError(
            "Could not connect to local Ollama. Check that the Ollama app is running, then retry."
        ) from exc

    try:
        payload = response.json()
    except (ValueError, TypeError) as exc:
        raise OllamaGenerationError("Ollama returned an unreadable response. Please try again.") from exc

    error_message = str(payload.get("error", "")) if isinstance(payload, dict) else ""
    if response.status_code == 404 or ("model" in error_message.casefold() and "not found" in error_message.casefold()):
        raise OllamaUnavailableError(
            f"The Ollama model '{model_name}' is not installed. In Terminal, run: ollama pull {model_name}"
        )
    if response.status_code >= 400 or error_message:
        raise OllamaGenerationError("Ollama could not complete the request. Check Ollama and try again.")

    try:
        content = payload["message"]["content"]
        return response_model.model_validate_json(content)
    except (KeyError, TypeError, ValidationError, ValueError) as exc:
        raise OllamaGenerationError(
            "Ollama returned content that did not match the expected response format. Please try again."
        ) from exc
