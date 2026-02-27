export async function resolveRequestBody(
	contentType: string,
	jsonParser: () => Promise<unknown>,
	formDataParser: () => Promise<unknown>,
): Promise<unknown> {
	if (contentType.toLowerCase().includes("application/json")) {
		return jsonParser();
	}
	return formDataParser();
}
