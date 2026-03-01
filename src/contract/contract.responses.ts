import type { ContractResponses } from "~/contract/contract.types.js";

/**
 * Merges two contract response maps, combining responses for the same status code into a union.
 * @template TBaseResponses - Base response map
 * @template TAdditionalResponses - Additional responses to merge
 */
export type MergeContractResponses<
	TBaseResponses extends ContractResponses,
	TAdditionalResponses extends ContractResponses,
> = {
	[TStatus in Extract<keyof TBaseResponses | keyof TAdditionalResponses, number>]:
		| (TStatus extends keyof TBaseResponses ? TBaseResponses[TStatus] : never)
		| (TStatus extends keyof TAdditionalResponses ? TAdditionalResponses[TStatus] : never);
};

/**
 * Recursively merges multiple contract response maps.
 * @template TResponses - Array of response maps to merge
 */
export type MergeContractResponsesMany<TResponses extends ReadonlyArray<ContractResponses>> =
	TResponses extends readonly [
		infer THead extends ContractResponses,
		...infer TTail extends ReadonlyArray<ContractResponses>,
	]
		? MergeContractResponses<THead, MergeContractResponsesMany<TTail>>
		: Record<never, never>;

/**
 * Merges multiple contract response maps into a single map.
 * Responses for the same status code are combined into a union type.
 * @param responses - Array of response maps to merge
 * @returns Merged response map
 */
export function mergeContractResponses<const TResponses extends ReadonlyArray<ContractResponses>>(
	...responses: TResponses
): MergeContractResponsesMany<TResponses> {
	const merged: ContractResponses = {};

	for (const responseMap of responses) {
		Object.assign(merged, responseMap);
	}

	return merged as MergeContractResponsesMany<TResponses>;
}
