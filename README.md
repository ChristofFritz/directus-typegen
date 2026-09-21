# directus-typegen

[![CI](https://github.com/ChristofFritz/directus-typegen/actions/workflows/ci.yml/badge.svg)](https://github.com/ChristofFritz/directus-typegen/actions/workflows/ci.yml) [![npm](https://img.shields.io/npm/v/directus-typegen)](https://www.npmjs.com/package/directus-typegen)

Generate a TypeScript schema for the [Directus SDK](https://docs.directus.io/guides/sdk/) from a Directus OpenAPI spec or a running Directus server (tested against Directus 12.3.1).

The generated file gives you type-checking and autocompletion for `createDirectus<Schema>()`.

## Usage

Requires Node.js 20.19 or newer.

```sh
# From a running server with a static access token (recommended)
npx directus-typegen --host http://localhost:8055 --token <token> --outFile schema.d.ts

# From a running server with email/password
npx directus-typegen --host http://localhost:8055 --email admin@example.com --password <...> --outFile schema.d.ts

# From a spec file (GET /server/specs/oas)
npx directus-typegen --specFile directus.oas.json > schema.d.ts

# Change the exported type name (default: "Schema")
npx directus-typegen --specFile directus.oas.json --typeName MyCollections > schema.d.ts

# Include system collections (directus_users, directus_files, ...)
npx directus-typegen --host http://localhost:8055 --token <token> --includeSystem
```

Connection options can also be provided as environment variables (`DIRECTUS_HOST`, `DIRECTUS_TOKEN`, `DIRECTUS_EMAIL`, `DIRECTUS_PASSWORD`):

```sh
DIRECTUS_HOST=http://localhost:8055 DIRECTUS_TOKEN=<token> npx directus-typegen -o schema.d.ts
```

| Option            | Alias | Description                                                            |
| ----------------- | ----- | ---------------------------------------------------------------------- |
| `--host`          | `-u`  | Directus server URL                                                    |
| `--token`         | `-k`  | Static access token of a Directus user (alternative to email/password) |
| `--email`         | `-e`  | Email (with `--password`)                                              |
| `--password`      | `-p`  | Password (with `--email`)                                              |
| `--specFile`      | `-i`  | Input OpenAPI spec file (alternative to `--host`)                      |
| `--outFile`       | `-o`  | Output file, defaults to stdout                                        |
| `--typeName`      | `-t`  | Name of the exported schema type, default `Schema`                     |
| `--includeSystem` | `-s`  | Include `directus_*` system collections, default `false`               |

The user whose token/credentials you use needs read access to the collections you want typed; the spec only contains what that user is allowed to see. Create a static token in the Directus admin app under the user's profile → *Token*.

## Output

```ts
/** Collection `article` */
export type ItemsArticle = {
  id: number;
  status: string;
  title: string;
  body: string | null;
  published_at: string | null;
  tags: unknown;
  author: string | ItemsAuthor | null;                 // m2o
  cover: string | Files | null;                        // file
  user_created: string | Users | null;
  categories: number[] | ItemsArticleCategory[] | null; // m2m / o2m
  blocks: number[] | ItemsArticleBlocks[] | null;       // m2a
};

/** Collection `article_blocks` */
export type ItemsArticleBlocks = {
  id: number;
  article_id: number | ItemsArticle | null;
  item: string | ItemsBlockText | ItemsBlockImage | null;
  collection: "block_text" | "block_image" | null;
};

export type Schema = {
  article: ItemsArticle[];
  article_blocks: ItemsArticleBlocks[];
  author: ItemsAuthor[];
  directus_files: Files[];
  directus_users: Users[];
  "site-settings": ItemsSiteSettings; // singleton
};
```

- Type names follow the OpenAPI spec (`Items<Collection>` for your collections, `Users`, `Files`, … for system ones).
- Regular collections are arrays, singletons plain objects.
- Relations use the shapes `@directus/sdk` needs for nested `fields`, `filter` and result narrowing: `string | Related` for m2o, `number[] | Related[]` for o2m/m2m, and `item`/`collection` unions for m2a.
- System collections that your collections reference (typically `directus_users`, `directus_files` and what those reference) are included automatically, because the SDK only recognises a relation when the related collection is part of the schema. `--includeSystem` adds all of them.

Then use it with the SDK:

```ts
import { createDirectus, readItems, rest } from "@directus/sdk";
import type { Schema } from "./schema";

const directus = createDirectus<Schema>("http://localhost:8055").with(rest());

const articles = await directus.request(
  readItems("article", {
    fields: ["id", "title", { author: ["name"], blocks: ["collection", { item: { block_text: ["text"] } }] }],
  }),
);
articles[0]?.author?.name; // string | null | undefined
```

## Programmatic API

```ts
import { generateTypeScript, listCollections, readSpecFile } from "directus-typegen";

const spec = await readSpecFile({ host: "http://localhost:8055", token: "<token>" });
const ts = generateTypeScript(spec, { typeName: "Schema", includeSystem: false });
const collections = listCollections(spec); // [{ collection, schema, singleton, system }]
```

## Development

```sh
npm ci
npm run build                    # esbuild + eslint + tsc declarations → build/
npm test                         # builds, then runs the unit tests
npm run test:integration:docker  # also runs the integration test against Directus 12.3.1 in Docker
```

The integration test (`src/integration.test.ts`) starts from an empty Directus, seeds it over the REST API with every field and relation kind (all scalar types, m2o, o2m, m2m, m2a, files, translations, a singleton, a folder, a hyphenated collection name, string/uuid/integer primary keys), runs the CLI with a static token and with email/password, checks the generated types and type-checks them together with `@directus/sdk`. It runs only when `DIRECTUS_TEST_HOST` is set; CI does this on every push and pull request (`.github/workflows/ci.yml`).

### Releasing

Publishing a GitHub release runs `.github/workflows/release.yml`, which tests and publishes to npm through [trusted publishing](https://docs.npmjs.com/trusted-publishers) (OIDC, no token) with provenance. The package's trusted publisher on npmjs.com must point at this repository and `release.yml`; the very first version has to be published manually once so that setting can be made.

## Credits

Started as a fork of [directus-typescript-gen](https://github.com/elierotenberg/directus-typescript-gen) by Elie Rotenberg; the generator has since been rewritten for the current Directus SDK.

## License

[MIT](LICENSE)
