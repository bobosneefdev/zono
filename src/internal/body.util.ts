import type { SuperJSONResult } from "superjson";
import superjson from "superjson";
import type { ContractBody, ContractResponse } from "~/contract/contract.types.js";

/**
 * Parses the raw HTTP request body based on the contract body type.
 * For SuperJSON, deserializes the superjson envelope to recover the original value.
 */
export async function resolveRequestBody(
	contractBody: ContractBody,
	req: Request,
): Promise<unknown> {
	switch (contractBody.type) {
		case "JSON":
			return req.json();
		case "SuperJSON": {
			const raw = (await req.json()) as SuperJSONResult;
			return superjson.deserialize(raw);
		}
		case "String":
			return req.text();
		case "URLSearchParams":
			return new URLSearchParams(await req.text());
		case "FormData":
			return req.formData();
		case "Blob":
			return req.blob();
		case "Uint8Array":
			return req.arrayBuffer().then((buf) => new Uint8Array(buf));
	}
}

/**
 * Parses the HTTP response body on the client side.
 * For SuperJSON, deserializes then runs the schema (for transforms).
 * For all other types, runs the schema directly on the parsed raw value.
 */
export async function parseResponseBody(
	contractResponse: ContractResponse,
	response: Response,
): Promise<unknown> {
	switch (contractResponse.type) {
		case "JSON": {
			const rawBody = await response.clone().json();
			return contractResponse.schema.parseAsync(rawBody);
		}
		case "SuperJSON": {
			const serialized = (await response.clone().json()) as SuperJSONResult;
			const rawBody = superjson.deserialize(serialized);
			return contractResponse.schema.parseAsync(rawBody);
		}
		case "Text": {
			const rawBody = await response.clone().text();
			return contractResponse.schema.parseAsync(rawBody);
		}
		case "Blob": {
			const rawBody = await response.clone().blob();
			return contractResponse.schema.parseAsync(rawBody);
		}
		case "ArrayBuffer": {
			const rawBody = await response.clone().arrayBuffer();
			return contractResponse.schema.parseAsync(rawBody);
		}
		case "FormData": {
			const rawBody = await response.clone().formData();
			return contractResponse.schema.parseAsync(rawBody);
		}
		case "ReadableStream":
			return contractResponse.schema.parseAsync(response.body);
		case "Void":
			return undefined;
	}
}
