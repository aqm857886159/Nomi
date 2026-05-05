"use strict";

const { z } = require("zod");

const STORYBOARD_SELECTION_PROTOCOL_VERSION = 1;

const storyboardSelectionScopeSchema = z.enum(["chunk", "frame"]);

const storyboardReferenceBindingKindSchema = z.enum([
	"continuity_tail",
	"role",
	"reference",
	"scene_prop",
	"spell_fx",
]);

const storyboardReferenceBindingSchema = z
	.object({
		kind: storyboardReferenceBindingKindSchema,
		refId: z.string().min(1).max(200).optional(),
		label: z.string().min(1).max(200),
		imageUrl: z.string().min(1).max(10_000),
	})
	.strict();

const storyboardGroupSizeSchema = z.union([
	z.literal(1),
	z.literal(4),
	z.literal(9),
	z.literal(25),
]);

const storyboardSelectionContextSchema = z
	.object({
		version: z.literal(STORYBOARD_SELECTION_PROTOCOL_VERSION),
		scope: storyboardSelectionScopeSchema,
		taskId: z.string().min(1).max(200).optional(),
		planId: z.string().min(1).max(200).optional(),
		chunkId: z.string().min(1).max(200).optional(),
		chunkIndex: z.number().int().min(0).max(9_999).optional(),
		groupSize: storyboardGroupSizeSchema.optional(),
		shotStart: z.number().int().min(1).max(5_000).optional(),
		shotEnd: z.number().int().min(1).max(5_000).optional(),
		shotNo: z.number().int().min(1).max(5_000).optional(),
		frameIndex: z.number().int().min(0).max(24).optional(),
		title: z.string().min(1).max(200).optional(),
		imageUrl: z.string().min(1).max(10_000).optional(),
		sourceBookId: z.string().min(1).max(200).optional(),
		materialChapter: z.number().int().min(1).max(9_999).optional(),
		storyContext: z.string().min(1).max(4_000).optional(),
		shotPrompt: z.string().min(1).max(12_000).optional(),
		storyboardScript: z.string().min(1).max(20_000).optional(),
		modelKey: z.string().min(1).max(200).optional(),
		aspectRatio: z.string().min(1).max(40).optional(),
		referenceBindings: z.array(storyboardReferenceBindingSchema).max(12).optional(),
	})
	.strict();

function normalizeStoryboardReferenceBinding(input) {
	const parsed = storyboardReferenceBindingSchema.safeParse(input);
	return parsed.success ? parsed.data : null;
}

function normalizeStoryboardReferenceBindings(input) {
	if (!Array.isArray(input)) return [];
	const seen = new Set();
	const normalized = [];
	for (const item of input) {
		const parsed = normalizeStoryboardReferenceBinding(item);
		if (!parsed) continue;
		const dedupeKey = [
			parsed.kind,
			parsed.refId || "",
			parsed.label,
			parsed.imageUrl,
		].join("::");
		if (seen.has(dedupeKey)) continue;
		seen.add(dedupeKey);
		normalized.push(parsed);
		if (normalized.length >= 12) break;
	}
	return normalized;
}

function normalizeStoryboardSelectionContext(input) {
	if (!input || typeof input !== "object" || Array.isArray(input)) return null;
	const value = input;
	const parsed = storyboardSelectionContextSchema.safeParse({
		...value,
		referenceBindings: normalizeStoryboardReferenceBindings(value.referenceBindings),
	});
	return parsed.success ? parsed.data : null;
}

function collectStoryboardSelectionReferenceImageUrls(context) {
	if (!context) return [];
	const urls = [];
	const seen = new Set();
	for (const binding of context.referenceBindings || []) {
		const imageUrl = String(binding.imageUrl || "").trim();
		if (!imageUrl || seen.has(imageUrl)) continue;
		seen.add(imageUrl);
		urls.push(imageUrl);
		if (urls.length >= 12) break;
	}
	return urls;
}

module.exports = {
	STORYBOARD_SELECTION_PROTOCOL_VERSION,
	storyboardSelectionScopeSchema,
	storyboardReferenceBindingKindSchema,
	storyboardReferenceBindingSchema,
	storyboardSelectionContextSchema,
	normalizeStoryboardReferenceBinding,
	normalizeStoryboardReferenceBindings,
	normalizeStoryboardSelectionContext,
	collectStoryboardSelectionReferenceImageUrls,
};
