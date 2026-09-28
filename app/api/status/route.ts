import { resolveStreamSource, streamStatus } from '../../lib/stream-source.mjs';
export const dynamic = 'force-dynamic';
export async function GET() {
  const status = streamStatus();
  const sourceErrors: Record<string, string> = {};
  for (const source of ['camera', 'mediamtx']) {
    try { resolveStreamSource(source); } catch (error) {
      sourceErrors[source] = error instanceof Error ? error.message : 'Invalid stream configuration';
    }
  }
  return Response.json({...status, sourceErrors, version: '1.2.0', transport: 'MPEG-TS over HTTP', video: 'H.265', audio: false, player: 'hevc-player'}, {headers:{'Cache-Control':'no-store'}});
}
