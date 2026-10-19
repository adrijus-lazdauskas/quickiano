"""Job backend on Modal: every conversion is a spawned function call in its own container.

Kept free of `import modal` so it can be tested without Modal; modal_app.py passes in
the real calls. Modal keeps a call's result for a while, so polling is just asking
the call for its output without waiting.
"""

from collections.abc import Awaitable, Callable
from typing import Any, Literal

from api import NotFinished, Unknown

UNEXPECTED = "The conversion failed unexpectedly. Please try again."

Kind = Literal["running", "expired", "failed"]


class ModalBackend:
    def __init__(
        self,
        submit: Callable[[bytes, int], Awaitable[str]],
        poll: Callable[[str], Awaitable[dict[str, Any]]],
        stop: Callable[[str], Awaitable[None]],
        classify: Callable[[Exception], Kind],
    ) -> None:
        self._submit = submit
        self._poll = poll
        self._stop = stop
        self._classify = classify

    def health(self) -> dict:
        return {"busy": False, "waiting": 0}

    async def submit(self, pdf: bytes, pages: int) -> str:
        return await self._submit(pdf, pages)

    async def _output(self, job_id: str) -> dict[str, Any] | None:
        """The function's return value, or None while it still runs."""
        try:
            return await self._poll(job_id)
        except Exception as e:
            kind = self._classify(e)
            if kind == "running":
                return None
            if kind == "expired":
                raise Unknown()
            return {"ok": False, "error": UNEXPECTED}

    async def status(self, job_id: str) -> dict:
        out = await self._output(job_id)
        if out is None:
            return {"status": "running"}
        if out.get("ok"):
            return {"status": "done"}
        return {"status": "failed", "error": out.get("error") or UNEXPECTED}

    async def result(self, job_id: str) -> tuple[bytes, int, int, int]:
        out = await self._output(job_id)
        if out is None or not out.get("ok"):
            raise NotFinished()
        return out["mxl"], out["pages"], out["movements"], out["seconds"]

    async def cancel(self, job_id: str) -> None:
        try:
            await self._stop(job_id)
        except Exception:
            pass  # already finished or gone
