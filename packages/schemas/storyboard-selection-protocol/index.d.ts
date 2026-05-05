import type { z } from "zod";

export declare const STORYBOARD_SELECTION_PROTOCOL_VERSION: 1;

export declare const storyboardSelectionScopeSchema: z.ZodEnum<["chunk", "frame"]>;

export declare const storyboardReferenceBindingKindSchema: z.ZodEnum<[
	"continuity_tail",
	"role",
	"reference",
	"scene_prop",
	"spell_fx",
]>;

export declare const storyboardReferenceBindingSchema: z.ZodObject<{
	kind: typeof storyboardReferenceBindingKindSchema;
	refId: z.ZodOptional<z.ZodString>;
	label: z.ZodString;
	imageUrl: z.ZodString;
}, "strict">;

export declare const storyboardSelectionContextSchema: z.ZodObject<{
	version: z.ZodLiteral<1>;
	scope: typeof storyboardSelectionScopeSchema;
	taskId: z.ZodOptional<z.ZodString>;
	planId: z.ZodOptional<z.ZodString>;
	chunkId: z.ZodOptional<z.ZodString>;
	chunkIndex: z.ZodOptional<z.ZodNumber>;
	groupSize: z.ZodOptional<z.ZodUnion<[
		z.ZodLiteral<1>,
		z.ZodLiteral<4>,
		z.ZodLiteral<9>,
		z.ZodLiteral<25>,
	]>>;
	shotStart: z.ZodOptional<z.ZodNumber>;
	shotEnd: z.ZodOptional<z.ZodNumber>;
	shotNo: z.ZodOptional<z.ZodNumber>;
	frameIndex: z.ZodOptional<z.ZodNumber>;
	title: z.ZodOptional<z.ZodString>;
	imageUrl: z.ZodOptional<z.ZodString>;
	sourceBookId: z.ZodOptional<z.ZodString>;
	materialChapter: z.ZodOptional<z.ZodNumber>;
	storyContext: z.ZodOptional<z.ZodString>;
	shotPrompt: z.ZodOptional<z.ZodString>;
	storyboardScript: z.ZodOptional<z.ZodString>;
	modelKey: z.ZodOptional<z.ZodString>;
	aspectRatio: z.ZodOptional<z.ZodString>;
	referenceBindings: z.ZodOptional<z.ZodArray<typeof storyboardReferenceBindingSchema>>;
}, "strict">;

export type StoryboardSelectionScope = z.infer<typeof storyboardSelectionScopeSchema>;
export type StoryboardReferenceBindingKind = z.infer<typeof storyboardReferenceBindingKindSchema>;
export type StoryboardReferenceBinding = z.infer<typeof storyboardReferenceBindingSchema>;
export type StoryboardSelectionContext = z.infer<typeof storyboardSelectionContextSchema>;

export declare function normalizeStoryboardReferenceBinding(
	input: unknown,
): StoryboardReferenceBinding | null;

export declare function normalizeStoryboardReferenceBindings(
	input: unknown,
): StoryboardReferenceBinding[];

export declare function normalizeStoryboardSelectionContext(
	input: unknown,
): StoryboardSelectionContext | null;

export declare function collectStoryboardSelectionReferenceImageUrls(
	context: StoryboardSelectionContext | null | undefined,
): string[];
