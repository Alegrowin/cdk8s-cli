import * as path from 'path';
import { CodeMaker } from 'codemaker';
import * as fs from 'fs-extra';
import { ImportK8sManifest } from '../../src/import/manifest';

describe('Acronym Handling in K8s Manifest Import', () => {
  const fixturesDir = path.join(__dirname, 'fixtures', 'k8s-manifest', 'acronyms');

  describe('hostIPC conversion', () => {
    it('correctly converts hostIPC to hostIpc', async () => {
      // Load the hostIPC manifest
      const manifestPath = path.join(fixturesDir, 'hostIPC.yaml');
      const manifestContent = fs.readFileSync(manifestPath, 'utf-8');

      // Create an instance with the manifest
      const importer = new ImportK8sManifest(manifestContent);

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

      // Check that the generated code contains the correctly converted property
      expect(generatedCode).toBeDefined();
      expect(generatedCode).toContain('"hostIpc": true');
      expect(generatedCode).not.toContain('"hostIPC": true');
    });
  });

  describe('multiple acronyms conversion', () => {
    it('correctly converts multiple acronyms in property names', async () => {
      // Load the multiple acronyms manifest
      const manifestPath = path.join(fixturesDir, 'multiple-acronyms.yaml');
      const manifestContent = fs.readFileSync(manifestPath, 'utf-8');

      // Create an instance with the manifest
      const importer = new ImportK8sManifest(manifestContent);

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

      // Check that the generated code contains the correctly converted properties
      expect(generatedCode).toBeDefined();
      expect(generatedCode).toContain('"hostIpc": true');
      expect(generatedCode).toContain('"hostPid": true');
      expect(generatedCode).toContain('"nonResourceUrLs":');

      // Check that the original property names are not present
      expect(generatedCode).not.toContain('"hostIPC": true');
      expect(generatedCode).not.toContain('"hostPID": true');
      expect(generatedCode).not.toContain('"nonResourceURLs":');
    });
  });

  describe('formatValue method', () => {
    it('correctly converts property names with acronyms', () => {
      // Create a test instance
      const importer = new ImportK8sManifest('');

      // Access the private formatValue method using type assertion
      const formatValue = (importer as any).formatValue.bind(importer);

      // Test object with acronym properties
      const testObj = {
        hostIPC: true,
        hostPID: false,
        nonResourceURLs: ['/healthz'],
        podIP: '10.0.0.1',
        containerID: 'abc123',
        diskURI: 'disk://test',
      };

      // Format the object
      const formattedValue = formatValue(testObj, 'v1', 'Pod', 'spec');

      // Check that the acronyms are correctly converted
      expect(formattedValue).toContain('"hostIpc": true');
      expect(formattedValue).toContain('"hostPid": false');
      expect(formattedValue).toContain('"nonResourceUrLs":');
      expect(formattedValue).toContain('"podIp":');
      expect(formattedValue).toContain('"containerId":');
      expect(formattedValue).toContain('"diskUri":');

      // Check that the original property names are not present
      expect(formattedValue).not.toContain('"hostIPC"');
      expect(formattedValue).not.toContain('"hostPID"');
      expect(formattedValue).not.toContain('"nonResourceURLs"');
      expect(formattedValue).not.toContain('"podIP"');
      expect(formattedValue).not.toContain('"containerID"');
      expect(formattedValue).not.toContain('"diskURI"');
    });
  });
});