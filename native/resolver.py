"""StreamGet adapter. Separate process keeps dependency output away from native framing."""
import asyncio
import contextlib
import functools
import io
import json
import os
import re
import sys
from urllib.parse import urlsplit


def canonical_room(room):
    if not isinstance(room, str) or not re.fullmatch(r'[0-9]{1,24}', room):
        raise ValueError('INVALID')
    return f'https://live.douyin.com/{room}'


def media_url(value):
    if not isinstance(value, str) or len(value) > 16000 or '\r' in value or '\n' in value:
        return False
    u = urlsplit(value)
    domains = ('douyincdn.com', 'douyincdn.com.cn', 'douyin.com', 'bytecdn.cn', 'bytedance.com', 'bytecdn.com', 'bytefcdn.com', 'ibytedtos.com', 'volccdn.com')
    return (u.scheme == 'https' and not u.username and not u.password and not u.port and not u.fragment
            and any(u.hostname == d or (u.hostname or '').endswith('.' + d) for d in domains)
            and bool(re.search(r'\.(flv|m3u8)$', u.path, re.I)))


def candidates(data):
    if data.get('status') != 2:
        raise ValueError('RESOLVE_FAILED')
    stream = data.get('stream_url', data.get('streamUrl', {}))
    rows = []
    for fmt, names in [('flv', ['flv_pull_url', 'flvPullUrl']), ('hls', ['hls_pull_url_map', 'hlsPullUrlMap'])]:
        mapping = next((stream[n] for n in names if isinstance(stream.get(n), dict)), {})
        for quality, url in mapping.items():
            if media_url(url):
                rows.append({'url': url, 'format': fmt, 'quality': str(quality)[:40]})
    direct_hls = stream.get('hls_pull_url', stream.get('hlsPullUrl'))
    if media_url(direct_hls):
        rows.append({'url': direct_hls, 'format': 'hls', 'quality': 'origin'})
    core = stream.get('live_core_sdk_data', stream.get('liveCoreSdkData', {}))
    pull = core.get('pull_data', core.get('pullData', {}))
    sdk = pull.get('stream_data', pull.get('streamData', '{}'))
    try:
        sdk = json.loads(sdk) if isinstance(sdk, str) else sdk
        for quality, value in sdk.get('data', {}).items():
            main = value.get('main', {})
            params = main.get('sdk_params', {})
            params = json.loads(params) if isinstance(params, str) else params
            codec = str(params.get('VCodec', '')).lower()
            for fmt in ['flv', 'hls']:
                if media_url(main.get(fmt)):
                    rows.append({'url': main[fmt], 'format': fmt, 'quality': quality, 'codec': codec})
    except (ValueError, TypeError, AttributeError):
        pass
    priority = {'sd': 0, 'hd': 1, 'ld': 2, 'uhd': 3, 'origin': 4, 'od': 4}
    rows.sort(key=lambda r: (r.get('codec') in ['hevc', 'h265', 'av1'], priority.get(r['quality'].lower(), 5), r['format'] != 'flv'))
    unique = {}
    for row in rows:
        unique.setdefault(row['url'], row)
    if not unique:
        raise ValueError('RESOLVE_FAILED')
    return list(unique.values())[:12]


def room_payload(payload, room):
    if payload.get('status_code') != 0:
        raise ValueError('RESOLVE_FAILED')
    rows = payload.get('data', {}).get('data')
    if not isinstance(rows, list) or not rows or not isinstance(rows[0], dict):
        raise ValueError('RESOLVE_FAILED')
    data = rows[0]
    if str(data.get('web_rid', data.get('webRid', room))) != room:
        raise ValueError('RESOLVE_FAILED')
    return data


async def resolve(room):
    from streamget import DouyinLiveStream
    import streamget.platforms.douyin.live_stream as module
    # StreamGet defaults verify=False. Enforce TLS on this actual request boundary.
    module.async_req = functools.partial(module.async_req, verify=True)
    live = DouyinLiveStream(cookies=os.environ.get('DOUYIN_STREAM_COOKIES') or None)
    payload = await live.fetch_web_stream_data(canonical_room(room), process_data=False)
    # Do not use fetch_stream_url: its HEAD status truthiness accepts 403/404.
    return candidates(room_payload(payload, room))


if __name__ == '__main__':
    try:
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            result = asyncio.run(asyncio.wait_for(resolve(sys.argv[1]), 18))
        print(json.dumps({'candidates': result}))
    except Exception:
        print(json.dumps({'error': 'RESOLVE_FAILED'}))
        sys.exit(1)
