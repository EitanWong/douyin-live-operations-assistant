"""Bounded media subprocesses with cancellation and pipe cleanup."""
import asyncio
import os
import signal


async def reap(process):
    def signal_group(value):
        try:
            os.killpg(process.pid, value)
        except ProcessLookupError:
            pass
    async def drain(stream):
        while await stream.read(65536):
            pass
    # Readers must be joined before this function. Drain even when the child
    # already exited: unread pipes otherwise retain transports after loop close.
    signal_group(signal.SIGTERM)
    tasks = [asyncio.create_task(drain(stream)) for stream in (process.stdout, process.stderr)]
    tasks.append(asyncio.create_task(process.wait()))
    _, pending = await asyncio.wait(tasks, timeout=2)
    if pending:
        signal_group(signal.SIGKILL)
    await asyncio.gather(*tasks)


async def bounded_read(stream, maximum):
    result = bytearray()
    while True:
        block = await stream.read(min(65536, maximum+1-len(result)))
        if not block:
            return bytes(result)
        result.extend(block)
        if len(result) > maximum:
            raise ValueError('MEDIA_DOWNLOAD_FAILED')


async def run_capture(args, timeout=180, maximum=2*1024*1024, stdout_reader=None):
    process = await asyncio.create_subprocess_exec(*args, stdin=asyncio.subprocess.DEVNULL,
                                                  stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
                                                  start_new_session=True)
    tasks = [asyncio.create_task(stdout_reader(process.stdout) if stdout_reader else bounded_read(process.stdout, maximum)),
             asyncio.create_task(bounded_read(process.stderr, 131072))]
    try:
        async with asyncio.timeout(timeout):
            stdout, stderr = await asyncio.gather(*tasks)
            if await process.wait() != 0:
                raise ValueError('MEDIA_DOWNLOAD_FAILED')
            return stdout, stderr
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await reap(process)


async def run_bounded(args, timeout=180, maximum=2*1024*1024):
    stdout, _ = await run_capture(args, timeout=timeout, maximum=maximum)
    return stdout
