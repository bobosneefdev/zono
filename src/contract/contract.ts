import type {
	Contract,
	ContractMethodMap,
	ContractResponses,
	RouterShape,
} from "~/contract/contract.types.js";
import type {
	ContractDefinition,
	MergeContractResponsesMany,
	ValidateContractDefinition,
} from "~/contract/contract.util.js";
import { getContractMethods, isContractNode, isRecord, isRouterNode } from "~/internal/util.js";

function validateContractNode(node: unknown): void {
	if (!isRecord(node)) {
		return;
	}

	if (isContractNode(node)) {
		const contractMap = node.CONTRACT as ContractMethodMap;
		for (const method of getContractMethods(contractMap)) {
			const contract = contractMap[method] as Contract | undefined;
			if (!contract) continue;

			for (const response of Object.values(contract.responses)) {
				void response;
			}
		}
	}

	if (isRouterNode(node)) {
		for (const child of Object.values(node.ROUTER)) {
			validateContractNode(child);
		}
	}
}

/**
 * Creates a type-safe contract definition matching the given router shape.
 * @param _shape - The router shape used for type inference only
 * @param definition - The contract definition
 * @returns The validated contract definition
 */
export function createContracts<
	const TShape extends RouterShape,
	const TDef extends ContractDefinition<TShape>,
>(_shape: TShape, definition: TDef & ValidateContractDefinition<TShape, TDef>): TDef {
	validateContractNode(definition);
	return definition;
}

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
