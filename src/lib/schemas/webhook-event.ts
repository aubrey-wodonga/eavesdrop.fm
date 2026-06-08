import * as z from 'zod/mini';

const AllowedEventTypesSchema = z.enum(
	['media.scrobble', 'media.play', 'media.resume', 'media.listen'],
	{
		error: ({ input }) =>
			typeof input === 'string' ? `${input.toUpperCase()} events are ignored` : 'Invalid event type'
	}
);

const AcceptedLibrarySectionTypesSchema = z.enum(['artist'], {
	error: ({ input }) =>
		typeof input === 'string'
			? `${input.toUpperCase()} libraries are ignored`
			: 'Invalid library type'
});

const AcceptedMetadataTypesSchema = z.enum(['track'], { error: 'Not a track' });

export const WebhookEventSchema = z.object({
	event: AllowedEventTypesSchema,
	Account: z.object({ title: z.string() }),
	Metadata: z.object(
		{
			librarySectionType: AcceptedLibrarySectionTypesSchema,
			type: AcceptedMetadataTypesSchema,
			title: z.string(),
			librarySectionTitle: z.optional(z.string()),
			grandparentTitle: z.string(),
			parentTitle: z.string(),
			Guid: z.optional(z.array(z.object({ id: z.string() })))
		},
		{ error: 'Missing metadata item' }
	)
});

export type WebhookEvent = z.infer<typeof WebhookEventSchema>;
