export type Shape = {
	CONTRACT?: true;
	SHAPE?: Record<string, Shape>;
};

export type SerializedResponseType =
	| "JSON"
	| "SuperJSON"
	| "Text"
	| "Contentless"
	| "FormData"
	| "Blob"
	| "Bytes";

export type SerializedResponseSource = "contract" | "middleware" | "error";

export type DynamicSegmentKey = `$${string}`;

export type IsDynamicSegment<TKey extends string> = TKey extends DynamicSegmentKey ? true : false;
