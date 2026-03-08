import type {
	CompiledContractRoute,
	Contract,
	ContractBodySchema,
	ContractHeadersSchema,
	ContractMethodDefinition,
	ContractQuerySchema,
	ContractsTree,
	HTTPMethod,
	RuntimeResponseSchema,
} from "./contract.types.js";

const ensureSlashPath = (path: string): string => {
	if (path.length === 0) {
		return "/";
	}
	return path.startsWith("/") ? path : `/${path}`;
};

const joinPath = (prefix: string, segment: string): string => {
	const normalizedPrefix = prefix === "/" ? "" : prefix;
	return ensureSlashPath(`${normalizedPrefix}/${segment}`.replace(/\/+/g, "/"));
};

const toHonoPath = (pathTemplate: string): string => {
	return pathTemplate.replace(/\$([a-zA-Z0-9_]+)/g, (_raw: string, paramName: string) => {
		return `:${paramName}`;
	});
};

const isHTTPMethod = (value: string): value is HTTPMethod => {
	return (
		value === "get" ||
		value === "post" ||
		value === "put" ||
		value === "delete" ||
		value === "patch" ||
		value === "options" ||
		value === "head"
	);
};

export const compileContractRoutes = <TContracts extends ContractsTree>(
	contracts: TContracts,
): Array<CompiledContractRoute> => {
	const routes: Array<CompiledContractRoute> = [];

	const walk = (node: unknown, pathPrefix: string): void => {
		if (!node || typeof node !== "object") {
			return;
		}
		const nodeRecord = node as Record<string, unknown>;
		const contractNode = nodeRecord.CONTRACT;
		if (contractNode && typeof contractNode === "object") {
			for (const [candidateMethod, candidateMethodDefinition] of Object.entries(
				contractNode,
			)) {
				if (!isHTTPMethod(candidateMethod)) {
					continue;
				}
				if (!candidateMethodDefinition || typeof candidateMethodDefinition !== "object") {
					continue;
				}
				routes.push({
					pathTemplate: ensureSlashPath(pathPrefix),
					honoPath: toHonoPath(ensureSlashPath(pathPrefix)),
					method: candidateMethod,
					methodDefinition: candidateMethodDefinition as ContractMethodDefinition,
				});
			}
		}

		const shapeNode = nodeRecord.SHAPE;
		if (!shapeNode || typeof shapeNode !== "object") {
			return;
		}
		for (const [segment, childNode] of Object.entries(shapeNode)) {
			walk(childNode, joinPath(pathPrefix, segment));
		}
	};

	walk(contracts, "");
	return routes;
};

export const getContractRequestParsers = (
	methodDefinition: ContractMethodDefinition,
): {
	pathParams?: ContractMethodDefinition["pathParams"];
	query?: ContractQuerySchema;
	body?: ContractBodySchema;
	headers?: ContractHeadersSchema;
} => {
	return {
		pathParams: methodDefinition.pathParams,
		query: methodDefinition.query,
		body: methodDefinition.body,
		headers: methodDefinition.headers,
	};
};

export const getContractResponseSchema = (
	methodDefinition: ContractMethodDefinition,
	status: number,
): RuntimeResponseSchema | undefined => {
	return methodDefinition.responses[status];
};

export const validateContractResponseType = (
	responseSchema: RuntimeResponseSchema,
	type: string,
): boolean => {
	return responseSchema.type === type;
};

export const getRuntimeResponseSchemaParser = (
	responseSchema: RuntimeResponseSchema,
): import("zod").ZodTypeAny | undefined => {
	if ("schema" in responseSchema) {
		return responseSchema.schema;
	}
	if ("body" in responseSchema) {
		return responseSchema.body;
	}
	return undefined;
};

export const isContractLike = (value: unknown): value is Contract => {
	if (!value || typeof value !== "object") {
		return false;
	}
	for (const [key, methodDefinition] of Object.entries(value as Record<string, unknown>)) {
		if (!isHTTPMethod(key)) {
			return false;
		}
		if (
			methodDefinition !== undefined &&
			(typeof methodDefinition !== "object" || methodDefinition === null)
		) {
			return false;
		}
	}
	return true;
};
