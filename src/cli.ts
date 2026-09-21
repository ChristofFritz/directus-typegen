#!/usr/bin/env node

import { writeFile } from "fs/promises";
import { resolve } from "path";

import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { generateTypeScript, readSpecFile } from ".";

const fromEnv = (
  name: string,
): { default?: string; defaultDescription?: string } => {
  const value = process.env[name];
  return value === undefined || value.length === 0
    ? {}
    : { default: value, defaultDescription: `$${name}` };
};

const main = async (): Promise<void> => {
  const argv = await yargs(hideBin(process.argv))
    .scriptName(`directus-typegen`)
    .usage(
      `$0 [options]\n\nGenerate a TypeScript schema for the Directus SDK from an OpenAPI spec file or a running Directus server.\n\nConnection options can also be set via environment variables: DIRECTUS_HOST, DIRECTUS_TOKEN, DIRECTUS_EMAIL, DIRECTUS_PASSWORD.`,
    )
    .options({
      email: {
        ...fromEnv(`DIRECTUS_EMAIL`),
        alias: `e`,
        description: `Email address (with --password, alternative to --token)`,
        type: `string`,
      },
      host: {
        ...fromEnv(`DIRECTUS_HOST`),
        alias: `u`,
        description: `Directus server URL, e.g. http://localhost:8055`,
        type: `string`,
      },
      includeSystem: {
        alias: `s`,
        default: false,
        description: `Include system collections (directus_users, directus_files, ...)`,
        type: `boolean`,
      },
      outFile: {
        alias: `o`,
        description: `Output file (defaults to stdout)`,
        type: `string`,
      },
      password: {
        ...fromEnv(`DIRECTUS_PASSWORD`),
        alias: `p`,
        description: `Password`,
        type: `string`,
      },
      specFile: {
        alias: `i`,
        description: `Input OpenAPI spec file (alternative to --host)`,
        type: `string`,
      },
      token: {
        ...fromEnv(`DIRECTUS_TOKEN`),
        alias: `k`,
        description: `Static access token of a Directus user (alternative to --email/--password)`,
        type: `string`,
      },
      typeName: {
        alias: `t`,
        default: `Schema`,
        description: `Name of the exported schema type`,
        type: `string`,
      },
    })
    .conflicts(`specFile`, [`host`, `token`, `email`, `password`])
    .conflicts(`token`, [`email`, `password`])
    .implies(`email`, `password`)
    .implies(`password`, `email`)
    .check((args) => {
      if (args.specFile === undefined && args.host === undefined) {
        throw new Error(`Either --specFile or --host is required`);
      }
      if (
        args.host !== undefined &&
        args.token === undefined &&
        args.email === undefined
      ) {
        throw new Error(`--host requires --token or --email/--password`);
      }
      return true;
    })
    .example(`$0 -i directus.oas.json -o schema.d.ts`, `From a spec file`)
    .example(
      `$0 -u http://localhost:8055 -k <token> -o schema.d.ts`,
      `From a server with a static token`,
    )
    .example(
      `$0 -u http://localhost:8055 -e admin@example.com -p secret`,
      `From a server with email/password, print to stdout`,
    )
    .strict()
    .showHelpOnFail(false, `Run with --help for usage`)
    .help()
    .alias(`help`, `h`)
    .parse();

  const spec = await readSpecFile(argv);

  const ts = generateTypeScript(spec, {
    includeSystem: argv.includeSystem,
    typeName: argv.typeName,
  });

  if (typeof argv.outFile === `string`) {
    await writeFile(resolve(process.cwd(), argv.outFile), ts, {
      encoding: `utf-8`,
    });
  } else {
    process.stdout.write(ts);
  }
};

const describeError = (error: unknown): string => {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const cause = error.cause instanceof Error ? ` (${error.cause.message})` : ``;
  return `${error.message}${cause}`;
};

main().catch((error: unknown) => {
  console.error(describeError(error));
  process.exit(1);
});
