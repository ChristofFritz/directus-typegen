/**
 * Integration test against a real Directus instance.
 *
 * Runs only when DIRECTUS_TEST_HOST is set (see docker-compose.test.yml and
 * .github/workflows/ci.yml). Seeds the instance with every field/relation kind
 * Directus can put into its OpenAPI spec, generates the schema through the real
 * CLI, and type-checks the result together with @directus/sdk.
 */
import { execFileSync, spawnSync } from "child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";

import { listCollections, readSpecFile } from ".";

const host = process.env[`DIRECTUS_TEST_HOST`];
const token = process.env[`DIRECTUS_TEST_TOKEN`] ?? `test-static-token`;
const email = process.env[`DIRECTUS_TEST_EMAIL`] ?? `admin@example.com`;
const password = process.env[`DIRECTUS_TEST_PASSWORD`] ?? `admin123`;

const describeIf = host === undefined ? describe.skip : describe;

type Json = Record<string, unknown>;

const api = async (
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> => {
  const response = await fetch(new URL(path, host), {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": `application/json`,
    },
    method,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${path} -> ${response.status}: ${text}`);
  }
  return text.length === 0 ? undefined : (JSON.parse(text) as unknown);
};

const exists = async (path: string): Promise<boolean> => {
  const response = await fetch(new URL(path, host), {
    headers: { Authorization: `Bearer ${token}` },
  });
  return response.ok;
};

const pk = (
  field: string,
  type: `integer` | `uuid` | `string`,
  extra: Json = {},
): Json => ({
  field,
  meta: {
    hidden: type !== `string`,
    interface: `input`,
    readonly: type !== `string`,
    ...(type === `uuid` ? { special: [`uuid`] } : {}),
  },
  schema: {
    has_auto_increment: type === `integer`,
    is_primary_key: true,
    ...(type === `string` ? { max_length: 10 } : {}),
    ...extra,
  },
  type,
});

const field = (name: string, type: string, extra: Json = {}): Json => ({
  field: name,
  meta: { interface: `input` },
  schema: {},
  type,
  ...extra,
});

const alias = (name: string, special: string, iface: string): Json => ({
  field: name,
  meta: { interface: iface, special: [special] },
  type: `alias`,
});

const createCollection = async (
  collection: string,
  fields: readonly Json[],
  meta: Json = {},
): Promise<void> => {
  if (await exists(`/collections/${collection}`)) {
    return;
  }
  await api(`POST`, `/collections`, {
    collection,
    fields,
    meta,
    schema: {},
  });
};

const createRelation = async (relation: Json): Promise<void> => {
  const { collection, field: fieldName } = relation as {
    collection: string;
    field: string;
  };
  if (await exists(`/relations/${collection}/${fieldName}`)) {
    return;
  }
  await api(`POST`, `/relations`, relation);
};

const createAliasField = async (
  collection: string,
  definition: Json,
): Promise<void> => {
  const name = definition[`field`] as string;
  if (await exists(`/fields/${collection}/${name}`)) {
    return;
  }
  await api(`POST`, `/fields/${collection}`, definition);
};

const seed = async (): Promise<void> => {
  // Folder (no table) – must NOT show up in the generated schema.
  if (!(await exists(`/collections/content`))) {
    await api(`POST`, `/collections`, {
      collection: `content`,
      meta: { icon: `folder` },
      schema: null,
    });
  }

  // Plain collections with different primary key types.
  await createCollection(`author`, [
    pk(`id`, `uuid`),
    field(`name`, `string`),
    field(`email`, `string`),
    field(`avatar`, `uuid`, { meta: { interface: `file`, special: [`file`] } }),
  ]);

  await createCollection(`category`, [
    pk(`slug`, `string`),
    field(`label`, `string`),
    field(`sort`, `integer`, { meta: { hidden: true, interface: `input` } }),
  ]);

  await createCollection(`languages`, [
    pk(`code`, `string`),
    field(`name`, `string`),
    field(`direction`, `string`, {
      schema: { default_value: `ltr` },
    }),
  ]);

  await createCollection(`block_text`, [
    pk(`id`, `integer`),
    field(`text`, `text`),
  ]);
  await createCollection(`block_image`, [
    pk(`id`, `integer`),
    field(`image`, `uuid`, { meta: { interface: `file`, special: [`file`] } }),
    field(`caption`, `string`),
  ]);

  // Every scalar type Directus supports (see @directus/constants TYPES).
  await createCollection(
    `article`,
    [
      pk(`id`, `integer`),
      field(`status`, `string`, {
        meta: {
          interface: `select-dropdown`,
          options: {
            choices: [
              { text: `Published`, value: `published` },
              { text: `Draft`, value: `draft` },
            ],
          },
        },
        schema: { default_value: `draft`, is_nullable: false },
      }),
      field(`sort`, `integer`),
      field(`title`, `string`, { schema: { is_nullable: false } }),
      field(`body`, `text`),
      field(`published`, `boolean`, {
        meta: { interface: `boolean`, special: [`cast-boolean`] },
        schema: { default_value: false },
      }),
      field(`views`, `integer`),
      field(`big_number`, `bigInteger`),
      field(`rating`, `float`),
      field(`price`, `decimal`, {
        schema: { numeric_precision: 10, numeric_scale: 2 },
      }),
      field(`published_at`, `timestamp`),
      field(`date_only`, `date`),
      field(`time_only`, `time`),
      field(`datetime_local`, `dateTime`),
      field(`tags`, `json`, {
        meta: { interface: `tags`, special: [`cast-json`] },
      }),
      field(`csv_field`, `csv`, {
        meta: { interface: `tags`, special: [`cast-csv`] },
      }),
      field(`external_id`, `uuid`),
      field(`secret`, `hash`, {
        meta: { interface: `input-hash`, special: [`hash`] },
      }),
      field(`location`, `geometry.Point`, { meta: { interface: `map` } }),
      // system-ish special fields
      field(`user_created`, `uuid`, {
        meta: { interface: `select-dropdown-m2o`, special: [`user-created`] },
      }),
      field(`date_created`, `timestamp`, {
        meta: { interface: `datetime`, special: [`date-created`] },
      }),
      // m2o
      field(`author`, `uuid`, { meta: { interface: `select-dropdown-m2o` } }),
      field(`cover`, `uuid`, {
        meta: { interface: `file`, special: [`file`] },
      }),
      field(`primary_category`, `string`, {
        meta: { interface: `select-dropdown-m2o` },
        schema: { max_length: 10 },
      }),
    ],
    { accountability: `all`, sort_field: `sort` },
  );

  // Singleton with a non-identifier name.
  await createCollection(
    `site-settings`,
    [
      pk(`id`, `integer`),
      field(`motto`, `string`),
      field(`featured_article`, `integer`, {
        meta: { interface: `select-dropdown-m2o` },
      }),
    ],
    { singleton: true },
  );

  // Junctions
  await createCollection(`article_category`, [
    pk(`id`, `integer`),
    field(`article_id`, `integer`, { meta: { hidden: true } }),
    field(`category_slug`, `string`, {
      meta: { hidden: true },
      schema: { max_length: 10 },
    }),
  ]);
  await createCollection(`article_translations`, [
    pk(`id`, `integer`),
    field(`article_id`, `integer`, { meta: { hidden: true } }),
    field(`languages_code`, `string`, {
      meta: { hidden: true },
      schema: { max_length: 10 },
    }),
    field(`title`, `string`),
    field(`body`, `text`),
  ]);
  await createCollection(`article_blocks`, [
    pk(`id`, `integer`),
    field(`article_id`, `integer`, { meta: { hidden: true } }),
    field(`item`, `string`, { meta: { hidden: true } }),
    field(`collection`, `string`, { meta: { hidden: true } }),
    field(`sort`, `integer`, { meta: { hidden: true } }),
  ]);
  await createCollection(`article_files`, [
    pk(`id`, `integer`),
    field(`article_id`, `integer`, { meta: { hidden: true } }),
    field(`directus_files_id`, `uuid`, { meta: { hidden: true } }),
  ]);

  // Relations: m2o
  await createRelation({
    collection: `article`,
    field: `author`,
    meta: { one_field: `articles` },
    related_collection: `author`,
    schema: { on_delete: `SET NULL` },
  });
  await createRelation({
    collection: `article`,
    field: `primary_category`,
    related_collection: `category`,
    schema: { on_delete: `SET NULL` },
  });
  await createRelation({
    collection: `article`,
    field: `cover`,
    related_collection: `directus_files`,
    schema: { on_delete: `SET NULL` },
  });
  await createRelation({
    collection: `article`,
    field: `user_created`,
    related_collection: `directus_users`,
    schema: { on_delete: `SET NULL` },
  });
  await createRelation({
    collection: `author`,
    field: `avatar`,
    related_collection: `directus_files`,
    schema: { on_delete: `SET NULL` },
  });
  await createRelation({
    collection: `block_image`,
    field: `image`,
    related_collection: `directus_files`,
    schema: { on_delete: `SET NULL` },
  });
  await createRelation({
    collection: `site-settings`,
    field: `featured_article`,
    related_collection: `article`,
    schema: { on_delete: `SET NULL` },
  });
  // o2m alias on author
  await createAliasField(`author`, alias(`articles`, `o2m`, `list-o2m`));

  // m2m
  await createRelation({
    collection: `article_category`,
    field: `category_slug`,
    meta: { junction_field: `article_id` },
    related_collection: `category`,
    schema: { on_delete: `CASCADE` },
  });
  await createRelation({
    collection: `article_category`,
    field: `article_id`,
    meta: { junction_field: `category_slug`, one_field: `categories` },
    related_collection: `article`,
    schema: { on_delete: `CASCADE` },
  });
  await createAliasField(`article`, alias(`categories`, `m2m`, `list-m2m`));

  // files (m2m to directus_files)
  await createRelation({
    collection: `article_files`,
    field: `directus_files_id`,
    meta: { junction_field: `article_id` },
    related_collection: `directus_files`,
    schema: { on_delete: `CASCADE` },
  });
  await createRelation({
    collection: `article_files`,
    field: `article_id`,
    meta: { junction_field: `directus_files_id`, one_field: `gallery` },
    related_collection: `article`,
    schema: { on_delete: `CASCADE` },
  });
  await createAliasField(`article`, alias(`gallery`, `files`, `files`));

  // translations
  await createRelation({
    collection: `article_translations`,
    field: `languages_code`,
    meta: { junction_field: `article_id` },
    related_collection: `languages`,
    schema: { on_delete: `CASCADE` },
  });
  await createRelation({
    collection: `article_translations`,
    field: `article_id`,
    meta: { junction_field: `languages_code`, one_field: `translations` },
    related_collection: `article`,
    schema: { on_delete: `CASCADE` },
  });
  await createAliasField(
    `article`,
    alias(`translations`, `translations`, `translations`),
  );

  // m2a
  await createRelation({
    collection: `article_blocks`,
    field: `item`,
    meta: {
      junction_field: `article_id`,
      one_allowed_collections: [`block_text`, `block_image`],
      one_collection_field: `collection`,
    },
    related_collection: null,
  });
  await createRelation({
    collection: `article_blocks`,
    field: `article_id`,
    meta: { junction_field: `item`, one_field: `blocks`, sort_field: `sort` },
    related_collection: `article`,
    schema: { on_delete: `CASCADE` },
  });
  await createAliasField(`article`, alias(`blocks`, `m2a`, `list-m2a`));

  // Presentation-only field: no column, must not break anything.
  await createAliasField(`article`, {
    field: `divider`,
    meta: { interface: `presentation-divider`, special: [`alias`, `no-data`] },
    type: `alias`,
  });
};

const cli = resolve(__dirname, `cli.mjs`);

const runCli = (args: readonly string[], env: NodeJS.ProcessEnv = {}): string =>
  execFileSync(process.execPath, [cli, ...args], {
    encoding: `utf-8`,
    env: { ...process.env, ...env },
    stdio: [`ignore`, `pipe`, `pipe`],
  });

describeIf(`Directus ${process.env[`DIRECTUS_TEST_VERSION`] ?? ``}`, () => {
  let outDir: string;
  let generated: string;

  beforeAll(async () => {
    await seed();
    outDir = mkdtempSync(join(tmpdir(), `directus-typegen-`));
    generated = runCli([
      `--host`,
      host as string,
      `--token`,
      token,
      `--outFile`,
      join(outDir, `schema.ts`),
    ]);
    generated = readFileSync(join(outDir, `schema.ts`), `utf-8`);
  }, 120_000);

  test(`spec lists the seeded collections with correct singleton flags`, async () => {
    const spec = await readSpecFile({ host, token });
    const collections = listCollections(spec);
    const byName = Object.fromEntries(
      collections.map((c) => [c.collection, c]),
    );
    expect(Object.keys(byName).sort()).toEqual([
      `article`,
      `article_blocks`,
      `article_category`,
      `article_files`,
      `article_translations`,
      `author`,
      `block_image`,
      `block_text`,
      `category`,
      `languages`,
      `site-settings`,
    ]);
    expect(byName[`site-settings`]?.singleton).toBe(true);
    expect(byName[`article`]?.singleton).toBe(false);
    // system collections are present when asked for
    const withSystem = listCollections(spec, { includeSystem: true }).map(
      (c) => c.collection,
    );
    expect(withSystem).toEqual(
      expect.arrayContaining([`directus_users`, `directus_files`, `article`]),
    );
  });

  test(`generated schema type has one entry per collection`, () => {
    expect(generated).toContain(`export type Schema = {`);
    expect(generated).toMatch(/^ {2}article: ItemsArticle\[\];$/m);
    expect(generated).toMatch(/^ {2}"site-settings": ItemsSiteSettings;$/m);
    expect(generated).not.toMatch(/^ {2}content:/m);
  });

  test(`scalar field types`, () => {
    const article =
      /export type ItemsArticle = \{([^}]*)\}/.exec(generated)?.[1] ?? ``;
    const expectLine = (line: string): void => {
      expect(article).toContain(`\n  ${line}\n`);
    };
    expectLine(`id: number;`);
    expectLine(`status: string;`);
    expectLine(`title: string;`);
    expectLine(`body: string | null;`);
    expectLine(`published: boolean | null;`);
    expectLine(`views: number | null;`);
    expectLine(`big_number: number | null;`);
    expectLine(`rating: number | null;`);
    expectLine(`price: number | null;`);
    expectLine(`published_at: string | null;`);
    expectLine(`date_only: string | null;`);
    expectLine(`time_only: string | null;`);
    expectLine(`datetime_local: string | null;`);
    expectLine(`tags: unknown;`);
    expectLine(`csv_field: string[] | null;`);
    expectLine(`external_id: string | null;`);
    expectLine(`secret: string | null;`);
    expectLine(`location: Record<string, unknown> | null;`);
    expectLine(`date_created: string | null;`);
    // presentation-only alias field has no data and must not appear
    expect(article).not.toContain(`divider`);
  });

  test(`relations reference the related types in SDK shape`, () => {
    // m2o to custom collection, to directus_files and to directus_users
    expect(generated).toContain(`author: string | ItemsAuthor | null;`);
    expect(generated).toContain(`cover: string | Files | null;`);
    expect(generated).toContain(`user_created: string | Users | null;`);
    expect(generated).toContain(
      `primary_category: string | ItemsCategory | null;`,
    );
    // o2m / m2m / files / translations / m2a aliases
    expect(generated).toContain(
      `categories: number[] | ItemsArticleCategory[] | null;`,
    );
    expect(generated).toContain(
      `gallery: number[] | ItemsArticleFiles[] | null;`,
    );
    expect(generated).toContain(
      `translations: number[] | ItemsArticleTranslations[] | null;`,
    );
    expect(generated).toContain(
      `blocks: number[] | ItemsArticleBlocks[] | null;`,
    );
    expect(generated).toContain(`articles: number[] | ItemsArticle[] | null;`);
    // junction back-references
    expect(generated).toContain(`article_id: number | ItemsArticle | null;`);
    expect(generated).toContain(
      `category_slug: string | ItemsCategory | null;`,
    );
    expect(generated).toContain(
      `languages_code: string | ItemsLanguages | null;`,
    );
    expect(generated).toContain(`directus_files_id: string | Files | null;`);
    // m2a
    expect(generated).toContain(
      `item: string | ItemsBlockText | ItemsBlockImage | null;`,
    );
    expect(generated).toContain(
      `collection: "block_text" | "block_image" | null;`,
    );
    // singleton relation
    expect(generated).toContain(
      `featured_article: number | ItemsArticle | null;`,
    );
    // referenced system collections are part of the schema, others are not
    expect(generated).toMatch(/^ {2}directus_users: Users\[\];$/m);
    expect(generated).toMatch(/^ {2}directus_files: Files\[\];$/m);
    expect(generated).not.toMatch(/^ {2}directus_settings:/m);
    expect(generated).not.toMatch(/^ {2}directus_activity:/m);
  });

  test(`--includeSystem adds system collections`, () => {
    const out = runCli([`--includeSystem`], {
      DIRECTUS_HOST: host,
      DIRECTUS_TOKEN: token,
    });
    expect(out).toMatch(/^ {2}directus_users: Users\[\];$/m);
    expect(out).toMatch(/^ {2}directus_files: Files\[\];$/m);
    expect(out).toMatch(/^ {2}directus_settings: Settings;$/m);
    expect(out).toContain(`export type Activity = {`);
    expect(out).toMatch(/^ {2}directus_activity: Activity\[\];$/m);
  });

  test(`email/password login works too`, () => {
    const out = runCli([
      `-u`,
      host as string,
      `-e`,
      email,
      `-p`,
      password,
      `-t`,
      `ViaLogin`,
    ]);
    expect(out).toContain(`export type ViaLogin = {`);
  });

  test(`bad token gives a readable error`, () => {
    expect(() => runCli([`-u`, host as string, `-k`, `nope`])).toThrow(
      /HTTP 401|INVALID_CREDENTIALS|FORBIDDEN/,
    );
  });

  test(`generated schema type-checks with @directus/sdk`, () => {
    writeFileSync(
      join(outDir, `usage.ts`),
      `
import { createDirectus, createItem, readItems, readSingleton, rest, updateItem } from "@directus/sdk";
import type { Schema } from "./schema";

const directus = createDirectus<Schema>("http://localhost").with(rest());

export const run = async () => {
  const articles = await directus.request(
    readItems("article", {
      fields: [
        "id",
        "title",
        "published",
        // The SDK narrows nested relations reliably only when they share one object.
        {
          author: ["name", { avatar: ["filename_download"] }],
          user_created: ["email"],
          categories: [{ category_slug: ["label"] }],
          translations: ["title", { languages_code: ["code"] }],
          blocks: ["collection", { item: { block_text: ["text"], block_image: ["caption"] } }],
        },
      ],
      filter: { status: { _eq: "published" }, author: { name: { _contains: "a" } } },
    }),
  );
  const sorted = await directus.request(
    readItems("article", { fields: ["id", "title"], limit: 10, sort: ["-published_at"] }),
  );
  const sortedTitle: string | undefined = sorted[0]?.title;
  const first = articles[0];
  const id: number | undefined = first?.id;
  const title: string | undefined = first?.title;
  const published: boolean | null | undefined = first?.published;
  const authorName: string | null | undefined = first?.author?.name;
  const avatarName: string | null | undefined = first?.author?.avatar?.filename_download;
  const creatorEmail: string | null | undefined = first?.user_created?.email;
  const label: string | null | undefined = first?.categories?.[0]?.category_slug?.label;
  const lang: string | undefined = first?.translations?.[0]?.languages_code?.code;
  const block = first?.blocks?.[0];
  const text: string | null | undefined =
    block?.collection === "block_text" ? block.item?.text : undefined;

  const settings = await directus.request(readSingleton("site-settings", { fields: ["motto", { featured_article: ["title"] }] }));
  const motto: string | null | undefined = settings.motto;
  const featured: string | undefined = settings.featured_article?.title;

  await directus.request(updateItem("article", 1, { title: "x", views: 2, author: null }));
  await directus.request(createItem("category", { slug: "news", label: "News" }));
  return { authorName, avatarName, creatorEmail, featured, id, label, lang, motto, published, sortedTitle, text, title };
};
`,
    );
    writeFileSync(
      join(outDir, `tsconfig.json`),
      JSON.stringify({
        compilerOptions: {
          module: `ESNext`,
          moduleResolution: `Bundler`,
          noEmit: true,
          skipLibCheck: true,
          strict: true,
          target: `ES2022`,
          typeRoots: [resolve(__dirname, `../node_modules/@types`)],
        },
        files: [`schema.ts`, `usage.ts`],
      }),
    );
    // Let the temp project resolve @directus/sdk from our node_modules.
    execFileSync(`ln`, [
      `-sfn`,
      resolve(__dirname, `../node_modules`),
      join(outDir, `node_modules`),
    ]);
    const tsc = resolve(__dirname, `../node_modules/typescript/bin/tsc`);
    const result = spawnSync(process.execPath, [tsc, `-p`, outDir], {
      encoding: `utf-8`,
    });
    expect(result.stdout + result.stderr).toBe(``);
    expect(result.status).toBe(0);
  }, 120_000);
});
