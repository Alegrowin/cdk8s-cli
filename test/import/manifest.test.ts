import * as path from 'path';
import { CodeMaker } from 'codemaker';
import * as fs from 'fs-extra';
import { ImportSpec } from '../../src/config';
import { downloadSchema } from '../../src/import/k8s-util';
import { ImportK8sManifest, safeParseManifest } from '../../src/import/manifest';

describe('ImportK8sManifest', () => {
  const fixturesDir = path.join(__dirname, 'fixtures', 'k8s-manifest');
  const manifestPath = path.join(fixturesDir, 'deployment.yaml');
  const manifestContent = fs.readFileSync(manifestPath, 'utf-8');

  describe('safeParseManifest', () => {
    it('parses multiple resources correctly', () => {
      const objects = safeParseManifest(manifestContent);

      // Verify we have the expected number of objects (4 in the fixture)
      expect(objects).toHaveLength(4);

      // Verify the types of objects
      expect(objects[0].kind).toBe('Deployment');
      expect(objects[1].kind).toBe('Service');
      expect(objects[2].kind).toBe('Ingress');
      expect(objects[3].kind).toBe('HorizontalPodAutoscaler');

      // Verify some specific fields to ensure parsing worked correctly
      expect(objects[0].spec.replicas).toBe(3);
      expect(objects[1].spec.type).toBe('ClusterIP');
      expect(objects[2].spec.rules[0].http.paths[0].pathType).toBe('Prefix');
      expect(objects[3].spec.maxReplicas).toBe(10);
    });

    it('correctly parses manifests with multiline args', () => {
      // Load the multiline args manifest
      const multilineArgsPath = path.join(fixturesDir, 'multiline-args.yaml');
      const multilineArgsContent = fs.readFileSync(multilineArgsPath, 'utf-8');

      const objects = safeParseManifest(multilineArgsContent);

      // Verify we have the expected number of objects (1 in the fixture)
      expect(objects).toHaveLength(1);

      // Verify the type of object
      expect(objects[0].kind).toBe('Deployment');
      expect(objects[0].metadata.name).toBe('nginx-deployment');

      // Verify the command and args are parsed correctly
      expect(objects[0].spec.template.spec.containers[0].command).toEqual(['/bin/bash']);

      // Verify the multiline args are parsed correctly
      const args = objects[0].spec.template.spec.containers[0].args;
      expect(args).toHaveLength(2);
      expect(args[0]).toBe('-ec');

      // The second arg should be a multiline string
      expect(typeof args[1]).toBe('string');
      expect(args[1]).toContain('#!/bin/bash');
      expect(args[1]).toContain('. /opt/bitnami/scripts/libfs.sh');
      expect(args[1]).toContain('if ! is_dir_empty /opt/bitnami/nginx/logs; then');
      expect(args[1]).toContain('cp -r /opt/bitnami/nginx/logs /emptydir/app-logs-dir');
      expect(args[1]).toContain('fi');
    });

    it('correctly parses ConfigMap with multiline data using pipe and pipe-dash syntax', () => {
      // Load the multiline ConfigMap manifest
      const multilineConfigMapPath = path.join(fixturesDir, 'multiline-configmap.yaml');
      const multilineConfigMapContent = fs.readFileSync(multilineConfigMapPath, 'utf-8');

      const objects = safeParseManifest(multilineConfigMapContent);

      // Verify we have the expected number of objects (1 in the fixture)
      expect(objects).toHaveLength(2);

      // Verify the type of object
      expect(objects[0].kind).toBe('ConfigMap');
      expect(objects[1].kind).toBe('ConfigMap');
      expect(objects[0].metadata.name).toBe('multiline-configmap');
      expect(objects[1].metadata.name).toBe('my-argo-cd-argocd-redis-health-configmap');

      // Verify the data field contains all the expected keys
      expect(objects[0].data).toBeDefined();
      expect(Object.keys(objects[0].data)).toHaveLength(4);
      expect(objects[0].data['script.sh']).toBeDefined();
      expect(objects[0].data['config.properties']).toBeDefined();
      expect(objects[0].data.API_URL).toBeDefined();
      expect(objects[0].data['app-config.json']).toBeDefined();

      // Verify the pipe (|) syntax content is parsed correctly with preserved newlines
      const scriptContent = objects[0].data['script.sh'];
      expect(typeof scriptContent).toBe('string');
      expect(scriptContent).toContain('#!/bin/bash');
      expect(scriptContent).toContain('echo "Starting script"');
      expect(scriptContent).toContain('if [ -d "/data" ]; then');
      expect(scriptContent).toContain('echo "Data directory exists"');
      expect(scriptContent).toContain('echo "Creating data directory"');
      expect(scriptContent).toContain('mkdir -p /data');
      expect(scriptContent).toContain('echo "Script completed"');

      // Verify the pipe-dash (|-) syntax content is parsed correctly
      const configContent = objects[0].data['config.properties'];
      expect(typeof configContent).toBe('string');
      expect(configContent).toContain('# Database configuration');
      expect(configContent).toContain('db.host=localhost');
      expect(configContent).toContain('db.port=5432');
      expect(configContent).toContain('app.log.level=INFO');
      expect(configContent).toContain('app.max_connections=100');

      // Verify the JSON data is parsed correctly
      const jsonContent = objects[0].data['app-config.json'];
      expect(typeof jsonContent).toBe('string');
      expect(jsonContent).toContain('"name": "my-application"');
      expect(jsonContent).toContain('"version": "1.0.0"');
      expect(jsonContent).toContain('"authentication": true');

      const redisLiveness = objects[1].data['redis_liveness.sh'];
      const redisReadiness = objects[1].data['redis_readiness.sh'];

      // Verify the redis liveness script content
      expect(typeof redisLiveness).toBe('string');
      expect(redisLiveness).toContain('response=$(');
      expect(redisLiveness).toContain('redis-cli \\');
      expect(redisLiveness).toContain('-a "${REDIS_PASSWORD}" --no-auth-warning');
      expect(redisLiveness).toContain('-h localhost');
      expect(redisLiveness).toContain('-p 6379');
      expect(redisLiveness).toContain('ping');
      expect(redisLiveness).toContain('if [ "$response" != "PONG" ] && [ "${response:0:7}" != "LOADING" ]');
      expect(redisLiveness).toContain('echo "$response"');
      expect(redisLiveness).toContain('exit 1');
      expect(redisLiveness).toContain('echo "response=$response"');

      // Verify the redis readiness script content
      expect(typeof redisReadiness).toBe('string');
      expect(redisReadiness).toContain('response=$(');
      expect(redisReadiness).toContain('redis-cli \\');
      expect(redisReadiness).toContain('-a "${REDIS_PASSWORD}" --no-auth-warning');
      expect(redisReadiness).toContain('-h localhost');
      expect(redisReadiness).toContain('-p 6379');
      expect(redisReadiness).toContain('ping');
      expect(redisReadiness).toContain('if [ "$response" != "PONG" ]');
      expect(redisReadiness).toContain('echo "$response"');
      expect(redisReadiness).toContain('exit 1');
      expect(redisReadiness).toContain('echo "response=$response"');

    });

    it('handles empty or invalid documents', () => {
      const invalidYaml = `
apiVersion: v1
kind: Invalid
metadata:
  name: test
---
invalid yaml content
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: test-config
`;

      const objects = safeParseManifest(invalidYaml);
      expect(objects).toHaveLength(2);
      expect(objects[0].kind).toBe('Invalid');
      expect(objects[1].kind).toBe('ConfigMap');
    });
  });

  describe('ImportK8sManifest class', () => {
    it('constructs properly with manifest content', () => {
      const importer = new ImportK8sManifest(manifestContent);
      expect(importer).toBeDefined();
      expect(importer.moduleNames).toEqual(['k8s-manifest']);
    });

    describe('unsupported API handling', () => {
      const externalSecretPath = path.join(fixturesDir, 'external-secret.yaml');
      const externalSecretContent = fs.readFileSync(externalSecretPath, 'utf-8');

      it('skips unsupported APIs when unsupported flag is not set', async () => {
        // Create an instance with the external secret manifest
        const importer = new ImportK8sManifest(externalSecretContent);

        // Create a wrapper function to access the protected method
        const testGenerateTypeScript = async (code: CodeMaker) => {
          return (importer as any).generateTypeScript.call(importer, code, 'k8s-manifest', { unsupported: false });
        };

        // Mock console.warn to capture warnings
        const originalWarn = console.warn;
        const warnMock = jest.fn();
        console.warn = warnMock;

        try {
          const code = new CodeMaker();
          let generatedCode: string | undefined;

          code.save = jest.fn().mockImplementation(async (_outdir: string) => {
            const codeFiles = (code as any).files;
            if (Object.keys(codeFiles).length > 0) {
              const firstKey = Object.keys(codeFiles)[0];
              const content = codeFiles[firstKey];
              if (content && typeof content === 'object' && 'buffer' in content) {
                generatedCode = content.buffer;
              }
            }
            return undefined;
          });

          // Open a file in the CodeMaker before generating code
          code.openFile('k8s-manifest.ts');
          await testGenerateTypeScript(code);
          code.closeFile('k8s-manifest.ts');

          // Save to capture the generated code
          await code.save('dummy-dir');

          // Verify that a warning was logged
          expect(warnMock).toHaveBeenCalled();
          expect(warnMock.mock.calls[0][0]).toContain('Unsupported API type');

          // Verify that the class was not generated
          expect(generatedCode).toBeDefined();
          expect(generatedCode).not.toContain('export class ExternalSecretExampleExternalSecret');
        } finally {
          console.warn = originalWarn;
        }
      });

      it('includes unsupported APIs when unsupported flag is set', async () => {
        // Create an instance with the external secret manifest
        const importer = new ImportK8sManifest(externalSecretContent);

        // Create a wrapper function to access the protected method
        const testGenerateTypeScript = async (code: CodeMaker) => {
          return (importer as any).generateTypeScript.call(importer, code, 'k8s-manifest', { unsupported: true });
        };

        // Mock console.log to capture verbose logs
        const originalLog = console.log;
        const logMock = jest.fn();
        console.log = logMock;

        try {
          const code = new CodeMaker();
          let generatedCode: string | undefined;

          code.save = jest.fn().mockImplementation(async (_outdir: string) => {
            const codeFiles = (code as any).files;
            if (Object.keys(codeFiles).length > 0) {
              const firstKey = Object.keys(codeFiles)[0];
              const content = codeFiles[firstKey];
              if (content && typeof content === 'object' && 'buffer' in content) {
                generatedCode = content.buffer;
              }
            }
            return undefined;
          });

          // Open a file in the CodeMaker before generating code
          code.openFile('k8s-manifest.ts');
          await testGenerateTypeScript(code);
          code.closeFile('k8s-manifest.ts');

          // Save to capture the generated code
          await code.save('dummy-dir');

          // Verify that a verbose log was output
          expect(logMock).toHaveBeenCalled();
          const verboseLogCall = logMock.mock.calls.find(call =>
            typeof call[0] === 'string' && call[0].includes('Verbose: Using unsupported API type'),
          );
          expect(verboseLogCall).toBeDefined();

          // Verify that the class was generated
          expect(generatedCode).toBeDefined();
          expect(generatedCode).toContain('export class ExternalSecretExampleExternalSecret extends cp32.k8s.KubeExternalSecret');
        } finally {
          console.log = originalLog;
        }
      });
    });
    it('tests getTypeFromSchema method with real schema', async () => {
      // Create a test instance
      const importer = new ImportK8sManifest(manifestContent);

      (importer as any).schema = await downloadSchema('1.32.0');

      // Access the private getTypeFromSchema method using type assertion
      const getTypeFromSchema = (importer as any).getTypeFromSchema.bind(importer);

      // Test cases for known special types
      expect(getTypeFromSchema('apps/v1', 'Deployment', 'spec.template.spec.containers[0].resources.limits.cpu'))
        .toBe('io.k8s.apimachinery.pkg.api.resource.Quantity');

      expect(getTypeFromSchema('v1', 'Service', 'spec.ports[0].targetPort'))
        .toBe('io.k8s.apimachinery.pkg.util.intstr.IntOrString');

      // Test cases for array properties
      expect(getTypeFromSchema('rbac.authorization.k8s.io/v1', 'ClusterRole', 'rules[0].verbs'))
        .toBeDefined(); // Should not be undefined

      expect(getTypeFromSchema('rbac.authorization.k8s.io/v1', 'ClusterRole', 'rules[0].apiGroups'))
        .toBeDefined(); // Should not be undefined

      expect(getTypeFromSchema('rbac.authorization.k8s.io/v1', 'ClusterRole', 'rules[0].resources'))
        .toBeDefined(); // Should not be undefined

      // Test cases for nested objects
      expect(getTypeFromSchema('rbac.authorization.k8s.io/v1', 'ClusterRoleBinding', 'roleRef'))
        .toBeDefined(); // Should not be undefined

      expect(getTypeFromSchema('rbac.authorization.k8s.io/v1', 'ClusterRoleBinding', 'roleRef.apiGroup'))
        .toBeDefined(); // Should not be undefined

      // Test with a field that is a regular primitive type
      expect(getTypeFromSchema('apps/v1', 'Deployment', 'spec.template.spec.containers[0].ports[0].containerPort'))
        .toBe('integer');

      // Test with a non-existent field
      expect(getTypeFromSchema('apps/v1', 'Deployment', 'spec.nonExistentField'))
        .toBeUndefined();

      // Test with a non-existent resource type
      expect(getTypeFromSchema('v1', 'NonExistentType', 'spec.field'))
        .toBeUndefined();

    });

    it('tests IntOrString types from schema for ServicePort.targetPort and HTTPGetAction.port', async () => {
      // Create a test instance
      const importer = new ImportK8sManifest(manifestContent);
      (importer as any).schema = await downloadSchema('1.32.0');

      // Access the private methods using type assertion
      const getTypeFromSchema = (importer as any).getTypeFromSchema.bind(importer);

      // Test ServicePort.targetPort with different values
      expect(getTypeFromSchema('v1', 'Service', 'spec.ports[0].targetPort'))
        .toBe('io.k8s.apimachinery.pkg.util.intstr.IntOrString');

      // Test HTTPGetAction.port with different values
      expect(getTypeFromSchema('v1', 'Pod', 'spec.containers[0].livenessProbe.httpGet.port'))
        .toBe('io.k8s.apimachinery.pkg.util.intstr.IntOrString');

    });

    it('tests formatValue handles IntOrString types correctly', async () => {
      // Create a test instance
      const importer = new ImportK8sManifest(manifestContent);

      (importer as any).schema = await downloadSchema('1.32.0');

      // Access the private formatValue method using type assertion
      const formatValue = (importer as any).formatValue.bind(importer);

      // Test formatting ServicePort.targetPort with numeric value
      const formattedNumericTargetPort = formatValue(8080, 'v1', 'Service', 'spec.ports[0].targetPort');
      expect(formattedNumericTargetPort).toBe('cp32.k8s.IntOrString.fromNumber(8080)');

      // Test formatting ServicePort.targetPort with string value
      const formattedStringTargetPort = formatValue('http', 'v1', 'Service', 'spec.ports[0].targetPort');
      expect(formattedStringTargetPort).toBe('cp32.k8s.IntOrString.fromString("http")');

      // Test formatting HTTPGetAction.port with numeric value
      const formattedNumericHttpGetPort = formatValue(8080, 'v1', 'Pod', 'spec.containers[0].livenessProbe.httpGet.port');
      expect(formattedNumericHttpGetPort).toBe('cp32.k8s.IntOrString.fromNumber(8080)');

      // Test formatting HTTPGetAction.port with string value
      const formattedStringHttpGetPort = formatValue('http', 'v1', 'Pod', 'spec.containers[0].livenessProbe.httpGet.port');
      expect(formattedStringHttpGetPort).toBe('cp32.k8s.IntOrString.fromString("http")');
    });

    it('tests formatValue correctly includes array indices in field paths', () => {
      // Create a test instance
      const importer = new ImportK8sManifest(manifestContent);

      // Access the private formatValue method using type assertion
      const formatValue = (importer as any).formatValue.bind(importer);

      // Test formatting an array value
      const arrayValue = [
        { name: 'container1', image: 'nginx' },
        { name: 'container2', image: 'redis' },
      ];

      formatValue(arrayValue, 'v1', 'Pod', 'spec.containers');

    });

    it('tests formatValue correctly handles multiline strings', () => {
      // Load the multiline args manifest
      const multilineArgsPath = path.join(fixturesDir, 'multiline-args.yaml');
      const multilineArgsContent = fs.readFileSync(multilineArgsPath, 'utf-8');

      // Create a test instance with the multiline args manifest
      const importer = new ImportK8sManifest(multilineArgsContent);

      // Access the private formatValue method using type assertion
      const formatValue = (importer as any).formatValue.bind(importer);

      // Create a multiline string similar to what would be in the manifest
      const multilineString = `#!/bin/bash
. /opt/bitnami/scripts/libfs.sh
# We copy the logs folder because it has symlinks to stdout and stderr
if ! is_dir_empty /opt/bitnami/nginx/logs; then
  cp -r /opt/bitnami/nginx/logs /emptydir/app-logs-dir
fi`;

      // Format the multiline string
      const formattedValue = formatValue(multilineString, 'apps/v1', 'Deployment', 'spec.template.spec.containers[0].args[1]');

      // Verify the formatted value preserves newlines and escapes properly
      expect(formattedValue).toContain('#!/bin/bash');
      expect(formattedValue).toContain('. /opt/bitnami/scripts/libfs.sh');
      expect(formattedValue).toContain('if ! is_dir_empty /opt/bitnami/nginx/logs; then');
      expect(formattedValue).toContain('cp -r /opt/bitnami/nginx/logs /emptydir/app-logs-dir');
      expect(formattedValue).toContain('fi');

      // Verify the string is properly quoted
      expect(formattedValue.startsWith('"')).toBe(true);
      expect(formattedValue.endsWith('"')).toBe(true);

      // Verify newlines are preserved in the formatted string
      const newlineCount = (formattedValue.match(/\\n/g) || []).length;
      const expectedNewlineCount = (multilineString.match(/\n/g) || []).length;
      expect(newlineCount).toBe(expectedNewlineCount);
    });

    it('tests formatValue correctly handles ConfigMap multiline data', () => {
      // Load the multiline ConfigMap manifest
      const multilineConfigMapPath = path.join(fixturesDir, 'multiline-configmap.yaml');
      const multilineConfigMapContent = fs.readFileSync(multilineConfigMapPath, 'utf-8');

      // Create a test instance with the multiline ConfigMap manifest
      const importer = new ImportK8sManifest(multilineConfigMapContent);

      // Access the private formatValue method using type assertion
      const formatValue = (importer as any).formatValue.bind(importer);

      // Test with pipe (|) syntax content
      const scriptContent = `#!/bin/bash
echo "Starting script"

# Check if directory exists
if [ -d "/data" ]; then
  echo "Data directory exists"
else
  echo "Creating data directory"
  mkdir -p /data
fi

echo "Script completed"`;

      // Format the script content
      const formattedScript = formatValue(scriptContent, 'v1', 'ConfigMap', 'data.script.sh');

      // Verify the formatted value preserves newlines and escapes properly
      expect(formattedScript).toContain('#!/bin/bash');
      expect(formattedScript).toContain('echo \\"Starting script\\"');
      expect(formattedScript).toContain('if [ -d \\"/data\\" ]; then');

      // Verify the string is properly quoted
      expect(formattedScript.startsWith('"')).toBe(true);
      expect(formattedScript.endsWith('"')).toBe(true);

      // Verify newlines are preserved in the formatted string
      const scriptNewlineCount = (formattedScript.match(/\\n/g) || []).length;
      const expectedScriptNewlineCount = (scriptContent.match(/\n/g) || []).length;
      expect(scriptNewlineCount).toBe(expectedScriptNewlineCount);

      // Test with pipe-dash (|-) syntax content
      const configContent = `# Database configuration
db.host=localhost
db.port=5432
db.name=myapp
db.user=admin
db.password=secret

# Application settings
app.log.level=INFO
app.timeout=30
app.max_connections=100`;

      // Format the config content
      const formattedConfig = formatValue(configContent, 'v1', 'ConfigMap', 'data.config.properties');

      // Verify the formatted value preserves newlines and escapes properly
      expect(formattedConfig).toContain('# Database configuration');
      expect(formattedConfig).toContain('db.host=localhost');
      expect(formattedConfig).toContain('# Application settings');

      // Verify the string is properly quoted
      expect(formattedConfig.startsWith('"')).toBe(true);
      expect(formattedConfig.endsWith('"')).toBe(true);

      // Verify newlines are preserved in the formatted string
      const configNewlineCount = (formattedConfig.match(/\\n/g) || []).length;
      const expectedConfigNewlineCount = (configContent.match(/\n/g) || []).length;
      expect(configNewlineCount).toBe(expectedConfigNewlineCount);
    });

    it('generates TypeScript code correctly for ConfigMap with multiline data', async () => {
      // Load the multiline ConfigMap manifest
      const multilineConfigMapPath = path.join(fixturesDir, 'multiline-configmap.yaml');
      const multilineConfigMapContent = fs.readFileSync(multilineConfigMapPath, 'utf-8');

      // Create an instance with the multiline ConfigMap manifest
      const importer = new ImportK8sManifest(multilineConfigMapContent);

      // Create a wrapper function to access the protected method
      const testGenerateTypeScript = async (code: CodeMaker) => {
        return (importer as any).generateTypeScript.call(importer, code, 'k8s-manifest', {});
      };

      // Set up the mock implementation before generating code
      const code = new CodeMaker();
      let generatedCode: string | undefined;

      code.save = jest.fn().mockImplementation(async (_outdir: string) => {
        const codeFiles = (code as any).files;
        if (Object.keys(codeFiles).length > 0) {
          const firstKey = Object.keys(codeFiles)[0];
          const content = codeFiles[firstKey];
          if (content && typeof content === 'object' && 'buffer' in content) {
            generatedCode = content.buffer;
          }
        }
        return undefined;
      });

      // Open a file in the CodeMaker before generating code
      code.openFile('k8s-manifest.ts');
      await testGenerateTypeScript(code);
      code.closeFile('k8s-manifest.ts');

      // Save to capture the generated code
      await code.save('dummy-dir');

      // Check that the generated code contains expected elements
      expect(generatedCode).toBeDefined();
      expect(generatedCode).toContain("import * as cp32 from 'cdk8s-plus-32';");
      expect(generatedCode).toContain('export class ConfigMapMultilineConfigmap extends cp32.k8s.KubeConfigMap');

      // Check for multiline data handling in script.sh
      expect(generatedCode).toContain('#!/bin/bash');
      expect(generatedCode).toContain('echo \\\"Starting script\\\"');
      expect(generatedCode).toContain('if [ -d \\\"/data\\\" ]; then');
      expect(generatedCode).toContain('mkdir -p /data');

      // Check for multiline data handling in config.properties
      expect(generatedCode).toContain('# Database configuration');
      expect(generatedCode).toContain('db.host=localhost');
      expect(generatedCode).toContain('app.max_connections=100');

      // Check for JSON data handling
      expect(generatedCode).toContain('\\\"name\\\": \\\"my-application\\\"');
      expect(generatedCode).toContain('\\\"authentication\\\": true');
    });

    it('generates TypeScript code correctly for multiline args', async () => {
      // Load the multiline args manifest
      const multilineArgsPath = path.join(fixturesDir, 'multiline-args.yaml');
      const multilineArgsContent = fs.readFileSync(multilineArgsPath, 'utf-8');

      // Create an instance with the multiline args manifest
      const importer = new ImportK8sManifest(multilineArgsContent);

      // Create a wrapper function to access the protected method
      const testGenerateTypeScript = async (code: CodeMaker) => {
        return (importer as any).generateTypeScript.call(importer, code, 'k8s-manifest', {});
      };

      // Set up the mock implementation before generating code
      const code = new CodeMaker();
      let generatedCode: string | undefined;

      code.save = jest.fn().mockImplementation(async (_outdir: string) => {
        const codeFiles = (code as any).files;
        if (Object.keys(codeFiles).length > 0) {
          const firstKey = Object.keys(codeFiles)[0];
          const content = codeFiles[firstKey];
          if (content && typeof content === 'object' && 'buffer' in content) {
            generatedCode = content.buffer;
          }
        }
        return undefined;
      });

      // Open a file in the CodeMaker before generating code
      code.openFile('k8s-manifest.ts');
      await testGenerateTypeScript(code);
      code.closeFile('k8s-manifest.ts');

      // Save to capture the generated code
      await code.save('dummy-dir');

      // Check that the generated code contains expected elements
      expect(generatedCode).toBeDefined();
      expect(generatedCode).toContain("import * as cp32 from 'cdk8s-plus-32';");
      expect(generatedCode).toContain('export class DeploymentNginxDeployment extends cp32.k8s.KubeDeployment');

      // Check for multiline args handling
      expect(generatedCode).toContain('/bin/bash');
      expect(generatedCode).toContain('-ec');

      // Verify the multiline string is properly formatted in the generated code
      expect(generatedCode).toContain('#!/bin/bash');
      expect(generatedCode).toContain('. /opt/bitnami/scripts/libfs.sh');
      expect(generatedCode).toContain('if ! is_dir_empty /opt/bitnami/nginx/logs; then');
      expect(generatedCode).toContain('cp -r /opt/bitnami/nginx/logs /emptydir/app-logs-dir');
      expect(generatedCode).toContain('fi');
    });

    it('generates TypeScript code correctly', async () => {
      // Create an instance of ImportK8sManifest
      const importer = new ImportK8sManifest(manifestContent);

      // Create a wrapper function to access the protected method
      const testGenerateTypeScript = async (code: CodeMaker) => {
        return (importer as any).generateTypeScript.call(importer, code, 'k8s-manifest', {});
      };

      const code = new CodeMaker();

      // Set up the mock implementation before generating code
      let generatedCode: string | undefined;
      code.save = jest.fn().mockImplementation(async (_outdir: string) => {
        // Access the private property using indexing
        const codeFiles = (code as any).files;
        console.log('CodeMaker files:', Object.keys(codeFiles));

        // Get the first file content regardless of key
        if (Object.keys(codeFiles).length > 0) {
          const firstKey = Object.keys(codeFiles)[0];
          // Inspect the content object
          const content = codeFiles[firstKey];
          console.log('Content type:', typeof content);
          console.log('Content keys:', Object.keys(content));

          // Extract the buffer content
          if (content && typeof content === 'object' && 'buffer' in content) {
            generatedCode = content.buffer;
          }
        }

        return undefined;
      });

      // Open a file in the CodeMaker before generating code
      code.openFile('k8s-manifest.ts');
      await testGenerateTypeScript(code);
      code.closeFile('k8s-manifest.ts');

      // Save to capture the generated code
      await code.save('dummy-dir');

      console.log('Generated code exists:', !!generatedCode);

      // Check that the generated code contains expected elements
      expect(generatedCode).toBeDefined();
      expect(generatedCode).toContain("import * as cp32 from 'cdk8s-plus-32';");
      expect(generatedCode).toContain('export class DeploymentTestDeployment extends cp32.k8s.KubeDeployment');
      expect(generatedCode).toContain('export class ServiceTestService extends cp32.k8s.KubeService');
      expect(generatedCode).toContain('export class IngressTestIngress extends cp32.k8s.KubeIngress');
      expect(generatedCode).toContain('export class HorizontalPodAutoscalerTestHpa extends cp32.k8s.KubeHorizontalPodAutoscalerV2');

      // Check for special type handling
      expect(generatedCode).toContain('cp32.k8s.Quantity.fromString');
      expect(generatedCode).toContain('cp32.k8s.IntOrString.fromNumber');
    });
  });

  describe('static methods', () => {
    it('fromSpec creates an instance from a file path', () => {
      const importSpec: ImportSpec = {
        source: manifestPath,
      };

      const importer = ImportK8sManifest.fromSpec(importSpec);
      expect(importer).toBeDefined();
      expect(importer.moduleNames).toEqual(['k8s-manifest']);
    });

    it('match identifies valid k8s manifest files', async () => {
      const importSpec: ImportSpec = {
        source: manifestPath,
      };

      const result = await ImportK8sManifest.match(importSpec, { k8sApiVersion: '1.32.0' });
      expect(result).toBeDefined();
      expect(result?.source).toBe(manifestPath);
      expect(result?.k8sApiVersion).toBe('1.32.0');
    });

    it('match rejects invalid sources', async () => {
      const importSpec: ImportSpec = {
        source: 'non-existent-file.yaml',
      };

      const result = await ImportK8sManifest.match(importSpec, {});
      expect(result).toBeUndefined();
    });
  });
});