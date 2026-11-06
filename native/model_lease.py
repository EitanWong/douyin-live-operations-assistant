"""A process-safe model owner, with live speech preferred over background work."""
import fcntl
import json
import os
from pathlib import Path
import tempfile
import time


class ModelLease:
    def __init__(self, folder, now=None):
        self.folder = Path(folder).resolve()
        self.now = now or (lambda: int(time.time()*1000))
        self.fd = None
        self.priority = None

    def live_pending(self):
        try:
            at = json.loads((self.folder / '.asr-live-request.json').read_text())['at']
            return type(at) is int and 0 <= self.now()-at < 30000
        except (OSError, ValueError, KeyError, TypeError):
            return False

    def request_live(self):
        fd, name = tempfile.mkstemp(prefix='.asr-request-', dir=self.folder)
        try:
            with os.fdopen(fd, 'w') as stream:
                json.dump({'at': self.now()}, stream)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(name, self.folder / '.asr-live-request.json')
        finally:
            Path(name).unlink(missing_ok=True)

    def acquire(self, priority):
        if priority not in ('live', 'background'):
            raise ValueError('ASR_PRIORITY')
        if self.fd is not None:
            if self.priority != priority:
                raise ValueError('ASR_PRIORITY')
            return
        self.folder.mkdir(parents=True, exist_ok=True, mode=0o700)
        if priority == 'live':
            self.request_live()
        elif self.live_pending():
            raise ValueError('ASR_BUSY')
        fd = os.open(self.folder / '.asr-runtime.lock', os.O_CREAT | os.O_RDWR, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            if priority == 'background' and self.live_pending():
                raise ValueError('ASR_BUSY')
        except (BlockingIOError, ValueError):
            os.close(fd)
            raise ValueError('ASR_BUSY') from None
        except BaseException:
            os.close(fd)
            raise
        self.fd, self.priority = fd, priority
        if priority == 'live':
            (self.folder / '.asr-live-request.json').unlink(missing_ok=True)

    def preempted(self):
        return self.fd is not None and self.priority == 'background' and self.live_pending()

    def close(self):
        if self.fd is not None:
            os.close(self.fd)
            self.fd = self.priority = None
