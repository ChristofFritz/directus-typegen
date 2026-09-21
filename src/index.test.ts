import { generateTypeScript, listCollections } from ".";

const itemsPath = (schema: string, singleton: boolean): unknown => ({
  get: {
    responses: {
      "200": {
        content: {
          "application/json": {
            schema: {
              properties: {
                data: singleton
                  ? { $ref: `#/components/schemas/${schema}` }
                  : {
                      items: { $ref: `#/components/schemas/${schema}` },
                      type: `array`,
                    },
              },
              type: `object`,
            },
          },
        },
      },
    },
  },
});

const m2o = (ref: string, keyType = `string`): unknown => ({
  nullable: true,
  oneOf: [{ type: keyType }, { $ref: `#/components/schemas/${ref}` }],
});

const o2m = (ref: string): unknown => ({
  items: {
    oneOf: [{ type: `integer` }, { $ref: `#/components/schemas/${ref}` }],
  },
  nullable: true,
  type: `array`,
});

const spec = {
  components: {
    schemas: {
      ItemsArticle: {
        "properties": {
          author: m2o(`ItemsAuthor`),
          blocks: o2m(`ItemsArticleBlocks`),
          id: { nullable: false, type: `integer` },
          published: { nullable: true, type: `boolean` },
          tags: { nullable: true },
          title: { nullable: false, type: `string` },
          user_created: m2o(`Users`),
        },
        "type": `object`,
        "x-collection": `article`,
      },
      ItemsArticleBlocks: {
        "properties": {
          article_id: m2o(`ItemsArticle`, `integer`),
          collection: { nullable: true, type: `string` },
          id: { nullable: false, type: `integer` },
          item: {
            items: {
              oneOf: [
                { type: `string` },
                { $ref: `#/components/schemas/ItemsBlockText` },
                { $ref: `#/components/schemas/ItemsBlockImage` },
              ],
            },
            nullable: true,
            type: `array`,
          },
        },
        "type": `object`,
        "x-collection": `article_blocks`,
      },
      ItemsAuthor: {
        "properties": { id: { nullable: false, type: `string` } },
        "type": `object`,
        "x-collection": `author`,
      },
      ItemsBlockImage: {
        "properties": { id: { type: `integer` } },
        "type": `object`,
        "x-collection": `block_image`,
      },
      ItemsBlockText: {
        "properties": { id: { type: `integer` } },
        "type": `object`,
        "x-collection": `block_text`,
      },
      ItemsSiteSettings: {
        "properties": { id: { type: `integer` }, motto: { type: `string` } },
        "type": `object`,
        "x-collection": `site-settings`,
      },
      Roles: {
        "properties": { id: { type: `string` } },
        "type": `object`,
        "x-collection": `directus_roles`,
      },
      Settings: {
        "properties": { id: { type: `integer` } },
        "type": `object`,
        "x-collection": `directus_settings`,
      },
      Users: {
        "properties": {
          id: { type: `string` },
          role: m2o(`Roles`),
          status: { enum: [`active`, `invited`], type: `string` },
        },
        "type": `object`,
        "x-collection": `directus_users`,
      },
    },
  },
  info: { title: `Test`, version: `12.3.1` },
  openapi: `3.0.1`,
  paths: {
    "/items/article": itemsPath(`ItemsArticle`, false),
    "/items/article/{id}": itemsPath(`ItemsArticle`, true),
    "/items/site-settings": itemsPath(`ItemsSiteSettings`, true),
    "/settings": itemsPath(`Settings`, true),
    "/users": itemsPath(`Users`, false),
    "/users/me": itemsPath(`Users`, true),
  },
};

describe(`listCollections`, () => {
  test(`finds collections and singletons, skips system by default`, () => {
    expect(
      listCollections(spec).map((c) => [c.collection, c.singleton]),
    ).toEqual([
      [`article`, false],
      [`article_blocks`, false],
      [`author`, false],
      [`block_image`, false],
      [`block_text`, false],
      [`site-settings`, true],
    ]);
  });

  test(`includes system collections on request; only settings is a singleton`, () => {
    const system = listCollections(spec, { includeSystem: true }).filter(
      (c) => c.system,
    );
    expect(system.map((c) => [c.collection, c.singleton])).toEqual([
      [`directus_roles`, false],
      [`directus_settings`, true],
      [`directus_users`, false],
    ]);
  });
});

describe(`generateTypeScript`, () => {
  const ts = generateTypeScript(spec, { typeName: `MySchema` });

  test(`emits schema type with arrays for collections and objects for singletons`, () => {
    expect(ts).toContain(
      `export type MySchema = {\n  article: ItemsArticle[];\n  article_blocks: ItemsArticleBlocks[];\n  author: ItemsAuthor[];\n  block_image: ItemsBlockImage[];\n  block_text: ItemsBlockText[];\n  directus_roles: Roles[];\n  directus_users: Users[];\n  "site-settings": ItemsSiteSettings;\n};\n`,
    );
  });

  test(`emits SDK-shaped relation types`, () => {
    expect(ts).toContain(`author: string | ItemsAuthor | null;`);
    expect(ts).toContain(`user_created: string | Users | null;`);
    expect(ts).toContain(`blocks: number[] | ItemsArticleBlocks[] | null;`);
    expect(ts).toContain(
      `item: string | ItemsBlockText | ItemsBlockImage | null;`,
    );
    expect(ts).toContain(`collection: "block_text" | "block_image" | null;`);
    expect(ts).toContain(`tags: unknown;`);
    expect(ts).toContain(`published: boolean | null;`);
    expect(ts).toContain(`title: string;`);
  });

  test(`only referenced system collections are included by default`, () => {
    expect(ts).toContain(`export type Users = {`);
    expect(ts).toContain(`status: "active" | "invited";`);
    expect(ts).toContain(`export type Roles = {`);
    expect(ts).not.toContain(`export type Settings`);
    expect(ts).not.toMatch(/^ {2}directus_settings:/m);
  });

  test(`includeSystem lists system collections`, () => {
    const out = generateTypeScript(spec, {
      includeSystem: true,
      typeName: `S`,
    });
    expect(out).toContain(`  directus_users: Users[];\n`);
    expect(out).toContain(`  directus_settings: Settings;\n`);
  });

  test(`rejects invalid type name`, () => {
    expect(() => generateTypeScript(spec, { typeName: `1bad` })).toThrow(
      /Invalid type name/,
    );
  });
});
