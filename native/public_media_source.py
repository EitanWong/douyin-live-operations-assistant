"""Short-lived, page-attributed CDN media downloaded with the existing HTTPX."""
import asyncio
from dataclasses import dataclass
from pathlib import Path
import re
from urllib.parse import parse_qs, urlsplit

MAX_DURATION_MS = 3 * 3600000
MAX_MEDIA_BYTES = 256 * 1024 * 1024
SOURCE_TTL_MS = 300000


@dataclass(frozen=True)
class DownloadedMedia:
    path: Path
    duration_ms: int


def validate_media_source(value, job, now):
    keys = {'workId', 'author', 'authorUid', 'url', 'durationMs', 'observedAt', 'expiresAt'}
    if (not isinstance(value, dict) or set(value) != keys or value['workId'] != job['workId'] or value['author'] != job['author']
            or not isinstance(value['author'], str) or not re.fullmatch(r'[A-Za-z0-9_-]{8,160}', value['author'])
            or value['authorUid'] is not None and (not isinstance(value['authorUid'], str) or not re.fullmatch(r'[0-9]{1,30}', value['authorUid']))
            or job['subject'].startswith('uid:') and value['authorUid'] != job['subject'][4:]
            or job['subject'].startswith('sec:') and value['author'] != job['subject'][4:]
            or any(type(value[k]) is not int for k in ('durationMs', 'observedAt', 'expiresAt'))
            or not 0 < value['durationMs'] <= MAX_DURATION_MS
            or not job.get('epoch', 0) < value['observedAt'] <= now < value['expiresAt'] < 2**53
            or not 0 < value['expiresAt']-value['observedAt'] <= SOURCE_TTL_MS
            or not isinstance(value['url'], str) or len(value['url']) > 2000 or re.search(r'\s', value['url'])):
        raise ValueError('MEDIA_SOURCE')
    try:
        url = urlsplit(value['url'])
        if (url.scheme != 'https' or not re.fullmatch(r'(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+douyinvod\.com', url.hostname or '')
                or url.username or url.password or url.port not in (None, 443) or url.fragment
                or parse_qs(url.query, keep_blank_values=True).get('__vid') != [value['workId']]):
            raise ValueError('MEDIA_SOURCE')
    except (ValueError, TypeError):
        raise ValueError('MEDIA_SOURCE') from None
    return dict(value)


async def download_page_media(source, folder, *, transport=None):
    import httpx
    path = folder/'page-media.mp4'
    try:
        async with asyncio.timeout(180), httpx.AsyncClient(transport=transport, follow_redirects=False, trust_env=False,
                timeout=httpx.Timeout(15), headers={'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.douyin.com/', 'Accept-Encoding': 'identity'}) as client:
            async with client.stream('GET', source['url']) as response:
                length = response.headers.get('content-length')
                expected = int(length) if length and re.fullmatch(r'[0-9]{1,12}', length) else None
                if (response.status_code != 200 or response.headers.get('content-type', '').split(';')[0].strip() not in ('video/mp4', 'application/octet-stream')
                        or length is not None and (expected is None or not 0 < expected <= MAX_MEDIA_BYTES)
                        or response.headers.get('content-encoding', 'identity') != 'identity'):
                    raise ValueError('MEDIA_DOWNLOAD_FAILED')
                size = 0
                with path.open('wb') as output:
                    async for block in response.aiter_bytes(65536):
                        size += len(block)
                        if size > MAX_MEDIA_BYTES:
                            raise ValueError('MEDIA_DOWNLOAD_FAILED')
                        output.write(block)
                if not size or expected is not None and size != expected:
                    raise ValueError('MEDIA_DOWNLOAD_FAILED')
        return DownloadedMedia(path, source['durationMs'])
    except BaseException as error:
        path.unlink(missing_ok=True)
        if isinstance(error, asyncio.CancelledError):
            raise
        if not isinstance(error, Exception):
            raise
        raise ValueError('MEDIA_DOWNLOAD_FAILED') from None
