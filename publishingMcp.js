const fs = require('node:fs');
const path = require('node:path');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { z } = require('zod');

// This adapter shares the publisher's listener, validation, receipts and bot.
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
