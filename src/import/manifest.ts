import * as path from 'path';
import { CodeMaker, toPascalCase } from 'codemaker';
import * as fs from 'fs-extra';
// we just need the types from json-schema
// eslint-disable-next-line import/no-extraneous-dependencies
import { JSONSchema4 } from 'json-schema';
import * as yaml from 'yaml';
import { ImportBase, GenerateOptions } from './base';
import { ImportSpec } from '../config';
import { downloadSchema } from './k8s-util';

/**
 * Represents a Kubernetes manifest object definition
 */
export interface K8sManifestObjectDefinition {
  readonly apiVersion: string;
  readonly kind: string;
  readonly metadata: {
    readonly name: string;
    readonly [key: string]: any;
  };
  readonly [key: string]: any;
}

/**
 * Options for importing Kubernetes manifests
 */
export interface ImportK8sManifestOptions {
  /**
   * The source of the manifest (file or directory)
   */
  readonly source: string;

  /**
   * The Kubernetes API version to use for type information
   * @default '1.32.0'
   */
  readonly k8sApiVersion?: string;
}

/**
 * Imports Kubernetes manifests into cdk8s constructs
 */
export class ImportK8sManifest extends ImportBase {
  /**
   * Creates a new instance of ImportK8sManifest from an import spec
   */
  public static fromSpec(importSpec: ImportSpec): ImportK8sManifest {
    const { source } = importSpec;

    if (!fs.existsSync(source)) {
      throw new Error(`Source file or directory not found: ${source}`);
    }

    let manifestContent = '';

    if (fs.statSync(source).isDirectory()) {
      // If source is a directory, read all YAML/JSON files in it
      const files = fs.readdirSync(source)
        .filter(file => file.endsWith('.yaml') || file.endsWith('.yml') || file.endsWith('.json'))
        .map(file => path.join(source, file));

      manifestContent = files.map(file => fs.readFileSync(file, 'utf-8')).join('\n---\n');
    } else {
      // If source is a file, read it directly
      manifestContent = fs.readFileSync(source, 'utf-8');
    }

    return new ImportK8sManifest(manifestContent);
  }

  /**
   * Matches an import spec to determine if it's a Kubernetes manifest
   */
  public static async match(importSpec: ImportSpec, argv: any): Promise<ImportK8sManifestOptions | undefined> {
    const { source } = importSpec;

    // Check if the source exists
    if (!fs.existsSync(source)) {
      return undefined;
    }

    // If it's a directory, check if it contains YAML/JSON files
    if (fs.statSync(source).isDirectory()) {
      const files = fs.readdirSync(source);
      const hasManifestFiles = files.some(file =>
        file.endsWith('.yaml') || file.endsWith('.yml') || file.endsWith('.json'),
      );

      if (!hasManifestFiles) {
        return undefined;
      }
    } else {
      // If it's a file, check if it's a YAML/JSON file
      if (!source.endsWith('.yaml') && !source.endsWith('.yml') && !source.endsWith('.json')) {
        return undefined;
      }

      // Try to parse the file as a Kubernetes manifest
      try {
        const content = fs.readFileSync(source, 'utf-8');
        const objects = safeParseManifest(content);

        // Check if any objects were parsed
        if (objects.length === 0) {
          return undefined;
        }

        // Check if the objects have the required Kubernetes manifest fields
        const isK8sManifest = objects.every(obj =>
          obj.apiVersion && obj.kind && obj.metadata && obj.metadata.name,
        );

        if (!isK8sManifest) {
          return undefined;
        }
      } catch (e) {
        return undefined;
      }
    }

    return {
      source,
      k8sApiVersion: argv.k8sApiVersion || '1.32.0',
    };
  }

  private readonly options: ImportK8sManifestOptions = { source: '' };
  private readonly objects: K8sManifestObjectDefinition[] = [];

  private schema?: JSONSchema4;

  /**
   * Creates a new instance of ImportK8sManifest from a manifest content string
   */
  constructor(manifestContent: string, options?: ImportK8sManifestOptions) {
    super();
    this.objects = safeParseManifest(manifestContent);
    if (options) {
      this.options = options;
    }
  }
  /**
   * Returns the module names for the imported manifests
   */
  public get moduleNames() {
    return ['k8s-manifest'];
  }

  /**
   * Generates TypeScript code for the imported manifests
   */
  protected async generateTypeScript(code: CodeMaker, _moduleName: string, options: GenerateOptions) {
    // Download the schema once
    this.schema = await downloadSchema(this.options.k8sApiVersion || '1.32.0');

    // Import cdk8s-plus-32 for Kubernetes constructs
    code.line("import * as cp32 from 'cdk8s-plus-32';");
    code.line();

    // Generate a class for each object in the manifest
    for (const obj of this.objects) {
      await this.generateManifestClass(code, obj, options);
    }
  }

  /**
   * Generates a TypeScript class for a Kubernetes manifest object
   */
  private async generateManifestClass(code: CodeMaker, obj: K8sManifestObjectDefinition, options: GenerateOptions) {
    const { apiVersion, kind, metadata } = obj;
    const name = metadata.name;

    // Convert the name to a valid class name
    // Sanitize the name by replacing invalid characters with underscores before converting to PascalCase
    const sanitizedName = name.replace(/[^a-zA-Z0-9_-]/g, '_');
    const className = `${toPascalCase(kind)}${toPascalCase(sanitizedName)}`;

    // Determine the base class based on the apiVersion and kind
    const baseClass = this.getBaseClass(apiVersion, kind, options);

    // Skip this resource if the base class is empty (unsupported API and flag not set)
    if (!baseClass) {
      return;
    }

    // Generate class documentation
    code.line('/**');
    code.line(` * Represents a ${kind} resource from the imported manifest.`);
    code.line(` * Original name: ${name}`);
    code.line(` * Original apiVersion: ${apiVersion}`);
    code.line(' */');

    // Generate the class definition
    code.openBlock(`export class ${className} extends ${baseClass}`);

    // Generate the static GetProps method
    code.line();
    code.openBlock(`public static defaultProps(): ${baseClass}Props`);

    // Return the props object
    code.open('return {');

    // Add metadata
    code.open('metadata: {');
    code.line(`name: "${name}",`);

    // Add other metadata properties
    for (const [key, value] of Object.entries(metadata)) {
      if (key !== 'name' && key !== 'annotations' && key !== 'labels') {
        code.line(`${key}: ${JSON.stringify(value)},`);
      }
    }

    // Add labels if present
    if (metadata.labels) {
      code.line('labels:     {');
      for (const [key, value] of Object.entries(metadata.labels)) {
        code.line(`"${key}": ${JSON.stringify(value)},`);
      }
      code.line('},');
    }

    // Add annotations if present
    if (metadata.annotations) {
      code.line('annotations: {');
      for (const [key, value] of Object.entries(metadata.annotations)) {
        code.line(`"${key}": ${JSON.stringify(value)},`);
      }
      code.line('},');
    }

    code.close('},');

    // Add spec and other properties
    for (const [key, value] of Object.entries(obj)) {
      if (key !== 'apiVersion' && key !== 'kind' && key !== 'metadata') {
        code.line(`${key}:   ${this.formatValue(value, apiVersion, kind, key)},`);
      }
    }

    code.close('}');
    code.closeBlock();

    // Generate the constructor
    code.openBlock('constructor(scope: import(\'constructs\').Construct, id: string)');

    // Call the super constructor with the DefaultProps method
    code.line(`super(scope, id, ${className}.defaultProps());`);
    code.closeBlock();
    code.closeBlock();
    code.line();
  }

  /**
   * Gets the base class for a Kubernetes resource
   */
  private getBaseClass(apiVersion: string, kind: string, options: GenerateOptions): string {

    // Handle special cases for certain resources
    if (apiVersion === 'autoscaling/v2' && kind === 'HorizontalPodAutoscaler') {
      return 'cp32.k8s.KubeHorizontalPodAutoscalerV2';
    }

    // Default class name with Kube prefix
    const baseClass = `cp32.k8s.Kube${kind}`;

    // List of known supported Kubernetes resources in cdk8s-plus-32
    // This is a simplified approach - in a real implementation, we might want to
    // dynamically generate this list or check against a schema
    const supportedResources = [
      'Deployment', 'Service', 'ConfigMap', 'Secret', 'Pod', 'Namespace',
      'StatefulSet', 'DaemonSet', 'Job', 'CronJob', 'Ingress', 'PersistentVolume',
      'PersistentVolumeClaim', 'ServiceAccount', 'Role', 'RoleBinding',
      'ClusterRole', 'ClusterRoleBinding', 'HorizontalPodAutoscaler',
      'NetworkPolicy', 'PodDisruptionBudget', 'ReplicaSet', 'ReplicationController',
    ];

    // Check if the resource is supported
    if (supportedResources.includes(kind)) {
      return baseClass;
    }

    // If the resource is not supported
    if (!options.unsupported) {
      // Log a warning and return an empty string to indicate that this resource should be skipped
      console.warn(`Unsupported API type: ${apiVersion}/${kind}. Use --unsupported flag to include it anyway.`);
      return '';
    } else {
      // If unsupported flag is set, log a verbose message and use the original class
      console.log(`Verbose: Using unsupported API type: ${apiVersion}/${kind}`);
      return baseClass;
    }
  }

  /**
   * Formats a value for inclusion in the generated TypeScript code
   */
  private formatValue(value: any, apiVersion: string, kind: string, fieldPath: string): string {
    if (value === null || value === undefined) {
      return 'undefined';
    }

    const schemaType = this.getTypeFromSchema(apiVersion, kind, fieldPath);

    if (schemaType === 'io.k8s.apimachinery.pkg.api.resource.Quantity' && typeof value === 'string') {
      return `cp32.k8s.Quantity.fromString("${value}")`;
    }

    if (schemaType === 'io.k8s.apimachinery.pkg.util.intstr.IntOrString') {
      if (typeof value === 'string') {
        return `cp32.k8s.IntOrString.fromString("${value}")`;
      } else if (typeof value === 'number') {
        return `cp32.k8s.IntOrString.fromNumber(${value})`;
      }
    }

    // Handle regular types
    if (typeof value === 'string') {
      // Properly escape special characters in strings, especially for shell scripts
      let escapedValue = value;

      // First escape backslashes
      escapedValue = escapedValue.replace(/\\/g, '\\\\');

      // Escape newlines
      escapedValue = escapedValue.replace(/\n/g, '\\n');

      // Escape double quotes
      escapedValue = escapedValue.replace(/"/g, '\\"');

      // Escape dollar signs to prevent template string interpolation issues
      escapedValue = escapedValue.replace(/\$/g, '\\$');

      return `"${escapedValue}"`;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return value.toString();
    }

    if (Array.isArray(value)) {
      if (value.length === 0) {
        return '[]';
      }

      return `[\n${value.map((item, index) => this.formatValue(item, apiVersion, kind, `${fieldPath}[${index}]`)).join(',\n')}\n]`;
    }

    if (typeof value === 'object') {
      const entries = Object.entries(value);
      if (entries.length === 0) {
        return '{}';
      }

      const formattedEntries = entries.map(([k, v]) => {
        const formattedValue = this.formatValue(v, apiVersion, kind, `${fieldPath}.${k}`);

        // Convert property names to match TypeScript interface expectations
        // This handles cases like "hostIPC" -> "hostIpc" and "nonResourceURLs" -> "nonResourceUrls"
        let propertyName = k;

        // Handle properties with acronyms (like IPC, URL, UUID, etc.)
        // The pattern is to convert acronyms to have only the first letter capitalized
        // For example: "hostIPC" -> "hostIpc", "nonResourceURLs" -> "nonResourceUrls"

        // Common acronyms in Kubernetes API
        const acronyms = [
          { pattern: 'IPC', replacement: 'Ipc' },
          { pattern: 'URL', replacement: 'Url' },
          { pattern: 'URLs', replacement: 'UrLs' },
          { pattern: 'ID', replacement: 'Id' },
          { pattern: 'UUID', replacement: 'Uuid' },
          { pattern: 'URI', replacement: 'Uri' },
          { pattern: 'API', replacement: 'Api' },
          { pattern: 'TLS', replacement: 'Tls' },
          { pattern: 'CIDR', replacement: 'Cidr' },
          { pattern: 'CIDRs', replacement: 'Cidrs' },
          { pattern: 'PID', replacement: 'Pid' },
          { pattern: 'IP', replacement: 'Ip' },
          { pattern: 'IPs', replacement: 'Ips' },
          { pattern: 'IO', replacement: 'Io' },
          { pattern: 'FQDN', replacement: 'Fqdn' },
        ];

        // Apply the replacements
        for (const { pattern, replacement } of acronyms) {
          // Use a regex to find the acronym in the property name
          // The regex ensures we only match whole acronyms, not parts of words
          const regex = new RegExp(`([a-z])(${pattern})([^a-zA-Z]|$)`, 'g');
          propertyName = propertyName.replace(regex, (_, prefix, _acronym, suffix) => {
            return `${prefix}${replacement}${suffix}`;
          });

          // Also handle the case where the acronym is at the beginning of the property name
          const startRegex = new RegExp(`^(${pattern})([^a-zA-Z]|$)`, 'g');
          propertyName = propertyName.replace(startRegex, (_, _acronym, suffix) => {
            return `${replacement}${suffix}`;
          });
        }

        return `"${propertyName}": ${formattedValue}`;
      });

      return `{\n${formattedEntries.join(',\n')}\n}`;
    }

    return JSON.stringify(value);
  }

  /**
   * Gets the type of a field from the Kubernetes schema
   */
  private getTypeFromSchema(apiVersion: string, kind: string, fieldPath: string): string | undefined {
    try {
      // Load the Kubernetes schema
      const schemaPath = path.resolve(process.cwd(), 'k8s-v1.32.0.json');
      if (!fs.existsSync(schemaPath)) {
        return undefined;
      }

      // Define types for schema objects
      interface SchemaRef {
        $ref?: string;
        type?: string;
        items?: SchemaRef;
        [key: string]: any;
      }

      interface SchemaProperty {
        $ref?: string;
        type?: string;
        items?: SchemaRef;
        properties?: Record<string, SchemaProperty>;
        additionalProperties?: SchemaRef;
        [key: string]: any;
      }

      interface SchemaDefinition {
        $ref?: string;
        type?: string;
        properties?: Record<string, SchemaProperty>;
        items?: SchemaRef;
        'x-kubernetes-group-version-kind'?: Array<{
          group: string;
          version: string;
          kind: string;
        }>;
        [key: string]: any;
      }


      if (!this.schema?.definitions) {
        return undefined;
      }

      // Extract group and version from apiVersion
      let group = '';
      let version = apiVersion;

      if (apiVersion.includes('/')) {
        [group, version] = apiVersion.split('/');
      } else if (apiVersion !== 'v1') {
        // Core apiVersion 'v1' has no group
        return undefined;
      }

      // Find the definition for this resource type
      let resourceDefinition: SchemaDefinition | undefined;

      // Search through all definitions to find the one with matching group-version-kind
      for (const [_defName, definition] of Object.entries(this.schema.definitions)) {
        const gvk = definition['x-kubernetes-group-version-kind'];
        if (gvk) {
          for (const entry of gvk) {
            if (
              entry.kind === kind &&
              entry.version === version &&
              (group === '' ? !entry.group || entry.group === 'core' : entry.group === group)
            ) {
              resourceDefinition = definition as unknown as SchemaDefinition;
              break;
            }
          }
        }

        if (resourceDefinition) break;
      }

      if (!resourceDefinition) {
        return undefined;
      }

      // Navigate through the field path to find the type
      const pathParts = fieldPath.split('.');
      let currentDef: SchemaDefinition | SchemaProperty = resourceDefinition;

      for (const part of pathParts) {
        // Handle array indexing (e.g., containers[0])
        const arrayMatch = part.match(/^([^\[]+)\[(\d+)\]$/);
        if (arrayMatch) {
          const arrayName = arrayMatch[1];

          // If we don't have properties, we can't navigate further
          if (!('properties' in currentDef) || !currentDef.properties) {
            return undefined;
          }

          // Get the array property
          const arrayProp = currentDef.properties[arrayName];
          if (!arrayProp) {
            return undefined;
          }

          // Handle array items
          if (arrayProp.items) {
            if (arrayProp.items.$ref) {
              // Follow the reference
              const refPath = arrayProp.items.$ref;
              const refName = refPath.replace('#/definitions/', '');
              currentDef = this.schema.definitions[refName] as SchemaDefinition;
            } else if (arrayProp.items.type === 'string' || arrayProp.items.type === 'number') {
              // For primitive arrays, return the type
              return arrayProp.items.type === 'string' ? 'string' : 'number';
            } else {
              // Use the items schema directly
              currentDef = arrayProp.items as SchemaDefinition;
            }
          } else {
            return undefined;
          }
        } else {
          // Regular property access

          // If we don't have properties, check if we have additionalProperties
          if (!('properties' in currentDef) || !currentDef.properties) {
            // Check if this is a reference to a special type
            if ('$ref' in currentDef && currentDef.$ref) {
              return currentDef.$ref.replace('#/definitions/', '');
            }

            // Check if we have additionalProperties
            if ('additionalProperties' in currentDef && currentDef.additionalProperties) {
              // If this is the last part of the path, return the type from additionalProperties
              if (pathParts.indexOf(part) === pathParts.length - 1) {
                if (currentDef.additionalProperties.$ref) {
                  return currentDef.additionalProperties.$ref.replace('#/definitions/', '');
                }
              }
              // If not the last part, we need to continue with the additionalProperties schema
              const refPath = currentDef.additionalProperties.$ref;
              if (refPath) {
                const refName = refPath.replace('#/definitions/', '');
                currentDef = this.schema.definitions[refName] as SchemaDefinition;
                continue;
              }
            }

            return undefined;
          }


          // If the current definition has additionalProperties and no properties,
          // this is a special case for objects like limits that can have any property name
          if (!currentDef.properties && 'additionalProperties' in currentDef && currentDef.additionalProperties) {
            if ('$ref' in currentDef.additionalProperties && currentDef.additionalProperties.$ref) {
              const result = currentDef.additionalProperties.$ref.replace('#/definitions/', '');
              return result;
            }
          }

          // Get the property
          const prop = currentDef.properties ? currentDef.properties[part] : undefined;

          // If the property is not found but the current definition has additionalProperties,
          // use the type from additionalProperties
          if (!prop && 'additionalProperties' in currentDef && currentDef.additionalProperties) {
            if ('$ref' in currentDef.additionalProperties && currentDef.additionalProperties.$ref) {
              const result = currentDef.additionalProperties.$ref.replace('#/definitions/', '');
              return result;
            }
          }

          // If the property is still not found, return undefined
          if (!prop) {
            return undefined;
          }

          // If the property has additionalProperties, store them for the next part
          if ('additionalProperties' in prop && prop.additionalProperties) {
            // Store the additionalProperties for the next part
            currentDef = {
              additionalProperties: prop.additionalProperties,
            };
            continue;
          }

          // Follow references
          if (prop.$ref) {
            const refPath = prop.$ref;
            const refName = refPath.replace('#/definitions/', '');
            currentDef = this.schema.definitions[refName] as SchemaDefinition;
          } else {
            currentDef = prop;
          }
        }
      }

      // Check if we found a reference to a special type
      if ('$ref' in currentDef && currentDef.$ref) {
        return currentDef.$ref.replace('#/definitions/', '');
      }

      // For additionalProperties (like in resources.limits), check the value type
      if ('additionalProperties' in currentDef) {
        if (currentDef.additionalProperties &&
          '$ref' in currentDef.additionalProperties &&
          currentDef.additionalProperties.$ref) {
          return currentDef.additionalProperties.$ref.replace('#/definitions/', '');
        }
      }

      // If the current definition is a reference, return the reference
      if ('$ref' in currentDef && currentDef.$ref) {
        return currentDef.$ref.replace('#/definitions/', '');
      }

      // Check if this is a special type by its name
      // This handles cases where we've followed a reference to a special type
      let defName: string | undefined;
      if (this.schema && this.schema.definitions) {
        defName = Object.keys(this.schema.definitions).find(name =>
          this.schema!.definitions![name] === currentDef,
        );
      }

      if (defName) {
        return defName;
      }


      // For array types, check the items type
      if ('items' in currentDef && currentDef.items) {
        if (currentDef.items.$ref) {
          return currentDef.items.$ref.replace('#/definitions/', '');
        } else if (currentDef.items.type) {
          return currentDef.items.type;
        }
      }

      // For primitive types, return the type
      if ('type' in currentDef && currentDef.type) {
        return currentDef.type;
      }

      return undefined;
    } catch (error) {
      return undefined;
    }
  }
}

/**
 * Safely parses a Kubernetes manifest string into an array of objects
 */
export function safeParseManifest(manifestContent: string): K8sManifestObjectDefinition[] {
  const objects: K8sManifestObjectDefinition[] = [];

  // Split the manifest into documents (separated by ---)
  const documents = manifestContent.split(/^---$/m).filter(doc => doc.trim());

  for (const doc of documents) {
    try {
      const obj = yaml.parse(doc) as K8sManifestObjectDefinition;

      // Skip empty documents or non-object documents
      if (!obj || typeof obj !== 'object') {
        continue;
      }

      // Skip documents without required Kubernetes fields
      if (!obj.apiVersion || !obj.kind || !obj.metadata || !obj.metadata.name) {
        continue;
      }

      objects.push(obj);
    } catch (e) {
      console.warn(`Warning: Failed to parse manifest document: ${e}`);
    }
  }

  return objects;
}