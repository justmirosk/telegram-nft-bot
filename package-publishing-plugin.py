"""Verify a deployed MCP endpoint read-only, then package the private plugin.

Usage: PUBLISH_API_KEY=<from secure environment> python3 package-publishing-plugin.py https://verified-host/mcp
No credentials are written to the archive or printed.
"""
import json
import os
from pathlib import Path
import sys
import urllib.request
from urllib.parse import urlsplit
import zipfile

endpoint = sys.argv[1]
url = urlsplit(endpoint)
if url.scheme != 'https' or not url.hostname or url.username or url.password or url.query or url.fragment or url.path != '/mcp':
    raise SystemExit('Expected the verified HTTPS service endpoint ending in /mcp')
key = os.environ.get('PUBLISH_API_KEY', '')
if len(key) < 32:
    raise SystemExit('Provide PUBLISH_API_KEY through the secure environment; never paste it into chat')

# Do not follow redirects with an Authorization header.
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

opener = urllib.request.build_opener(NoRedirect)
def rpc(method, params, identifier):
    payload = json.dumps({'jsonrpc': '2.0', 'id': identifier, 'method': method, 'params': params}).encode()
    request = urllib.request.Request(endpoint, data=payload, headers={
        'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-03-26'})
    with opener.open(request, timeout=20) as response:
        data = json.load(response)
    if 'error' in data:
        raise SystemExit('MCP verification failed')
    return data['result']

rpc('initialize', {'protocolVersion': '2025-03-26', 'capabilities': {}, 'clientInfo': {'name': 'private-plugin-packager', 'version': '0.1.0'}}, 1)
tools = rpc('tools/list', {}, 2)['tools']
if {tool['name'] for tool in tools} != {'list_destinations', 'get_publish_receipt', 'publish_announcement'}:
    raise SystemExit('Unexpected MCP tools; inspect the service before packaging')
send = next(tool for tool in tools if tool['name'] == 'publish_announcement')
if send.get('annotations', {}).get('readOnlyHint') is not False:
    raise SystemExit('Publishing must be declared as a write action')

root = Path(__file__).resolve().parent
source = root / 'plugins' / 'minibeany-telegram-publisher'
config = {'$schema': 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json', 'mcpServers': {
    'minibeany-publisher': {'type': 'streamable-http', 'url': endpoint, 'extensions': {'com.openai': {
        'auth': {'type': 'api_key', 'headerScheme': 'bearer'}}}}}}
archive = root / 'minibeany-telegram-publisher.zip'
manifest = json.loads((source / 'plugin.json').read_text())
assert len(manifest['extensions']['com.openai']['interface']['shortDescription']) <= 30
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as output:
    for file in sorted(source.rglob('*')):
        if file.is_file():
            output.writestr(str(file.relative_to(source)), file.read_bytes())
    output.writestr('mcp.json', json.dumps(config, indent=2) + '\n')
with zipfile.ZipFile(archive) as output:
    assert set(output.namelist()) == {'plugin.json', 'mcp.json', 'skills/telegram-publishing/SKILL.md'}
    assert output.testzip() is None
print('Verified read-only MCP discovery; created', archive)
