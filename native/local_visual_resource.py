"""Ollama's documented unload handshake, owned by the native model lease.

Generic OpenAI-compatible servers remain usable by existing foreground clients;
background jobs require this lifecycle capability before starting inference.
"""
import json
import os
import re
from urllib.parse import urlsplit

MARKER = '.external-visual.json'


def resource_config(endpoint, model):
    try:
        url = urlsplit(endpoint)
        if (url.scheme not in ('http', 'https') or url.hostname not in ('localhost', '127.0.0.1', '::1')
                or url.username or url.password or url.query or url.fragment
                or (url.port is not None and not 1 <= url.port <= 65535)
                or url.path != '/v1/chat/completions'
                or not isinstance(model, str) or not 1 <= len(model) <= 200 or '\x00' in model):
            raise ValueError()
        return {'endpoint': endpoint, 'model': model}, f'{url.scheme}://{url.netloc}'
    except (ValueError, TypeError, AttributeError):
        raise ValueError('MEDIA_VISUAL_SERVICE') from None


def canonical(model):
    return model if ':' in model.rsplit('/', 1)[-1] else model+':latest'


def inference_body(body, model):
    if not isinstance(body, dict) or body.get('model') != model:
        raise ValueError()
    messages = body['messages']
    if (len(json.dumps(body)) > 100000 or len(messages) != 2 or body.get('stream') is not False
            or body.get('temperature') != 0 or body.get('max_tokens') != 160
            or messages[0]['role'] != 'system' or messages[1]['role'] != 'user'
            or not isinstance(messages[0]['content'], str) or len(messages[0]['content']) > 2000):
        raise ValueError()
    parts = messages[1]['content']
    if len(parts) != 2 or parts[0]['type'] != 'text' or not isinstance(parts[0]['text'], str) or len(parts[0]['text']) > 1000 or parts[1]['type'] != 'image_url':
        raise ValueError()
    image = parts[1]['image_url']['url']
    if not isinstance(image, str) or len(image) > 48023 or not re.fullmatch(r'data:image/jpeg;base64,[A-Za-z0-9+/]+=*', image):
        raise ValueError()
    return {'model':model, 'stream':False, 'think':False, 'keep_alive':0,
            'options':{'temperature':0, 'num_predict':160}, 'messages':[
                {'role':'system','content':messages[0]['content']},
                {'role':'user','content':parts[0]['text'],'images':[image.split(',',1)[1]]}]}


def completion(data):
    result = json.loads(data)
    text = result['message']['content']
    if result.get('done') is not True or not isinstance(text, str) or not text.strip() or len(text) > 1800:
        raise ValueError()
    return {'choices':[{'message':{'content':text}, 'finish_reason':result.get('done_reason')}]}


def verify_unloaded(reply, status, model):
    reply.raise_for_status()
    status.raise_for_status()
    value, loaded = reply.json(), status.json()
    if (not isinstance(value, dict) or not isinstance(loaded, dict)
            or value.get('done') is not True or value.get('done_reason') != 'unload'
            or not isinstance(loaded.get('models'), list)):
        raise ValueError('MEDIA_VISUAL_RELEASE')
    for row in loaded['models']:
        if not isinstance(row, dict):
            raise ValueError('MEDIA_VISUAL_RELEASE')
        names = [row[key] for key in ('name', 'model') if key in row]
        if not names or any(not isinstance(name, str) or not name or canonical(name) == canonical(model) for name in names):
            raise ValueError('MEDIA_VISUAL_RELEASE')


def recover_external_visual(folder):
    """Called with the OS lock held, before a replacement model can allocate."""
    marker = folder/MARKER
    if not marker.exists():
        return
    import httpx
    try:
        value, origin = resource_config(**json.loads(marker.read_text()))
        with httpx.Client(timeout=15, trust_env=False, follow_redirects=False) as client:
            reply = client.post(origin+'/api/generate', json={'model':value['model'], 'stream':False, 'keep_alive':0})
            verify_unloaded(reply, client.get(origin+'/api/ps'), value['model'])
        marker.unlink()
    except (OSError, ValueError, TypeError, httpx.HTTPError):
        raise ValueError('MEDIA_VISUAL_RELEASE') from None


class LocalVisualResource:
    def __init__(self, lease, transport=None):
        self.lease, self.transport, self.config = lease, transport, None

    async def prepare(self, endpoint, model):
        import httpx
        value, origin = resource_config(endpoint, model)
        if self.config is not None or self.lease.fd is None:
            raise ValueError('MEDIA_VISUAL_SERVICE')
        try:
            async with httpx.AsyncClient(timeout=5, trust_env=False, follow_redirects=False, transport=self.transport) as client:
                response = await client.get(origin+'/api/version')
                response.raise_for_status()
                version = response.json()
                if not isinstance(version, dict) or not re.fullmatch(r'\d+\.\d+\.\d+(?:[-+][\w.-]+)?', version.get('version', '')):
                    raise ValueError()
            # The durable fence survives native-host death. Never allocate another
            # local model until recovery has confirmed this external unload.
            marker = self.lease.folder/MARKER
            with marker.open('x') as stream:
                json.dump(value, stream)
                stream.flush()
                os.fsync(stream.fileno())
            self.config = value
        except (OSError, ValueError, TypeError, httpx.HTTPError):
            raise ValueError('MEDIA_VISUAL_SERVICE') from None

    async def infer(self, body):
        import httpx
        try:
            if self.config is None:
                raise ValueError()
            native = inference_body(body, self.config['model'])
            _, origin = resource_config(**self.config)
            async with httpx.AsyncClient(timeout=20, trust_env=False, follow_redirects=False, transport=self.transport) as client:
                async with client.stream('POST', origin+'/api/chat', json=native) as response:
                    response.raise_for_status()
                    data = bytearray()
                    async for chunk in response.aiter_bytes():
                        data.extend(chunk)
                        if len(data) > 1000000:
                            raise ValueError()
            return completion(data)
        except (ValueError, TypeError, KeyError, IndexError, httpx.HTTPError):
            raise ValueError('MEDIA_VISUAL_FAILED') from None

    async def release(self):
        if self.config is None:
            return
        import httpx
        value, origin = resource_config(**self.config)
        try:
            async with httpx.AsyncClient(timeout=15, trust_env=False, follow_redirects=False, transport=self.transport) as client:
                reply = await client.post(origin+'/api/generate', json={'model':value['model'], 'stream':False, 'keep_alive':0})
                verify_unloaded(reply, await client.get(origin+'/api/ps'), value['model'])
            (self.lease.folder/MARKER).unlink()
            self.config = None
        except (OSError, ValueError, TypeError, httpx.HTTPError):
            raise ValueError('MEDIA_VISUAL_RELEASE') from None
