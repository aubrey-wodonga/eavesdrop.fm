import { error } from '@sveltejs/kit';
import * as z from 'zod/mini';
import type { RequestHandler } from './$types';
import { WebhookEventSchema } from '$lib/schemas/webhook-event';
import pkg from '../../package.json' with { type: 'json' };

const PLEX_UA_PREFIX = 'PlexMediaServer';
const LISTENBRAINZ_API_ROOT = 'https://api.listenbrainz.org/1';

export const POST: RequestHandler = async ({ fetch, request, url: { searchParams } }) => {
	// check that the request is coming from a Plex Server
	if (!request.headers.get('user-agent')?.startsWith(PLEX_UA_PREFIX)) {
		error(400, 'Invalid User-Agent');
	}

	const token = searchParams.get('token');

	// exit early if we're missing a ListenBrainz token, as we can't do anything without it
	if (!token) {
		error(400, 'Missing token');
	}

	const rawPayload = (await request.formData()).get('payload');

	if (!rawPayload) {
		error(400, 'Missing payload');
	}

	// WebhookEventSchema should filter out events we don't want, as well as malformed payloads
	const payload = WebhookEventSchema.safeParse(JSON.parse(rawPayload.toString()));

	if (!payload.success) {
		error(400, z.prettifyError(payload.error));
	}

	// The event came from a user that doesn't match the provided filter
	if (searchParams.get('user')?.toLowerCase() !== payload.data.Account.title.toLowerCase()) {
		error(400, 'User mismatch');
	}

	// The event came from a library section that we've been told to ignore
	if (searchParams.get('ignore') === payload.data.Metadata.librarySectionTitle) {
		error(400, 'Ignored library section');
	}

	try {
		const isScrobble = payload.data.event === 'media.scrobble';
		const track_mbid = payload.data.Metadata.Guid?.find((guid) =>
			guid.id.startsWith('mbid')
		)?.id.replace('mbid://', '');

		await fetch(`${LISTENBRAINZ_API_ROOT}/submit-listens`, {
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
							artist_name: payload.data.Metadata.grandparentTitle,
							track_name: payload.data.Metadata.title,
							release_name: payload.data.Metadata.parentTitle
						}
					}
				]
			})
		});
	} catch {
		error(500, 'Failed to scrobble');
	}

	return new Response('OK');
};
