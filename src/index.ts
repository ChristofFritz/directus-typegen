import { readFile } from "fs/promises";

import { z } from "zod";

// ---------------------------------------------------------------------------
// Fetching the spec
// ---------------------------------------------------------------------------

export type ReadSpecFileOptions = {
  readonly specFile?: undefined | string;
  readonly host?: undefined | string;
  readonly token?: undefined | string;
  readonly email?: undefined | string;
  readonly password?: undefined | string;
};

const DirectusAuthResponse = z.object({
  data: z.object({
    access_token: z.string(),
  }),
});

const DirectusErrorResponse = z.object({
  errors: z.array(
    z.object({
      extensions: z.object({ code: z.string() }).partial().optional(),
      message: z.string(),
    }),
  ),
});

const readJson = async (response: Response, what: string): Promise<unknown> => {
  const text = await response.text();
  let json: unknown = undefined;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    // not JSON, handled below
  }
  if (!response.ok) {
    const parsed = DirectusErrorResponse.safeParse(json);
    const detail = parsed.success
      ? parsed.data.errors
          .map((e) => `${e.extensions?.code ?? `ERROR`}: ${e.message}`)
          .join(`; `)
      : text.slice(0, 200);
    throw new Error(`${what} failed (HTTP ${response.status}): ${detail}`);
  }
  if (json === undefined) {
    throw new Error(`${what} failed: response is not JSON`);
  }
  return json;
};

const login = async (
  host: string,
  email: string,
  password: string,
): Promise<string> => {
  const response = await fetch(new URL(`/auth/login`, host), {
    body: JSON.stringify({ email, password }),
    headers: { "Content-Type": `application/json` },
    method: `POST`,
  });
  const json = await readJson(response, `Login`);
  return DirectusAuthResponse.parse(json).data.access_token;
};

export const fetchSpec = async (
  host: string,
  accessToken: string,
): Promise<unknown> => {
  const response = await fetch(new URL(`/server/specs/oas`, host), {
    headers: {
      Accept: `application/json`,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  return readJson(response, `Fetching OpenAPI spec`);
};

export const readSpecFile = async (
  options: ReadSpecFileOptions,
): Promise<unknown> => {
  if (typeof options.specFile === `string`) {
    return JSON.parse(
      await readFile(options.specFile, { encoding: `utf-8` }),
    ) as unknown;
  }

  if (typeof options.host !== `string`) {
    throw new Error(`Either --specFile or --host must be specified`);
  }

  if (typeof options.token === `string` && options.token.length > 0) {
    return fetchSpec(options.host, options.token);
  }

  if (
    typeof options.email !== `string` ||
    typeof options.password !== `string`
  ) {
    throw new Error(
      `Either --token or both --email and --password must be specified`,
    );
  }

  const accessToken = await login(
    options.host,
    options.email,
    options.password,
  );
  return fetchSpec(options.host, accessToken);
};

// ---------------------------------------------------------------------------
// Spec inspection
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json =>
  typeof value === `object` && value !== null && !Array.isArray(value);

const get = (value: unknown, ...path: readonly string[]): unknown =>
  path.reduce<unknown>(
    (acc, key) => (isRecord(acc) ? acc[key] : undefined),
    value,
  );

const refPattern = /^#\/components\/schemas\/(?<ref>[^/]+)$/;

const refName = (value: unknown): undefined | string => {
  const $ref = get(value, `$ref`);
  if (typeof $ref !== `string`) {
    return undefined;
  }
  return refPattern.exec($ref)?.groups?.[`ref`];
};

const schemasOf = (spec: unknown): Readonly<Record<string, unknown>> => {
  const schemas = get(spec, `components`, `schemas`);
  return isRecord(schemas) ? schemas : {};
};

const itemsPathPattern = /^\/items\/[^/{]+$/;

/**
 * Directus returns `data: { $ref }` (instead of `data: { type: array }`) on
 * the collection-level GET of a singleton. `/items/{collection}/{id}` and
 * `/users/me` look the same, so only `/items/<collection>` paths are checked
 * and the one system singleton (`directus_settings`) is hard-coded.
 */
const collectSingletonSchemas = (spec: unknown): ReadonlySet<string> => {
  const singletons = new Set<string>();
  const paths = get(spec, `paths`);
  if (!isRecord(paths)) {
    return singletons;
  }
  for (const [path, pathItem] of Object.entries(paths)) {
    if (!itemsPathPattern.test(path)) {
      continue;
    }
    const data = get(
      pathItem,
      `get`,
      `responses`,
      `200`,
      `content`,
      `application/json`,
      `schema`,
      `properties`,
      `data`,
    );
    const ref = refName(data);
    if (typeof ref === `string`) {
      singletons.add(ref);
    }
  }
  return singletons;
};

export type CollectionInfo = {
  readonly collection: string;
  /** Name of the schema in `components.schemas` (e.g. `ItemsArticle`). */
  readonly schema: string;
  readonly singleton: boolean;
  readonly system: boolean;
};

export type ListCollectionsOptions = {
  /** Include Directus system collections (directus_users, ...). */
  readonly includeSystem?: undefined | boolean;
};

export const listCollections = (
  spec: unknown,
  { includeSystem = false }: ListCollectionsOptions = {},
): readonly CollectionInfo[] => {
  const singletons = collectSingletonSchemas(spec);
  const result: CollectionInfo[] = [];
  for (const [schema, definition] of Object.entries(schemasOf(spec))) {
    const collection = get(definition, `x-collection`);
    if (typeof collection !== `string` || collection.length === 0) {
      continue;
    }
    const system = collection.startsWith(`directus_`);
    if (system && !includeSystem) {
      continue;
    }
    result.push({
      collection,
      schema,
      singleton: collection === `directus_settings` || singletons.has(schema),
      system,
    });
  }
  return result.sort((a, b) => a.collection.localeCompare(b.collection));
};

// ---------------------------------------------------------------------------
// TypeScript emission
// ---------------------------------------------------------------------------

export type GenerateTypeScriptOptions = {
  readonly typeName: string;
  /** Include Directus system collections (directus_users, ...) in the schema. */
  readonly includeSystem?: undefined | boolean;
};

const validIdentifier = /^[a-zA-Z_$][a-zA-Z_$0-9]*$/;

const propertyKey = (name: string): string =>
  validIdentifier.test(name) ? name : JSON.stringify(name);

const literal = (value: unknown): string =>
  typeof value === `string` ||
  typeof value === `number` ||
  typeof value === `boolean`
    ? JSON.stringify(value)
    : value === null
      ? `null`
      : `unknown`;

const indent = (source: string): string =>
  source
    .split(`\n`)
    .map((line) => (line.length === 0 ? line : `  ${line}`))
    .join(`\n`);

const wrap = (type: string): string => (/[|&]/.test(type) ? `(${type})` : type);

type Emitter = {
  readonly typeNameOf: (schema: string) => string;
  readonly collectionOf: (schema: string) => undefined | string;
};

const scalarType = (schema: Json): string => {
  const type = schema[`type`];
  switch (type) {
    case `integer`:
    case `number`:
      return `number`;
    case `string`:
      return `string`;
    case `boolean`:
      return `boolean`;
    case `null`:
      return `null`;
    default:
      return `unknown`;
  }
};

/** The `$ref` alternatives of an array field's `items.oneOf`, if any. */
const arrayItemRefs = (node: unknown): readonly string[] => {
  const oneOf = get(node, `items`, `oneOf`);
  return Array.isArray(oneOf)
    ? oneOf
        .map((a) => refName(a))
        .filter((r): r is string => typeof r === `string`)
    : [];
};

/**
 * Converts one JSON-schema node into a TypeScript type. Relational fields are
 * emitted the way `@directus/sdk` expects them:
 *   m2o:            `string | Related`
 *   o2m / m2m:      `number[] | Related[]`
 *   m2a (`item`):   `string | A | B`
 */
const typeOf = (node: unknown, emitter: Emitter): string => {
  if (!isRecord(node)) {
    return `unknown`;
  }
  const ref = refName(node);
  if (typeof ref === `string`) {
    return emitter.typeNameOf(ref);
  }
  if (Array.isArray(node[`enum`])) {
    return node[`enum`].map(literal).join(` | `) || `never`;
  }
  const union = (members: unknown): string =>
    Array.isArray(members)
      ? [...new Set(members.map((m) => typeOf(m, emitter)))].join(` | `)
      : `unknown`;
  if (Array.isArray(node[`oneOf`])) {
    return union(node[`oneOf`]);
  }
  if (Array.isArray(node[`anyOf`])) {
    return union(node[`anyOf`]);
  }
  if (Array.isArray(node[`allOf`])) {
    return node[`allOf`].map((m) => wrap(typeOf(m, emitter))).join(` & `);
  }
  if (node[`type`] === `array`) {
    const items = node[`items`];
    const alternatives: unknown[] =
      isRecord(items) && Array.isArray(items[`oneOf`])
        ? items[`oneOf`]
        : [items];
    if (arrayItemRefs(node).length > 1) {
      // many-to-any: a single item that can be any of the related collections
      return union(alternatives);
    }
    // `number[] | Related[]` rather than `(number | Related)[]`
    return [
      ...new Set(alternatives.map((a) => `${wrap(typeOf(a, emitter))}[]`)),
    ].join(` | `);
  }
  if (node[`type`] === `object` || isRecord(node[`properties`])) {
    const properties = node[`properties`];
    if (!isRecord(properties) || Object.keys(properties).length === 0) {
      return `Record<string, unknown>`;
    }
    return `{\n${indent(propertiesOf(properties, emitter))}\n}`;
  }
  if (node[`type`] === undefined) {
    // Directus emits `json` fields with no type at all.
    return `unknown`;
  }
  return scalarType(node);
};

const nullable = (type: string, node: unknown): string =>
  get(node, `nullable`) === true && type !== `unknown` && type !== `null`
    ? `${type} | null`
    : type;

const propertiesOf = (properties: Json, emitter: Emitter): string => {
  const entries = Object.entries(properties);

  // many-to-any: narrow the `collection` discriminator to the related collections
  const m2aCollections = new Set<string>();
  for (const [, node] of entries) {
    const refs = arrayItemRefs(node);
    if (refs.length > 1) {
      for (const r of refs) {
        const collection = emitter.collectionOf(r);
        if (typeof collection === `string`) {
          m2aCollections.add(collection);
        }
      }
    }
  }

  const lines: string[] = [];
  for (const [name, node] of entries) {
    const type =
      name === `collection` &&
      m2aCollections.size > 0 &&
      get(node, `type`) === `string`
        ? [...m2aCollections].map((c) => JSON.stringify(c)).join(` | `)
        : typeOf(node, emitter);
    lines.push(`${propertyKey(name)}: ${nullable(type, node)};`);
  }
  return lines.join(`\n`);
};

const collectRefs = (node: unknown, into: Set<string>): void => {
  if (Array.isArray(node)) {
    for (const item of node) {
      collectRefs(item, into);
    }
    return;
  }
  if (!isRecord(node)) {
    return;
  }
  const ref = refName(node);
  if (typeof ref === `string`) {
    into.add(ref);
  }
  for (const value of Object.values(node)) {
    collectRefs(value, into);
  }
};

const sanitizeIdentifier = (name: string): string => {
  const cleaned = name.replace(/[^a-zA-Z0-9_$]/g, `_`);
  return /^[a-zA-Z_$]/.test(cleaned) ? cleaned : `_${cleaned}`;
};

/**
 * Generates the TypeScript schema for `@directus/sdk`.
 *
 * The schema type lists every custom collection, plus the system collections
 * (`directus_users`, `directus_files`, ...) they reference directly or
 * indirectly: the SDK only recognises a relation when the related type is
 * part of the schema, so without them nested queries on `user_created` or a
 * file field would not type-check. With `includeSystem` all system
 * collections are added.
 */
export const generateTypeScript = (
  spec: unknown,
  { includeSystem = false, typeName }: GenerateTypeScriptOptions,
): string => {
  if (!validIdentifier.test(typeName)) {
    throw new Error(`Invalid type name: ${typeName}`);
  }

  const schemas = schemasOf(spec);
  const all = listCollections(spec, { includeSystem: true });
  const bySchema = new Map(all.map((c) => [c.schema, c]));
  const selected = all.filter((c) => includeSystem || !c.system);
  if (selected.length === 0) {
    throw new Error(
      `No collections found in spec. Does the authenticated user have read access to any collection?`,
    );
  }

  // Unique, valid TypeScript names for every schema.
  const typeNames = new Map<string, string>();
  const taken = new Set<string>([typeName]);
  for (const schema of Object.keys(schemas).sort()) {
    let candidate = sanitizeIdentifier(schema);
    let i = 2;
    while (taken.has(candidate)) {
      candidate = `${sanitizeIdentifier(schema)}${i}`;
      i += 1;
    }
    taken.add(candidate);
    typeNames.set(schema, candidate);
  }

  const emitter: Emitter = {
    collectionOf: (schema) => bySchema.get(schema)?.collection,
    typeNameOf: (schema) => typeNames.get(schema) ?? sanitizeIdentifier(schema),
  };

  // Selected collections plus everything they (transitively) reference.
  const toEmit = new Set<string>(selected.map((c) => c.schema));
  const queue = [...toEmit];
  while (queue.length > 0) {
    const schema = queue.pop() as string;
    const refs = new Set<string>();
    collectRefs(schemas[schema], refs);
    for (const ref of refs) {
      if (!toEmit.has(ref) && ref in schemas) {
        toEmit.add(ref);
        queue.push(ref);
      }
    }
  }

  const entries = [...toEmit]
    .map((schema) => bySchema.get(schema))
    .filter((c): c is CollectionInfo => c !== undefined)
    .sort((a, b) => a.collection.localeCompare(b.collection));

  let source = `/**\n * Generated by directus-typegen. Do not edit.\n */\n\n`;

  for (const schema of [...toEmit].sort()) {
    const definition = schemas[schema];
    const collection = bySchema.get(schema)?.collection;
    const properties = get(definition, `properties`);
    if (typeof collection === `string`) {
      source += `/** Collection \`${collection}\` */\n`;
    }
    source += `export type ${emitter.typeNameOf(schema)} = `;
    source +=
      isRecord(properties) && Object.keys(properties).length > 0
        ? `{\n${indent(propertiesOf(properties, emitter))}\n};\n\n`
        : `${typeOf(definition, emitter)};\n\n`;
  }

  source += `export type ${typeName} = {\n`;
  for (const { collection, schema, singleton } of entries) {
    source += `  ${propertyKey(collection)}: ${emitter.typeNameOf(schema)}${
      singleton ? `` : `[]`
    };\n`;
  }
  source += `};\n`;

  return source;
};
