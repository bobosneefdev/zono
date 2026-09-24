import type { ContractTree } from "../contract/contract.js";
import { isRecordObject } from "../shared/shared.js";

export const applyGatewayServiceMask = (mask: unknown, contracts: unknown): ContractTree => {
	if (!isRecordObject(mask) || !isRecordObject(contracts)) {
		return {};
	}

	const maskedContracts: ContractTree = {};

	if (mask.CONTRACT === true && isRecordObject(contracts.CONTRACT)) {
		maskedContracts.CONTRACT = contracts.CONTRACT;
	}
	if (mask.SHAPE === true && isRecordObject(contracts.SHAPE)) {
		const maskedShape: Record<string, ContractTree> = {};
		for (const [segment, childContracts] of Object.entries(contracts.SHAPE)) {
			if (isRecordObject(childContracts)) {
				maskedShape[segment] = applyGatewayServiceMask(
					{ CONTRACT: true, SHAPE: true },
					childContracts,
				);
			}
		}
		maskedContracts.SHAPE = maskedShape;
		return maskedContracts;
	}

	if (!isRecordObject(mask.SHAPE) || !isRecordObject(contracts.SHAPE)) {
		return maskedContracts;
	}

	const maskedShape: Record<string, ContractTree> = {};
	for (const [segment, childMask] of Object.entries(mask.SHAPE)) {
		const childContracts = contracts.SHAPE[segment];
		if (!isRecordObject(childMask) || !isRecordObject(childContracts)) {
			continue;
		}

		const maskedChildContracts = applyGatewayServiceMask(childMask, childContracts);
		if (
			maskedChildContracts.CONTRACT !== undefined ||
			maskedChildContracts.SHAPE !== undefined
		) {
			maskedShape[segment] = maskedChildContracts;
		}
	}

	if (Object.keys(maskedShape).length > 0) {
		maskedContracts.SHAPE = maskedShape;
	}

	return maskedContracts;
};

export const assertValidGatewayServiceKey = (serviceName: string): void => {
	if (serviceName.length === 0) {
		throw new Error("Gateway service key cannot be empty");
	}
	if (serviceName.includes("/")) {
		throw new Error(`Gateway service key '${serviceName}' cannot contain '/'`);
	}
	if (serviceName.startsWith("$")) {
		throw new Error(`Gateway service key '${serviceName}' cannot start with '$'`);
	}
};

export const getGatewayServicePathPrefix = (serviceName: string): string => {
	assertValidGatewayServiceKey(serviceName);
	return `/${serviceName}`;
};

export const namespaceGatewayPath = (serviceName: string, pathTemplate: string): string => {
	const servicePathPrefix = getGatewayServicePathPrefix(serviceName);
	if (pathTemplate === "/") {
		return servicePathPrefix;
	}
	return `${servicePathPrefix}${pathTemplate}`;
};
