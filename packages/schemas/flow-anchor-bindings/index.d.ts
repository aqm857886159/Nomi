export declare const PUBLIC_FLOW_ANCHOR_BINDING_KINDS: readonly [
	"character",
	"scene",
	"prop",
	"shot",
	"story",
	"asset",
	"context",
	"authority_base_frame",
];

export declare const PUBLIC_FLOW_ANCHOR_REFERENCE_VIEWS: readonly [
	"three_view",
	"role_card",
];

export type PublicFlowAnchorBindingKind =
	(typeof PUBLIC_FLOW_ANCHOR_BINDING_KINDS)[number];

export type PublicFlowAnchorReferenceView =
	(typeof PUBLIC_FLOW_ANCHOR_REFERENCE_VIEWS)[number];

export type PublicFlowAnchorBinding = {
	kind: PublicFlowAnchorBindingKind;
	refId?: string | null;
	entityId?: string | null;
	label?: string | null;
	sourceBookId?: string | null;
	sourceNodeId?: string | null;
	assetId?: string | null;
	assetRefId?: string | null;
	imageUrl?: string | null;
	referenceView?: PublicFlowAnchorReferenceView | null;
	category?: string | null;
	note?: string | null;
};

export declare function normalizePublicFlowAnchorBinding(
	value: unknown,
): PublicFlowAnchorBinding | null;

export declare function normalizePublicFlowAnchorBindings(
	value: unknown,
): PublicFlowAnchorBinding[];

export declare function mergePublicFlowAnchorBindings(
	...parts: unknown[]
): PublicFlowAnchorBinding[];

export declare function collectPublicFlowAnchorBindingImageUrls(
	value: unknown,
	limit?: number,
): string[];
