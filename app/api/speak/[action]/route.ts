import { env } from 'cloudflare:workers';
import { handleSpeakRequest } from '../../../../server/speak-service.mjs';
export const dynamic = 'force-dynamic';
function handle(request: Request) {
  return handleSpeakRequest(request, env, {
    authenticatedUserId: request.headers.get('oai-authenticated-user-id') || null,
  });
}
export const GET = handle;
export const POST = handle;
