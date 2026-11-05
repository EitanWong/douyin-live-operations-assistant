"""Ask the bound live document for fresh URLs, then fall back to StreamGet."""
import asyncio
import uuid

from resolver import media_url


class StreamSource:
    def __init__(self, emit, fallback, timeout=12):
        self.emit, self.fallback, self.timeout = emit, fallback, timeout
        self.pending = {}

    def receive(self, message):
        entry = self.pending.get(message.get('id'))
        if not entry:
            return
        room, future = entry
        if future.done() or message.get('room') != room:
            return
        rows = message.get('candidates')
        try:
            valid = (isinstance(rows, list) and 0 < len(rows) <= 12
                     and all(isinstance(row, dict) and media_url(row.get('url')) for row in rows))
        except (ValueError, TypeError):
            valid = False
        future.set_result([{'url': row['url']} for row in rows] if valid else [])

    async def resolve(self, room):
        request = uuid.uuid4().hex
        future = asyncio.get_running_loop().create_future()
        self.pending[request] = (room, future)
        try:
            self.emit({'type': 'stream-request', 'id': request, 'room': room})
            try:
                rows = await asyncio.wait_for(future, self.timeout)
            except asyncio.TimeoutError:
                rows = []
        finally:
            self.pending.pop(request, None)
            if not future.done():
                future.cancel()
        return rows or await self.fallback(room)
