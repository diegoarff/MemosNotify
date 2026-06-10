import { readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { Config } from "./schema.ts";

loadDotenv({ quiet: true });

// Any valid shell env name, not just uppercase — else `${lower_case}` passes through literally as a bogus value.
const ENV_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

// `${VAR}` resolves from process.env.VAR, or from the file at VAR_FILE (the autobrr `_FILE`
// convention for Docker/k8s secret mounts). Runs before Zod validation.
function interpolateEnv(raw: string): string {
  return raw.replace(ENV_RE, (_match, name: string) => {
    const filePath = process.env[`${name}_FILE`];
    if (filePath) {
      try {
        return readFileSync(filePath, "utf8").trim();
      } catch (err) {
        throw new Error(`config references \${${name}}: cannot read ${name}_FILE (${filePath})`, {
          cause: err,
        });
      }
    }
    const value = process.env[name];
    if (value === undefined) {
      throw new Error(`config references \${${name}} but neither ${name} nor ${name}_FILE is set`);
    }
    return value;
  });
}

/** Read config.yaml|json, interpolate env, validate with Zod, fail fast with a readable error. */
export function loadConfig(path = process.env.MEMONUDGE_CONFIG ?? "config.yaml"): Config {
  const abs = resolve(path);
  const raw = interpolateEnv(readFileSync(abs, "utf8"));
  const ext = extname(abs).toLowerCase();
  const data: unknown = ext === ".json" ? JSON.parse(raw) : parseYaml(raw);

  const result = Config.safeParse(data);
  if (!result.success) {
    throw new Error(`Invalid config (${path}):\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
