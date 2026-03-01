- Instead of disallowing any nested transforms, we should probably just not care about transforms, instead just mind that input and output of base schema are both HTTP friendly.
  - Beyond the base schema being http-friendly we should allow top-level transform chains as we currently do as that allows us to easily unwrap the base HTTP-friendly schema and use that for validation of data leaving the client or server
  ```ts
  const shouldBeAllowed = z.object({
    // this is still HTTP friendly even with transform
    date: z.number().int().min(0).transform((v) => new Date(v).toISOString()),
  }).transform((v) => ({ date: new Date(v) }));
  ```