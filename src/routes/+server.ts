import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { WebhookEventSchema } from '$lib/schemas/webhook-event';
import pkg from '../../package.json' with { type: 'json' };

const PLEX_UA_PREFIX = 'PlexMediaServer';
const LISTENBRAINZ_API_ROOT = 'https://api.listenbrainz.org/1';

export const POST: RequestHandler = async ({ fetch, request, url: { searchParams } }) => {
	// check that the request is coming from a Plex Server
	if (!request.headers.get('user-agent')?.startsWith(PLEX_UA_PREFIX)) {
		error(403, 'Invalid User-Agent');
	}

	// we previously used `id` as the token param, so fall back to that if it's present
	const token = searchParams.get('token') ?? searchParams.get('id');

	// exit early if we're missing a ListenBrainz token, as we can't do anything without it
	if (!token) {
		error(401, 'Missing token');
	}

	const rawPayload = (await request.formData()).get('payload');

	if (!rawPayload) {
		error(400, 'Missing payload');
	}

	// WebhookEventSchema should filter out events we don't want, as well as malformed payloads
	const payload = WebhookEventSchema.safeParse(JSON.parse(rawPayload.toString()));

	if (!payload.success) {
		return new Response(undefined, { status: 204, statusText: 'Unprocessable event' });
	}

	// The event came from a user that doesn't match the provided filter
	if (searchParams.get('user')?.toLowerCase() !== payload.data.Account.title.toLowerCase()) {
		return new Response(undefined, { status: 204, statusText: 'User mismatch' });
	}

	const ignoredLibraries = searchParams
		.get('ignore')
		?.split(',')
		.map((s) => s.trim());

	// The event came from a library section that we've been told to ignore
	if (
		!!payload.data.Metadata.librarySectionTitle &&
		ignoredLibraries?.includes(payload.data.Metadata.librarySectionTitle)
	) {
		return new Response(undefined, { status: 204, statusText: 'Ignored library section' });
	}

	const isScrobble = payload.data.event === 'media.scrobble';
	const track_mbid = payload.data.Metadata.Guid?.find((guid) =>
		guid.id.startsWith('mbid')
	)?.id.replace('mbid://', '');

	return fetch(`${LISTENBRAINZ_API_ROOT}/submit-listens`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Token ${token}`
		},
		body: JSON.stringify({
			listen_type: isScrobble ? 'single' : 'playing_now',
			payload: [
				{
					...(isScrobble ? { listened_at: Math.floor(Date.now() / 1000) } : {}),
					track_metadata: {
						additional_info: {
							listening_from: 'Plex',
							media_player: 'Plex',
							submission_client: pkg.name,
							submission_client_version: pkg.version,
							...(track_mbid ? { track_mbid } : {})
						},
						artist_name:
							payload.data.Metadata.originalTitle ?? payload.data.Metadata.grandparentTitle,
						track_name: payload.data.Metadata.title,
						release_name: payload.data.Metadata.parentTitle
					}
				}
			]
		})
	});
};
