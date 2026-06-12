import asyncio
import os
import threading
from typing import Callable, List, Optional

from app.logger import INFO


def _get_image_generation_concurrency() -> int:
    try:
        return max(1, int(os.getenv("IMAGE_GENERATION_CONCURRENCY", "3")))
    except ValueError:
        return 3


IMAGE_GENERATION_CONCURRENCY = _get_image_generation_concurrency()
IMAGE_GENERATION_SEMAPHORE = threading.BoundedSemaphore(IMAGE_GENERATION_CONCURRENCY)


async def _acquire_image_generation_slot():
    while True:
        if IMAGE_GENERATION_SEMAPHORE.acquire(blocking=False):
            return
        await asyncio.sleep(0.1)


async def run_limited_image_generation(
        image_generation: Callable[..., List[str]],
        *,
        prompt: str,
        model: str,
        reference_images: Optional[List[str]] = None,
        size: Optional[str] = None,
) -> List[str]:
    await _acquire_image_generation_slot()
    try:
        INFO(
            f"image generation slot acquired, "
            f"global_concurrency={IMAGE_GENERATION_CONCURRENCY}, "
            f"reference_images_count={len(reference_images or [])}, "
            f"size={size or 'default'}"
        )
        thread_task = asyncio.create_task(
            asyncio.to_thread(
                image_generation,
                prompt=prompt,
                model=model,
                reference_images=reference_images,
                size=size,
            )
        )
        try:
            return await asyncio.shield(thread_task)
        except asyncio.CancelledError:
            INFO("image generation coroutine canceled, waiting for in-flight image request before releasing slot")
            try:
                await thread_task
            finally:
                raise
    finally:
        IMAGE_GENERATION_SEMAPHORE.release()
