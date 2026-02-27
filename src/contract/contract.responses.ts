import { Prettify } from "ts-essentials";
import type { ContractResponses } from "~/contract/contract.types.js";

export type MergeContractResponses<
	TBaseResponses extends ContractResponses,
	TAdditionalResponses extends ContractResponses,
> = {
	[TStatus in Extract<keyof TBaseResponses | keyof TAdditionalResponses, number>]:
		| (TStatus extends keyof TBaseResponses ? TBaseResponses[TStatus] : never)
		| (TStatus extends keyof TAdditionalResponses ? TAdditionalResponses[TStatus] : never);
};

export type MergeContractResponsesMany<TResponses extends ReadonlyArray<ContractResponses>> =
	Prettify<
		TResponses extends readonly [
			infer THead extends ContractResponses,
			...infer TTail extends ReadonlyArray<ContractResponses>,
		]
			? MergeContractResponses<THead, MergeContractResponsesMany<TTail>>
			: Record<never, never>
	>;

export function mergeContractResponses<const TResponses extends ReadonlyArray<ContractResponses>>(
	...responses: TResponses
): MergeContractResponsesMany<TResponses> {
	const merged: ContractResponses = {};

	for (const responseMap of responses) {
		Object.assign(merged, responseMap);
	}

	return merged as MergeContractResponsesMany<TResponses>;
}
