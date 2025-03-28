import Ajv from 'ajv';
// we just need the types from json-schema
// eslint-disable-next-line import/no-extraneous-dependencies
import { JSONSchema4 } from 'json-schema';
import { SafeReviver } from '../reviver';
import { safeParseJson, download } from '../util';


/**
 *
 *     io.k8s.api.extensions.v1beta1.Deployment
 *     |--------- ^ -------|  ^  ^ ^ |---^----|
 *                |           |  | |     |
 *  - namespace --+           |  | |     |
 *  - major ------------------+  | |     |
 *  - level ---------------------+ |     |
 *  - subversion ------------------+     |
 *  - basename --------------------------+
 */
export interface ApiTypeName {
  basename: string;
  namespace: string;
  fullname: string;
  version?: ApiTypeVersion;
}

interface ApiTypeVersion {
  raw: string;
  level: ApiLevel;
  major: number;
  subversion: number;
}

enum ApiLevel {
  ALPHA = 'alpha',
  BETA = 'beta',
  STABLE = 'stable',
}

/**
 * Parses a fully qualified type name such as to it's components.
 */
export function parseApiTypeName(fullname: string): ApiTypeName {
  const parts = fullname.split('.');
  const type = parts[parts.length - 1];

  const namespace = parts.slice(0, parts.length - 2).join('.');
  const prebase = parts[parts.length - 2];
  const version = /^v([0-9]+)(([a-z]+)([0-9]+))?$/.exec(prebase);
  return {
    fullname: fullname,
    version: version ? {
      raw: version[0],
      major: parseInt(version[1]),
      level: version[3] as ApiLevel ?? ApiLevel.STABLE,
      subversion: parseInt(version[4] ?? '0'),
    } : undefined,
    namespace: version ? namespace : `${namespace}.${prebase}`,
    basename: type,
  };
}

export function safeParseJsonSchema(text: string): JSONSchema4 {
  const reviver = new SafeReviver({
    allowlistedKeys: ['$ref', '$schema'],
    sanitizers: [SafeReviver.DESCRIPTION_SANITIZER, SafeReviver.LEGAL_CHAR_SANITIZER],
  });
  const schema = safeParseJson(text, reviver);
  const ajv = new Ajv();
  ajv.compile(schema);
  return schema;
}

/**
 * Downloads and parses a Kubernetes schema for the specified API version
 * @param apiVersion The Kubernetes API version (e.g., '1.32.0')
 * @returns The parsed Kubernetes schema
 */
export async function downloadSchema(apiVersion: string): Promise<JSONSchema4> {
  const url = `https://raw.githubusercontent.com/cdk8s-team/cdk8s/master/kubernetes-schemas/v${apiVersion}/_definitions.json`;
  let output;
  try {
    output = await download(url);
  } catch (e) {
    console.error(`Could not find a schema for k8s version ${apiVersion}. The current list of available schemas is at https://github.com/cdk8s-team/cdk8s/tree/master/kubernetes-schemas.`);
    throw e;
  }
  try {
    return safeParseJsonSchema(output) as JSONSchema4;
  } catch (e) {
    throw new Error(`Unable to parse schema at ${url}: ${e}`);
  }
}
