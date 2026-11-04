const fs = require('node:fs');
const path = require('node:path');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { z } = require('zod');

// This adapter shares the publisher's listener, validation, receipts and bot.
const ARTWORK_STAGER_HTML = "<!doctype html><html><head><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><style>body{font:15px system-ui;padding:16px;max-width:520px;margin:auto}button,input{padding:12px;margin:8px 0;width:100%;box-sizing:border-box}button{cursor:pointer}#status{white-space:pre-wrap}</style></head><body><h3>Stage Telegram artwork</h3><p>Select a PNG or JPEG. Staging does not publish anything.</p><input id=\"file\" type=\"file\" accept=\"image/png,image/jpeg\"><button id=\"library\">Choose from ChatGPT Library</button><button id=\"stage\">Stage selected image</button><p id=\"status\" role=\"status\">No image selected.</p><script>\nlet chosen=null;\nconst status=document.getElementById('status');\ndocument.getElementById('file').onchange=e=>{chosen=e.target.files[0];status.textContent=chosen?.name||'No image selected';};\ndocument.getElementById('library').onclick=async()=>{\n try {\n  if(!window.openai?.selectFiles||!window.openai?.getFileDownloadUrl)throw Error('Library picker is unavailable on this device');\n  const files=await window.openai.selectFiles();if(!files?.length)return;\n  const f=files[0];if(!/^image\\/(png|jpeg)$/.test(f.mimeType))throw Error('Choose a PNG or JPEG');\n  const link=await window.openai.getFileDownloadUrl({fileId:f.fileId});\n  const response=await fetch(link.downloadUrl);if(!response.ok)throw Error('Could not read selected file');\n  chosen=new File([await response.blob()],f.fileName,{type:f.mimeType});status.textContent=chosen.name;\n }catch(e){status.textContent=e.message;}\n};\ndocument.getElementById('stage').onclick=async()=>{\n try{\n  if(!chosen)throw Error('Select an image first');\n  if(!window.openai?.callTool)throw Error('ChatGPT tool bridge unavailable');\n  if(chosen.size>5*1024*1024)throw Error('Image must be 5 MiB or smaller');\n  const bytes=new Uint8Array(await chosen.arrayBuffer());\n  if(!(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)&&!(bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71))throw Error('Invalid image');\n  const digest=await crypto.subtle.digest('SHA-256',bytes);\n  const sha256=Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,'0')).join('');\n  const id='art_'+crypto.randomUUID().replaceAll('-','');\n  const maxBytes=196608;\n  const count=Math.ceil(bytes.length/maxBytes);\n  for(let i=0;i<count;i++){\n   const part=bytes.subarray(i*maxBytes,(i+1)*maxBytes);\n   let binary='';for(let j=0;j<part.length;j+=8192)binary+=String.fromCharCode(...part.subarray(j,j+8192));\n   const result=await window.openai.callTool('upload_image_chunk',{upload_id:id,chunk_index:i,chunk_count:count,sha256,chunk_base64:btoa(binary)});\n   if(result.isError)throw Error('Upload chunk '+(i+1)+' failed');\n   status.textContent='Staging image: '+(i+1)+' / '+count;\n  }\n  status.textContent='Image staged. Upload ID: '+id+'\\nReturn to the chat and ask to publish using this ID.';\n  if(window.openai.sendFollowUpMessage)await window.openai.sendFollowUpMessage({prompt:'The Telegram image was staged with image_upload_id '+id+'. Do not publish until I explicitly approve the final message.'});\n }catch(e){status.textContent='Error: '+e.message;}\n};\n</script></body></html>";

function createMcpHandler({ destinations, dir, publish, uploads }) {
  return async (req, res, body) => {
    if (req.method !== 'POST') {
      res.writeHead(405, { Allow: 'POST', 'Cache-Control': 'no-store' });
      return res.end();
    }
    const server = new McpServer({ name: 'minibeany-telegram-publisher', version: '0.2.2' }, {
      instructions: 'Publish only when the user explicitly instructs sending the final text and graphic to the selected destination. Drafting, editing, connecting and testing do not authorize a send. List destinations first. Keep the same request ID and payload on retries. On uncertain delivery check the receipt and Telegram; never automatically use a new ID. No startup or connection test should publish a message.',
    });
    const result = (data, isError = false) => ({ content: [{ type: 'text', text: JSON.stringify(data) }], isError });
    const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
    server.registerResource('artwork-stager', 'ui://minibeany/artwork-stager', { mimeType: 'text/html;profile=mcp-app' }, async () => ({ contents: [{ uri: 'ui://minibeany/artwork-stager', mimeType: 'text/html;profile=mcp-app', text: ARTWORK_STAGER_HTML }] }));
    server.registerTool('stage_artwork_ui', { description: 'Open an in-ChatGPT image picker to stage PNG/JPEG artwork for a later explicitly approved Telegram announcement. Does not publish.', inputSchema: {}, annotations: readOnly, _meta: { ui: { resourceUri: 'ui://minibeany/artwork-stager' } } }, async () => result({ message: 'Choose artwork in the image picker. Staging never publishes.' }));
    server.registerTool('list_destinations', {
      description: 'Read the configured Telegram destination aliases. Does not publish.',
      inputSchema: {}, annotations: readOnly,
    }, async () => result({ destinations: Object.keys(destinations) }));
    server.registerTool('get_publish_receipt', {
      description: 'Read a delivery receipt without sending. Pending means delivery may have occurred: check Telegram; never automatically use a new request ID.',
      inputSchema: { request_id: z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/) }, annotations: readOnly,
    }, async ({ request_id }) => {
      try {
        const { hash, ...receipt } = JSON.parse(fs.readFileSync(path.join(dir, `${request_id}.json`), 'utf8'));
        return result({ request_id, ...receipt });
      } catch (error) {
        return result({ request_id, status: error.code === 'ENOENT' ? 'not_found' : 'unavailable' }, error.code !== 'ENOENT');
      }
    });
    server.registerTool('upload_image_chunk', {
      description: 'Stage exact PNG/JPEG bytes in small base64 chunks. Does NOT send to Telegram. Use code to read and encode the file, never print or manually transcribe base64. After ready, publish using image_upload_id. Maximum 5 MiB; chunks expire after 24 hours.',
      inputSchema: {
        upload_id: z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/),
        chunk_index: z.number().int().min(0),
        chunk_count: z.number().int().min(1).max(27),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        chunk_base64: z.string().min(4).max(262144).describe('256 KiB base64 characters per chunk except the final chunk; encode exact file bytes programmatically.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async input => {
      try { return result(uploads.stage(input)); }
      catch (error) { return result({ error: error.message }, true); }
    });
    server.registerTool('publish_announcement', {
      description: 'SEND an approved announcement to Telegram. Call ONLY after the user explicitly instructs publishing the final text, graphic and destination. Drafting or creating graphics is not permission. Upload PNG/JPEG bytes as base64, never a URL. Reuse the exact request ID/content on retries. On uncertainty read the receipt and check Telegram; never automatically create a new ID.',
      inputSchema: {
        request_id: z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/),
        destination: z.enum(Object.keys(destinations)),
        text: z.string().min(1).describe('Final approved plain text, at most 4096 code points or 1024 with a photo.'),
        image_upload_id: z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/).optional().describe('Ready upload_id from upload_image_chunk; preferred for photos. Do not also pass image_base64.'),
        image_base64: z.string().max(6990508).optional().describe('Optional exact approved PNG/JPEG bytes, base64, at most 5 MiB decoded.'),
        user_instructed_publish: z.literal(true).describe('True only when the user explicitly asked to send this final announcement to this destination.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    }, async ({ user_instructed_publish, ...input }) => {
      try { return await publish(input, (status, data) => result(data, status >= 400)); }
      catch { return result({ status: 'uncertain', request_id: input.request_id, error: 'Check the receipt and Telegram before any further send.' }, true); }
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.setHeader('Cache-Control', 'no-store');
    res.on('close', () => { void transport.close(); void server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  };
}
module.exports = { createMcpHandler };
